// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Batch evaluation for JD keyword extraction and resume scoring.
//
// Any single job description can be fixed by hand. The question that matters is
// whether a prompt or heuristic change helps across the whole corpus, so this
// runs the real production path over a folder of postings, auto-flags suspect
// keywords, and writes a baseline you can diff the next change against.
//
//   node --experimental-strip-types scripts/eval-ats.mjs --jds ./eval/jds
//   node --experimental-strip-types scripts/eval-ats.mjs --jds ./eval/jds --out eval/baseline.jsonl
//   node --experimental-strip-types scripts/eval-ats.mjs --jds ./eval/jds --compare eval/baseline.jsonl
//   node --experimental-strip-types scripts/eval-ats.mjs --jds ./eval/jds --resumes ./eval/resumes
//   node --experimental-strip-types scripts/eval-ats.mjs --resumes ./eval/resumes --rewrite
//
// Postings are .txt files. Resumes are .json files in parsed Resume shape (the
// payload /api/parse-resume returns), so you can build a corpus by saving real
// parses instead of hand-writing fixtures.
//
// --rewrite additionally runs the real optimize pipeline on every
// resume x posting pair and re-scores the result, which is the only way to see
// whether a change to the rewrite prompt moves the rubric. It is the expensive
// mode: one 7000-token completion per pair, so a 5x5 corpus is 25 calls.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { countOccurrences, scoreResume } from "../lib/atsScore.ts";
import { isNoiseKeyword, sanitizeJobKeywords } from "../lib/jobKeywords.ts";
import { applyOptimizationToResume } from "../lib/applyOptimization.ts";
import {
  normalizeOptimization,
  validateOptimization,
} from "../lib/optimizeContract.ts";
import {
  constrainRoleOptimizedStructure,
  enforceLockedOptimization,
  reconcileGroundedSkills,
  validateGroundedOptimization,
  validateLockedOptimization,
} from "../lib/resumeStructure.ts";

// --- args ------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const JDS_DIR = flag("jds", "eval/jds");
const RESUMES_DIR = flag("resumes");
const OUT = flag("out");
const COMPARE = flag("compare");
const LIMIT = Number(flag("limit", "0")) || Infinity;
const REWRITE = args.includes("--rewrite");

if (!existsSync(JDS_DIR)) {
  console.error(`No such directory: ${JDS_DIR}
Create it and drop in .txt job descriptions, one per file.`);
  process.exit(1);
}

// --- env / model -----------------------------------------------------------
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const BASE = env.NOVITA_BASE_URL || "https://api.novita.ai/v3/openai";
const MODEL = env.NOVITA_MODEL || "deepseek/deepseek-v3-0324";

// Read the live prompts out of the routes so this always evaluates what ships.
// The markers below are written with \n, but a Windows checkout hands us the
// same file with \r\n — so the end marker never matched there and the eval died
// on startup. Reading the prompts out of the route source is the whole point of
// this script (an eval that reimplements the prompt measures the
// reimplementation), so it has to survive either checkout.
function readSource(file) {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function sliceTemplate(src, decl, end) {
  const from = src.indexOf(decl);
  if (from < 0) throw new Error(`could not find ${decl}`);
  const start = from + decl.length;
  const stop = src.indexOf(end, start);
  if (stop < 0) throw new Error(`could not find the end of ${decl}`);
  return src.slice(start, stop);
}

const jobRouteSrc = readSource("app/api/parse-job/route.ts");
const SYSTEM = sliceTemplate(jobRouteSrc, "const SYSTEM = `", "`;\n\nexport async function POST");

import {
  assembleOptimization,
  buildChunkPrompt,
  chunkKey,
  planRewriteChunks,
} from "../lib/optimizeChunks.ts";

async function complete({ system, user, maxTokens }) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.NOVITA_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
  });
  const raw = (await res.json())?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!raw) throw new Error("empty completion");
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  }
}

function parseJob(text) {
  return complete({
    system: SYSTEM,
    user: `Job description:\n\n${text.slice(0, 8000)}`,
    maxTokens: 1500,
  });
}

// Mirrors POST /api/optimize in "optimize" structure mode with nothing locked.
// The one deliberate omission is reviewSemanticGrounding, which is a second
// model call per attempt; issue counts here are therefore a lower bound.
async function rewriteOnce(resume, job, report) {
  const chunks = planRewriteChunks(resume, "optimize");
  const results = new Map(
    await Promise.all(
      chunks.map(async (chunk) => [
        chunkKey(chunk),
        await complete(
          buildChunkPrompt({
            chunk,
            resume,
            job,
            report,
            structureMode: "optimize",
            lockedContentIds: [],
            baselineOptimization: null,
          }),
        ),
      ]),
    ),
  );

  const normalized = normalizeOptimization(
    assembleOptimization(resume, "optimize", results),
  );
  const grounded = reconcileGroundedSkills(
    resume,
    normalized.skills,
    normalized.skillEvidence,
  );
  normalized.skills = grounded.skills;
  normalized.skillEvidence = grounded.skillEvidence;

  const structured = constrainRoleOptimizedStructure({ resume, candidate: normalized });
  const opt = enforceLockedOptimization({
    resume,
    candidate: structured,
    baseline: null,
    lockedContentIds: [],
  });
  const issues = [
    ...validateOptimization(resume, opt, job),
    ...validateGroundedOptimization(resume, opt),
    ...validateLockedOptimization({
      resume,
      candidate: opt,
      baseline: null,
      lockedContentIds: [],
    }),
  ];
  return { optimization: opt, issues };
}

