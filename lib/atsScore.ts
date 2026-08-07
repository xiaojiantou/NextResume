// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Deterministic ATS scoring.
//
// Why this exists: the previous headline score was a free-floating number the
// LLM emitted alongside the rubric, not derived from it. Measured behaviour on
// a fixed resume/JD pair: the headline landed on 72 or 78 across runs (±6 of
// noise) while the rubric categories stayed within 83.6–86.0. Because a careful
// rewrite only moves the rubric by ~2-3 points on an already-strong resume, the
// real improvement was smaller than the measurement noise — users saw "72 → 72"
// and concluded the product did nothing.
//
// Everything here is computed in code from the resume and the parsed JD. Same
// input always yields the same number, and the number is causally connected to
// what the optimizer actually changes: weave in a required keyword and
// "Keyword match" provably rises.
//
// "Role alignment" (the old fuzzy "does this background look like the role?"
// judgement) is replaced by "Title match" — whether the JD's job title shows up
// on the resume. That is both computable and actionable, and it is the single
// highest-leverage signal in the rubric: Jobscan's analysis of ~1M job searches
// found resumes containing the target job title drew 10.6x more interview
// invitations, and 55.3% of recruiters filter their ATS by job title.
// https://www.jobscan.co/state-of-the-job-search

import type { AtsCategory, JobAnalysis, Resume } from "./types";

export const WEIGHTS = {
  keyword: 0.45,
  title: 0.2,
  quantified: 0.15,
  actionVerbs: 0.12,
  formatting: 0.08,
} as const;

/**
 * Occurrences of one required keyword past which we stop treating repetition as
 * signal. Workday's 2026 update flags unnaturally high keyword density as
 * manipulation, so rewarding repetition would train users into a penalty.
 */
export const MAX_KEYWORD_REPEATS = 4;

/** Share of bullets carrying a metric that counts as full marks. */
const QUANTIFIED_TARGET_SHARE = 0.6;

/**
 * Irregular past-tense openers. Regular ones ("Orchestrated", "Instrumented",
 * "Pioneered") are recognised by their "-ed" ending instead, so this list only
 * needs to cover verbs that ending-matching misses.
 *
 * A closed whitelist would punish vocabulary range: any strong verb missing
 * from it drags the score down, which is backwards. The weak-opener list is
 * the one that can be closed — "worked on" / "helped" / "responsible for" are
 * a small, well-known set of resume anti-patterns.
 */
const STRONG_IRREGULAR_VERBS = new Set([
  "led", "built", "drove", "ran", "wrote", "grew", "won", "sold", "spoke",
  "taught", "rebuilt", "oversaw", "began", "chose", "cut", "set", "put",
  "made", "met", "kept", "held", "sent", "brought", "found", "took", "gave",
  "rewrote", "shrank", "sped",
]);

// Mirrors the weak openers pickWeakestBullet() looks for in app/api/optimize.
const WEAK_OPENERS = [
  "worked on", "helped", "assisted", "responsible for", "involved in",
  "participated", "tasked with", "duties included", "contributed to",
];

