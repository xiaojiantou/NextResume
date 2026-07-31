// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Safety net for the JD keyword extraction in /api/parse-job.
//
// Scoring is literal now (see lib/atsScore.ts), so a junk keyword is not a
// rounding error — it is a guaranteed miss that costs the candidate real
// points and prints misleading advice. The old LLM scorer smoothed this over
// with a holistic judgement; a string match cannot.
//
// Observed failure on a real Volvo Financial Services posting: the model
// returned "documentation", "collaboration", "continuous improvement",
// "testing and validation", "Computer Science degree", and "2.75 GPA". The
// first four are the posting's own bolded section labels; the last two are
// eligibility criteria the candidate actually met (MS CS, 4.0 GPA) but could
// never match as literal strings.
//
// Two causes, fixed in two places: the prompt's "6-15 items" quota pushed the
// model to pad a thin JD with scavenged headings (fixed in the prompt), and
// nothing validated the output (fixed here).

/**
 * Words that carry no search signal on their own. A phrase built entirely from
 * these is a job-description heading or a soft skill, not something a
 * candidate would list under "Skills".
 */
const GENERIC_TOKENS = new Set([
  "documentation", "document", "collaboration", "collaborate", "collaborative",
  "communication", "communicate", "teamwork", "team", "testing", "validation",
  "verification", "improvement", "improve", "continuous", "problem", "problems",
  "solving", "detail", "details", "oriented", "critical", "thinking",
  "leadership", "adaptability", "creativity", "curiosity", "curious",
  "ownership", "organized", "organization", "mentoring", "mentorship",
  "knowledge", "sharing", "passion", "passionate", "experience", "experienced",
  "skills", "skill", "ability", "abilities", "strong", "excellent", "solid",
  "understanding", "practices", "workflows", "workflow", "solutions",
  "solution", "initiatives", "activities", "tasks", "responsibilities",
  "requirements", "stakeholder", "stakeholders", "quality", "support",
  "maintenance", "process", "processes", "functional", "cross", "interpersonal",
  "motivated", "proactive", "independent", "reliable", "flexible", "learning",
  "learn", "growth", "mindset", "culture", "values", "benefits", "hours",
  "hour", "week", "weekly", "salary", "compensation", "onsite", "hybrid",
  "remote", "travel", "attention", "per", "years", "year",
  "and", "or", "of", "the", "a", "an", "with", "in", "to", "for", "on",
]);

/** Eligibility and logistics, never a searchable skill. */
const ELIGIBILITY_PATTERNS = [
  /\bgpa\b/i,
  /\bdegree\b/i,
  /\bdiploma\b/i,
  /\bsemester\b/i,
  /\bcredit hours?\b/i,
  /\b(bachelor|master|phd|doctorate|undergraduate|graduate)('s)?\b/i,
  /\benrolled\b/i,
  /\baccredited\b/i,
  /\bmust\b/i,
  /\bauthoriz(ed|ation)\b/i,
  /\bvisa\b/i,
  /\bcitizen(ship)?\b/i,
  /\bclearance\b/i,
  /\bequal opportunity\b/i,
  /\b\d+\.\d+\b/, // "2.75", i.e. a GPA threshold
];

/** Longer than this and it is a sentence fragment, not a keyword. */
const MAX_WORDS = 4;

/**
 * Nouns a job description bolts onto a real term to form a section heading:
 * "AI Development", "Generative AI Solutions", "AI-powered applications". The
 * heading is not searchable but the term inside it is, so strip the suffix
 * rather than dropping the whole phrase.
 *
 * Deliberately excludes "engineering", "systems", "analysis", and "learning" —
 * "prompt engineering", "distributed systems", "data analysis", and "machine
 * learning" are all terms recruiters really search for.
 */
const TRAILING_ACTIVITY_NOUNS = new Set([
  "development", "solutions", "solution", "initiatives", "initiative",
  "activities", "capabilities", "capability", "tools", "applications",
  "technologies", "efforts", "work", "projects",
]);

/** Strips heading suffixes: "AI Development" -> "AI". */
function stripActivitySuffix(keyword: string): string {
  const words = keyword.trim().split(/\s+/);
  if (words.length < 2) return keyword;
  const last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (!TRAILING_ACTIVITY_NOUNS.has(last)) return keyword;
  return words.slice(0, -1).join(" ");
}

function tokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** True when the phrase is a heading, a soft skill, or eligibility boilerplate. */
export function isNoiseKeyword(keyword: string): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return true;

  if (ELIGIBILITY_PATTERNS.some((re) => re.test(trimmed))) return true;

  const parts = tokens(trimmed);
  if (parts.length === 0) return true;
  if (parts.length > MAX_WORDS) return true;

  // Every meaningful token is generic -> the phrase carries no search signal.
  // "data analysis" survives ("data" is specific); "testing and validation"
  // does not. A bare number counts as generic so "40 hours per week" drops,
  // while "5+ years" survives on the "5+" token.
  return parts.every((t) => GENERIC_TOKENS.has(t) || /^\d+$/.test(t));
}

/**
 * Drops noise and case-insensitive duplicates, preserving the model's ordering
 * (it tends to emit the most important terms first).
 */
export function sanitizeKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    if (typeof raw !== "string") continue;
    const cleaned = stripActivitySuffix(raw.trim().replace(/\s+/g, " "));
    if (isNoiseKeyword(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

export type SanitizableJob = {
  requiredKeywords?: unknown;
  niceToHaveKeywords?: unknown;
};

/**
 * Sanitizes both keyword lists and removes any nice-to-have that also appears
 * as a hard requirement, so a term is never scored twice.
 */
export function sanitizeJobKeywords<T extends SanitizableJob>(job: T): T {
  const required = sanitizeKeywords(job.requiredKeywords);
  const requiredKeys = new Set(required.map((k) => k.toLowerCase()));
  const nice = sanitizeKeywords(job.niceToHaveKeywords).filter(
    (k) => !requiredKeys.has(k.toLowerCase()),
  );
  return { ...job, requiredKeywords: required, niceToHaveKeywords: nice };
}