// --- automatic suspicion flags --------------------------------------------
// These need no labelled ground truth, which is what makes the corpus cheap to
// grow: drop in a posting and it is evaluated immediately.
function flagsFor(keyword, jdText) {
  const flags = [];
  const total = countOccurrences(jdText, keyword);

  // Emitted a term the posting never uses: paraphrase or hallucination. The
  // candidate gets told to add a word no recruiter will search.
  if (total === 0) flags.push("ABSENT");
  // Every mention is "Keyword:" — a section label, not a skill.
  else if (countOccurrences(jdText, `${keyword}:`) >= total) flags.push("HEADING");

  if (keyword.trim().split(/\s+/).length > 4) flags.push("LONG");
  if (isNoiseKeyword(keyword)) flags.push("NOISE");
  return flags;
}

// --- run -------------------------------------------------------------------
const files = readdirSync(JDS_DIR).filter((f) => f.endsWith(".txt")).slice(0, LIMIT);
if (files.length === 0) {
  console.error(`No .txt files in ${JDS_DIR}`);
  process.exit(1);
}

const resumes = RESUMES_DIR && existsSync(RESUMES_DIR)
  ? readdirSync(RESUMES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, resume: JSON.parse(readFileSync(path.join(RESUMES_DIR, f), "utf8")) }))
  : [];

if (REWRITE && resumes.length === 0) {
  console.error("--rewrite needs --resumes <dir> holding at least one .json resume.");
  process.exit(1);
}

console.log(`model: ${MODEL}`);
console.log(`postings: ${files.length}${resumes.length ? `   resumes: ${resumes.length}` : ""}\n`);

const rows = [];
for (const [i, file] of files.entries()) {
  const jdText = readFileSync(path.join(JDS_DIR, file), "utf8");
  let raw;
  try {
    raw = await parseJob(jdText);
  } catch (e) {
    console.log(`${String(i + 1).padStart(3)}. ${file.padEnd(34)} PARSE FAILED: ${e.message}`);
    rows.push({ file, error: String(e.message) });
    continue;
  }

  const clean = sanitizeJobKeywords(raw, jdText);
  const rawRequired = Array.isArray(raw.requiredKeywords) ? raw.requiredKeywords : [];
  const cut = rawRequired.filter((k) => !clean.requiredKeywords.includes(k));
  const surviving = clean.requiredKeywords.flatMap((k) => {
    const f = flagsFor(k, jdText);
    return f.length ? [{ keyword: k, flags: f }] : [];
  });

  const scores = [];
  for (const { name, resume } of resumes) {
    const before = scoreResume(resume, clean);
    const entry = { resume: name, score: before.overall };
    if (REWRITE) {
      // /api/analyze projects an optimistic "after" here via a helper private
      // to that route. The projection is only context for the model, never a
      // measurement, so the eval passes the real before-scores for both.
      const report = {
        overallBefore: before.overall,
        overallAfter: before.overall,
        categoriesBefore: before.categories,
        categoriesAfter: before.categories,
        missingKeywords: before.missingKeywords,
        presentKeywords: before.matchedKeywords,
        stuffingWarnings: before.stuffing.warnings,
      };
      try {
        const { optimization, issues } = await rewriteOnce(resume, clean, report);
        const after = scoreResume(applyOptimizationToResume(resume, optimization), clean);
        const byLabel = new Map(before.categories.map((c) => [c.label, c.score]));
        entry.rewrite = {
          after: after.overall,
          issues: issues.length,
          firstIssues: issues.slice(0, 3),
          categories: Object.fromEntries(
            after.categories.map((c) => [c.label, c.score - (byLabel.get(c.label) ?? 0)]),
          ),
        };
      } catch (e) {
        entry.rewrite = { error: String(e.message) };
      }
    }
    scores.push(entry);
  }

  rows.push({
    file,
    title: raw.title,
    rawCount: rawRequired.length,
    cleanCount: clean.requiredKeywords.length,
    cut,
    surviving,
    keywords: clean.requiredKeywords,
    scores,
  });

  const badge = surviving.length ? `⚠ ${surviving.length} suspect` : "clean";
  console.log(
    `${String(i + 1).padStart(3)}. ${file.padEnd(34)} ${String(rawCountLabel(rawRequired.length, clean.requiredKeywords.length)).padEnd(11)} ${badge}`,
  );
  if (cut.length) console.log(`      cut: ${cut.join(", ")}`);
  for (const s of surviving) console.log(`      ${s.flags.join("+")}: "${s.keyword}"`);
  if (scores.length) console.log(`      scores: ${scores.map((s) => `${s.resume.replace(/\.json$/, "")}=${s.score}`).join("  ")}`);
  for (const s of scores) {
    if (!s.rewrite) continue;
    const who = s.resume.replace(/\.json$/, "");
    if (s.rewrite.error) {
      console.log(`      rewrite ${who}: FAILED: ${s.rewrite.error}`);
      continue;
    }
    const moved = Object.entries(s.rewrite.categories)
      .filter(([, d]) => d !== 0)
      .map(([label, d]) => `${label} ${d > 0 ? "+" : ""}${d}`);
    console.log(
      `      rewrite ${who}: ${s.score} -> ${s.rewrite.after}` +
        `   ${s.rewrite.issues} issue${s.rewrite.issues === 1 ? "" : "s"}` +
        (moved.length ? `   ${moved.join(", ")}` : "   no category moved"),
    );
    for (const issue of s.rewrite.firstIssues) console.log(`         ! ${issue}`);
  }
}

