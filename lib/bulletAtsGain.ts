// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Does a rewrite of one bullet move the deterministic ATS rubric, without
// changing what the bullet claims?
//
// The content reviewer judges writing, and it is told to ignore keyword
// counts and verb strength. That is right for content, but it meant a rewrite
// whose only change was "Helped prepare email campaigns" -> "Prepared email
// campaigns", or "REST endpoints" -> the posting's "API development", was
// retained as cosmetic and the source shipped — and the "Action verbs" and
// "Keyword match" categories, which are exactly those two changes, never
// moved. On the uplift corpus 9 of 14 bullets shipped as source text.
//
// This detects the two mechanical gains the rubric pays for. It is only ever
// consulted for a rewrite the reviewer has already certified as supported,
// detail-preserving and causality-preserving. The audit is what keeps this
// honest; the ownership denylist below is a second lock on the one failure
// that audit is most likely to miss, "Assisted with reviews" -> "Owned
// strategy", which must never ship on the strength of its verb.
import { cjkOpener, countOccurrences, openerStrength, type OpenerStrength } from "./atsScore.ts";
import type { JobAnalysis } from "./types";

const RANK: Record<OpenerStrength, number> = { weak: 0, neutral: 1, strong: 2 };

// Verbs that assert a level of responsibility. A candidate may open with one
// only when the source already uses that verb somewhere.
const OWNERSHIP_VERBS = new Set([
  "led", "lead", "owned", "own", "managed", "manage", "directed", "direct",
  "headed", "head", "oversaw", "oversee", "architected", "architect",
  "spearheaded", "spearhead", "drove", "drive", "championed", "champion",
  "founded", "found", "established", "establish", "ran", "run",
  "主导", "带领", "牵头", "统筹", "领导", "管理", "创立", "负责人",
]);

// "prepare" / "prepared" / "preparing" -> "prepar"; "add" / "added" -> "add".
function verbStem(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  const trimmed = w.replace(/(?:ing|ed|es|s)$/, "");
  return trimmed.replace(/e$/, "");
}

/** The opener the verb scorer will judge: an English first word or a Chinese
 *  leading verb. */
function openerWord(text: string): string {
  const cjk = cjkOpener(text);
  if (cjk) return cjk.verb;
  return (text.trim().split(/[\s,]+/)[0] ?? "").replace(/[^A-Za-z]/g, "");
}

function sourceUsesVerb(source: string, verb: string): boolean {
  if (/\p{Script=Han}/u.test(verb)) return source.includes(verb);
  const stem = verbStem(verb);
  return source
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => word && verbStem(word) === stem);
}

export function bulletAtsGain({
  source,
  candidate,
  job,
}: {
  source: string;
  candidate: string;
  job?: Pick<JobAnalysis, "requiredKeywords" | "niceToHaveKeywords"> | null;
}): string | null {
  const gains: string[] = [];

  const first = openerWord(candidate);
  if (
    first &&
    RANK[openerStrength(candidate)] > RANK[openerStrength(source)] &&
    !(OWNERSHIP_VERBS.has(first.toLowerCase()) && !sourceUsesVerb(source, first))
  ) {
    gains.push(`opens with an action verb ("${first}") the verb check rewards`);
  }

  const keywords = [
    ...new Set(
      [...(job?.requiredKeywords ?? []), ...(job?.niceToHaveKeywords ?? [])].filter(Boolean),
    ),
  ];
  const added = keywords.filter(
    (keyword) => countOccurrences(candidate, keyword) > 0 && countOccurrences(source, keyword) === 0,
  );
  if (added.length > 0) {
    gains.push(`names the posting's own term${added.length > 1 ? "s" : ""} ${added.map((k) => `"${k}"`).join(", ")}`);
  }

  return gains.length > 0 ? gains.join(" and ") : null;
}
