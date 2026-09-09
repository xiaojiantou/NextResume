// Copyright (c) 2026 HowBe LLC. All rights reserved.

// What a rewrite of the SAME experience can reach on the deterministic rubric.
//
// This used to promise more than the optimizer is allowed to deliver: it
// projected "Quantified impact" closing 30% of its gap while the rewrite
// prompt forbids introducing any number the source lacks, and it projected
// "Action verbs" at 90 for resumes in a script the verb scorer cannot read,
// which the verb scorer can never mark as strong. Measured on the uplift
// corpus, that formula overshot the re-scored result by ~10 points. Every rule
// below corresponds to something the pipeline actually does.
import { WEIGHTS, collectBullets } from "./atsScore.ts";
import type { AtsCategory, Resume } from "./types";

/** Share of a category's remaining gap a rewrite can close by weaving in
 *  keywords the experience already supports. */
export const KEYWORD_GAP_SHARE = 0.4;

/** Ceiling for projected action-verb score: rewrites reopen most bullets
 *  with an ownership verb, not every one. */
export const ACTION_VERB_CEILING = 85;

function weightOf(label: string): number {
  switch (label) {
    case "Keyword match":
      return WEIGHTS.keyword;
    case "Title match":
      return WEIGHTS.title;
    case "Quantified impact":
      return WEIGHTS.quantified;
    case "Action verbs":
      return WEIGHTS.actionVerbs;
    default:
      return WEIGHTS.formatting;
  }
}

// The verb scorer recognises English openers ("-ed" or an irregular list) and
// Chinese ones (a verb list). A bullet in any other script stays neutral no
// matter how it is written, so it cannot be projected upward.
function scorableOpenerShare(resume: Resume): number {
  const bullets = collectBullets(resume);
  if (bullets.length === 0) return 0;
  const scorable = bullets.filter((b) =>
    /^(?:[A-Za-z]|(?:我还|我也|本人|我|并|及)?\s*\p{Script=Han})/u.test(b.text.trim()),
  ).length;
  return scorable / bullets.length;
}

export function projectAfter(
  categories: AtsCategory[],
  resume: Resume,
  overallBefore: number,
): { overallAfter: number; categoriesAfter: AtsCategory[] } {
  const close = (score: number, share: number) =>
    Math.round(score + (100 - score) * share);
  const latinShare = scorableOpenerShare(resume);

  const categoriesAfter = categories.map((c) => {
    switch (c.label) {
      case "Title match":
        // The rewrite sets the headline to the posting's title in both
        // structure modes; it is one line of text under the name.
        return {
          ...c,
          score: 100,
          detail: "Achievable by matching the headline to the posting's title.",
        };
      case "Action verbs": {
        // English and Chinese bullets can be reopened with an action verb the
        // scorer recognises; bullets in other scripts keep their neutral credit.
        const reachable = Math.round(
          (latinShare + (1 - latinShare) * 0.5) * 100,
        );
        const score = Math.max(c.score, Math.min(ACTION_VERB_CEILING, reachable));
        return {
          ...c,
          score,
          detail:
            score > c.score
              ? "Achievable by reopening each bullet with an ownership verb."
              : "Unchanged: the verb check only recognises English and Chinese openers.",
        };
      }
      case "Keyword match":
        return {
          ...c,
          score: close(c.score, KEYWORD_GAP_SHARE),
          detail:
            "Partly achievable — only keywords your experience already supports can be added.",
        };
      case "Quantified impact":
        // The rewrite never introduces a number the source lacks, so this
        // category cannot move.
        return {
          ...c,
          detail:
            "Unchanged: we never add a metric your resume does not already state.",
        };
      default:
        return c;
    }
  });

  const weighted = Math.round(
    categoriesAfter.reduce((sum, c) => sum + c.score * weightOf(c.label), 0),
  );
  // The optimizer never ships below the source score, so neither does the
  // projection (a stuffing penalty can pull the source below its own rubric).
  const overallAfter = Math.max(overallBefore, Math.min(100, weighted));
  return { overallAfter, categoriesAfter };
}