function rawCountLabel(raw, clean) {
  return raw === clean ? `${raw} kw` : `${raw}->${clean} kw`;
}

// --- summary ---------------------------------------------------------------
const ok = rows.filter((r) => !r.error);
const suspectTotal = ok.reduce((n, r) => n + r.surviving.length, 0);
const kwTotal = ok.reduce((n, r) => n + r.cleanCount, 0);
const dirty = ok.filter((r) => r.surviving.length > 0).length;

console.log(`\n${"=".repeat(58)}`);
console.log(`postings parsed     ${ok.length}/${rows.length}`);
console.log(`keywords kept       ${kwTotal}  (avg ${(kwTotal / Math.max(1, ok.length)).toFixed(1)}/posting)`);
console.log(`sanitizer cut       ${ok.reduce((n, r) => n + r.cut.length, 0)}`);
console.log(`suspect surviving   ${suspectTotal}  (${((suspectTotal / Math.max(1, kwTotal)) * 100).toFixed(1)}% of kept)`);
console.log(`postings with any   ${dirty}/${ok.length}`);
if (resumes.length) {
  for (const { name } of resumes) {
    const vals = ok.flatMap((r) => r.scores.filter((s) => s.resume === name).map((s) => s.score));
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    console.log(`score ${name.replace(/\.json$/, "").padEnd(14)} min ${Math.min(...vals)}  avg ${avg.toFixed(1)}  max ${Math.max(...vals)}`);
  }
}

if (REWRITE) {
  const runs = ok.flatMap((r) => r.scores.filter((s) => s.rewrite && !s.rewrite.error));
  const failed = ok.flatMap((r) => r.scores.filter((s) => s.rewrite?.error)).length;
  if (runs.length) {
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const overall = mean(runs.map((s) => s.rewrite.after - s.score));
    console.log(`rewrites            ${runs.length} scored, ${failed} failed`);
    console.log(`overall delta       ${overall >= 0 ? "+" : ""}${overall.toFixed(1)} avg`);
    // The per-category means are the actionable half: a prompt change that
    // claims to fix Title match has to show up on this line or it did not work.
    for (const label of Object.keys(runs[0].rewrite.categories)) {
      const ds = runs.map((s) => s.rewrite.categories[label]);
      const avg = mean(ds);
      const gained = ds.filter((d) => d > 0).length;
      const lost = ds.filter((d) => d < 0).length;
      console.log(
        `  ${label.padEnd(18)}${avg >= 0 ? "+" : ""}${avg.toFixed(1)} avg   ` +
          `${gained} up, ${lost} down, ${ds.length - gained - lost} flat`,
      );
    }
    const cleanRuns = runs.filter((s) => s.rewrite.issues === 0).length;
    console.log(`passed validation   ${cleanRuns}/${runs.length} on the first attempt`);
  }
}
console.log("=".repeat(58));

if (OUT) {
  writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\nbaseline written: ${OUT}`);
}

if (COMPARE && existsSync(COMPARE)) {
  const old = new Map(
    readFileSync(COMPARE, "utf8").trim().split("\n").filter(Boolean)
      .map((l) => { const r = JSON.parse(l); return [r.file, r]; }),
  );
  console.log(`\nvs ${COMPARE}:`);
  let better = 0, worse = 0, same = 0;
  for (const r of ok) {
    const prev = old.get(r.file);
    if (!prev || prev.error) continue;
    const d = r.surviving.length - prev.surviving.length;
    if (d < 0) better += 1;
    else if (d > 0) {
      worse += 1;
      console.log(`  WORSE  ${r.file}: ${prev.surviving.length} -> ${r.surviving.length} suspect`);
      for (const s of r.surviving) console.log(`         ${s.flags.join("+")}: "${s.keyword}"`);
    } else same += 1;
  }
  console.log(`  better ${better}   same ${same}   worse ${worse}`);
}