// Words that describe the level of a role rather than the role itself. Dropped
// before comparing titles so "Intern: AI Engineering" matches "AI Engineer".
const SENIORITY_WORDS = new Set([
  "intern", "internship", "coop", "co", "op", "senior", "sr", "junior", "jr",
  "lead", "principal", "staff", "entry", "level", "associate", "assistant",
  "graduate", "grad", "new", "summer", "fall", "spring", "winter", "student",
  "i", "ii", "iii", "iv", "trainee", "apprentice", "contract", "temporary",
  "full", "part", "time", "remote", "hybrid", "onsite",
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a keyword tolerantly on separators and plurals but strictly on word
 * boundaries: "CI/CD" also matches "CI-CD" and "CI CD", "data pipeline" also
 * matches "data pipelines", but "Java" never matches "JavaScript".
 */
function keywordRegex(keyword: string): RegExp | null {
  const cleaned = keyword.trim().toLowerCase();
  if (!cleaned) return null;

  const body = escapeRegex(cleaned).replace(/(?:\\?[\s\-/])+/g, "[\\s\\-/]*");
  const startsAlnum = /[a-z0-9]/.test(cleaned[0]);
  const endsAlnum = /[a-z0-9]/.test(cleaned[cleaned.length - 1]);

  const lead = startsAlnum ? "(?<![a-z0-9])" : "";
  const plural = endsAlnum ? "(?:e?s)?" : "";
  const tail = endsAlnum ? "(?![a-z0-9])" : "";

  try {
    return new RegExp(`${lead}${body}${plural}${tail}`, "gi");
  } catch {
    return null;
  }
}

/**
 * Occurrences of `keyword` in `haystack`, tolerant of separators and plurals
 * but strict on word boundaries. Exported so the JD keyword sanitizer matches
 * text exactly the way scoring does.
 */
export function countOccurrences(haystack: string, keyword: string): number {
  const re = keywordRegex(keyword);
  if (!re) return 0;
  return (haystack.match(re) ?? []).length;
}

export type ResumeBulletRef = { id: string; text: string };

/** Every bullet in the resume, in reading order. */
export function collectBullets(resume: Resume): ResumeBulletRef[] {
  const out: ResumeBulletRef[] = [];
  for (const role of resume.experience ?? []) out.push(...(role.bullets ?? []));
  for (const project of resume.projects ?? []) out.push(...(project.bullets ?? []));
  for (const section of resume.additionalSections ?? []) {
    for (const item of section.items ?? []) out.push(...(item.bullets ?? []));
  }
  return out;
}

/** Flattens the resume into the text an ATS parser would index. */
export function resumeToText(resume: Resume): string {
  const parts: string[] = [
    resume.title ?? "",
    resume.summary ?? "",
    ...(resume.skills ?? []),
    ...(resume.skillGroups ?? []).flatMap((g) => [g.label, ...g.skills]),
  ];
  for (const role of resume.experience ?? []) {
    parts.push(role.title ?? "", role.company ?? "", role.techStack ?? "");
    parts.push(...(role.bullets ?? []).map((b) => b.text));
  }
  for (const project of resume.projects ?? []) {
    parts.push(project.name ?? "", project.role ?? "");
    parts.push(...(project.bullets ?? []).map((b) => b.text));
  }
  for (const edu of resume.education ?? []) {
    parts.push(edu.school ?? "", edu.degree ?? "");
  }
  for (const section of resume.additionalSections ?? []) {
    parts.push(section.title ?? "");
    for (const item of section.items ?? []) {
      parts.push(item.heading ?? "", item.subheading ?? "");
      parts.push(...(item.bullets ?? []).map((b) => b.text));
    }
  }
  return parts.filter(Boolean).join("\n").toLowerCase();
}

// --- title match ----------------------------------------------------------

function stem(token: string): string {
  let s = token;
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  // "engineering" -> "engineer", "consulting" -> "consult"
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  return s;
}

/** Role words in a title, with punctuation, seniority, and years removed. */
export function titleTokens(title: string): string[] {
  return (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t && !SENIORITY_WORDS.has(t) && !/^\d+$/.test(t))
    .map(stem);
}

function overlapRatio(target: string[], candidate: string[]): number {
  if (target.length === 0) return 0;
  const have = new Set(candidate);
  const hits = target.filter((t) => have.has(t)).length;
  return hits / target.length;
}

function scoreTitleMatch(resume: Resume, job: JobAnalysis) {
  const target = titleTokens(job.title);
  if (target.length === 0) {
    return { score: 100, detail: "No job title in the posting to match against." };
  }

  const headline = overlapRatio(target, titleTokens(resume.title ?? ""));
  const summary = overlapRatio(target, titleTokens(resume.summary ?? ""));
  const roles = Math.max(
    0,
    ...(resume.experience ?? []).map((r) => overlapRatio(target, titleTokens(r.title ?? ""))),
  );

  // The headline under the name is what recruiters' title filters hit first,
  // so it earns full marks; the same words further down earn partial credit.
  const headlineScore = headline === 1 ? 100 : Math.round(90 * headline);
  const score = Math.max(
    headlineScore,
    Math.round(60 * summary),
    Math.round(50 * roles),
  );

  const phrase = target.join(" ");
  const detail =
    headline === 1
      ? `Headline matches the posting's title ("${job.title}").`
      : score === 0
        ? `The posting's title ("${job.title}") appears nowhere on the resume. Put "${job.title}" in the headline under your name — that is the field recruiters filter on.`
        : `Partial title match only. Add "${job.title}" to the headline under your name (matched terms: ${phrase}).`;

  return { score, detail };
}

// --- keyword match --------------------------------------------------------

function scoreKeywordMatch(text: string, job: JobAnalysis) {
  const required = (job.requiredKeywords ?? []).filter(Boolean);
  const nice = (job.niceToHaveKeywords ?? []).filter(Boolean);

  // Counted once each: repeating a keyword must not buy score.
  const matched = required.filter((k) => countOccurrences(text, k) > 0);
  const missing = required.filter((k) => countOccurrences(text, k) === 0);
  const niceMatched = nice.filter((k) => countOccurrences(text, k) > 0);

  const base = required.length > 0 ? matched.length / required.length : 1;
  const bonus = nice.length > 0 ? (niceMatched.length / nice.length) * 0.1 : 0;
  const score = Math.round(Math.min(1, base + bonus) * 100);

  const detail =
    missing.length === 0
      ? `All ${required.length} required keywords present.`
      : `${matched.length} of ${required.length} required keywords present. Missing: ${missing.slice(0, 6).join(", ")}.`;

  return { score, detail, matched, missing, niceMatched };
}

// --- quantified impact ----------------------------------------------------

function hasMetric(text: string): boolean {
  // Strip years first — "2024" is a date, not an outcome.
  return /\d/.test(text.replace(/\b(19|20)\d{2}\b/g, " "));
}

function scoreQuantified(bullets: ResumeBulletRef[]) {
  if (bullets.length === 0) {
    return { score: 0, detail: "No bullets found to measure." };
  }
  const withMetric = bullets.filter((b) => hasMetric(b.text)).length;
  const share = withMetric / bullets.length;
  const score = Math.round(Math.min(1, share / QUANTIFIED_TARGET_SHARE) * 100);
  const detail = `${withMetric} of ${bullets.length} bullets carry a number or measurable outcome (${Math.round(share * 100)}%).`;
  return { score, detail };
}

// --- action verbs ---------------------------------------------------------

function scoreActionVerbs(bullets: ResumeBulletRef[]) {
  if (bullets.length === 0) {
    return { score: 0, detail: "No bullets found to measure." };
  }
  let strong = 0;
  let weak = 0;
  for (const bullet of bullets) {
    const lower = bullet.text.trim().toLowerCase();
    if (WEAK_OPENERS.some((w) => lower.startsWith(w))) {
      weak += 1;
      continue;
    }
    const first = lower.split(/[\s,]+/)[0]?.replace(/[^a-z]/g, "") ?? "";
    // "-ed" covers regular past tense, which is how most ownership verbs on a
    // resume are written. The irregular set catches the rest.
    if (
      STRONG_IRREGULAR_VERBS.has(first) ||
      (first.length > 3 && first.endsWith("ed"))
    ) {
      strong += 1;
    }
  }
  const neutral = bullets.length - strong - weak;
  const score = Math.round(((strong + neutral * 0.5) / bullets.length) * 100);
  const detail =
    weak > 0
      ? `${strong} of ${bullets.length} bullets open with a strong ownership verb; ${weak} open weakly ("worked on", "helped").`
      : `${strong} of ${bullets.length} bullets open with a strong ownership verb.`;
  return { score, detail };
}

// --- formatting -----------------------------------------------------------

function scoreFormatting(resume: Resume, bullets: ResumeBulletRef[]) {
  // Only things that genuinely break ATS parsing or recruiter search. Notably
  // absent: an education section (senior candidates routinely drop it) and a
  // hard requirement for paid experience (students lead with projects).
  const checks: { ok: boolean; label: string }[] = [
    { ok: Boolean(resume.name?.trim()), label: "name" },
    { ok: Boolean(resume.email?.trim()), label: "email" },
    { ok: Boolean(resume.phone?.trim() || resume.location?.trim()), label: "phone or location" },
    {
      ok: (resume.experience ?? []).length > 0 || (resume.projects ?? []).length > 0,
      label: "experience or projects section",
    },
    { ok: (resume.skills ?? []).length > 0, label: "skills section" },
    { ok: bullets.length > 0, label: "bullet points" },
    // Wall-of-text bullets parse badly and read worse.
    { ok: bullets.every((b) => b.text.length <= 400), label: "bullets under 400 characters" },
    { ok: bullets.every((b) => b.text.trim().length > 0), label: "no empty bullets" },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const failed = checks.filter((c) => !c.ok).map((c) => c.label);
  const detail =
    failed.length === 0
      ? "Structure parses cleanly: all required sections present."
      : `Missing or malformed: ${failed.join(", ")}.`;
  return { score, detail };
}

// --- keyword stuffing -----------------------------------------------------

export type StuffingReport = {
  penalty: number;
  warnings: string[];
  worst: { keyword: string; count: number }[];
};

/**
 * Repetition buys nothing in scoreKeywordMatch, so this exists to actively warn
 * the user (and, via the optimizer's validation loop, to stop the model from
 * producing a resume that trips Workday's density flag in the first place).
 */
export function detectStuffing(text: string, job: JobAnalysis): StuffingReport {
  const keywords = [
    ...(job.requiredKeywords ?? []),
    ...(job.niceToHaveKeywords ?? []),
  ].filter(Boolean);

  const counts = keywords
    .map((keyword) => ({ keyword, count: countOccurrences(text, keyword) }))
    .filter((c) => c.count > MAX_KEYWORD_REPEATS)
    .sort((a, b) => b.count - a.count);

  const warnings = counts.map(
    (c) =>
      `"${c.keyword}" appears ${c.count} times. Workday's 2026 filter flags unnatural keyword density as manipulation — keep it to ${MAX_KEYWORD_REPEATS} or fewer.`,
  );

  // 2 points per excess occurrence, capped so stuffing one term cannot sink the
  // whole score on its own.
  const raw = counts.reduce((sum, c) => sum + (c.count - MAX_KEYWORD_REPEATS) * 2, 0);
  const penalty = Math.min(15, raw);

  return { penalty, warnings, worst: counts.slice(0, 5) };
}

// --- public API -----------------------------------------------------------

export type AtsScore = {
  /** 0-100, weighted from the categories below, minus any stuffing penalty. */
  overall: number;
  categories: AtsCategory[];
  matchedKeywords: string[];
  missingKeywords: string[];
  stuffing: StuffingReport;
};

export function scoreResume(resume: Resume, job: JobAnalysis): AtsScore {
  const text = resumeToText(resume);
  const bullets = collectBullets(resume);

  const keyword = scoreKeywordMatch(text, job);
  const title = scoreTitleMatch(resume, job);
  const quantified = scoreQuantified(bullets);
  const verbs = scoreActionVerbs(bullets);
  const formatting = scoreFormatting(resume, bullets);
  const stuffing = detectStuffing(text, job);

  const weighted =
    keyword.score * WEIGHTS.keyword +
    title.score * WEIGHTS.title +
    quantified.score * WEIGHTS.quantified +
    verbs.score * WEIGHTS.actionVerbs +
    formatting.score * WEIGHTS.formatting;

  const overall = Math.max(0, Math.min(100, Math.round(weighted - stuffing.penalty)));

  const categories: AtsCategory[] = [
    { label: "Keyword match", score: keyword.score, detail: keyword.detail },
    { label: "Title match", score: title.score, detail: title.detail },
    { label: "Quantified impact", score: quantified.score, detail: quantified.detail },
    { label: "Action verbs", score: verbs.score, detail: verbs.detail },
    { label: "ATS formatting", score: formatting.score, detail: formatting.detail },
  ];

  return {
    overall,
    categories,
    matchedKeywords: [...keyword.matched, ...keyword.niceMatched],
    missingKeywords: keyword.missing,
    stuffing,
  };
}
