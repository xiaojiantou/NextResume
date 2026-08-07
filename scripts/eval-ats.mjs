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
//
// Postings are .txt files. Resumes are .json files in parsed Resume shape (the
// payload /api/parse-resume returns), so you can build a corpus by saving real
// parses instead of hand-writing fixtures.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { countOccurrences, scoreResume } from "../lib/atsScore.ts";
import { isNoiseKeyword, sanitizeJobKeywords } from "../lib/jobKeywords.ts";

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

// Read the live prompt out of the route so this always evaluates what ships.
const routeSrc = readFileSync("app/api/parse-job/route.ts", "utf8");
const SYSTEM = routeSrc.slice(
  routeSrc.indexOf("const SYSTEM = `") + "const SYSTEM = `".length,
  routeSrc.indexOf("`;\n\nexport async function POST"),
);

async function parseJob(text) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.NOVITA_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Job description:\n\n${text.slice(0, 8000)}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 1500,
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

  const scores = resumes.map(({ name, resume }) => ({
    resume: name,
    score: scoreResume(resume, clean).overall,
  }));

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
