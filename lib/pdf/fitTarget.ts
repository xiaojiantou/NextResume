// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { FitDensity } from "../resumeFit";
import type { Resume } from "../types";

export type FitCandidatePages = {
  pageCount: number;
  density: FitDensity;
};

/** Page count the uploaded resume had, when the parse recorded one. */
export function sourcePageCount(resume: Resume): number | null {
  const count =
    resume.sourceLayout?.pageCount ?? resume.structureManifest?.pageCount;
  return Number.isInteger(count) && (count as number) >= 1
    ? (count as number)
    : null;
}

/**
 * Page count an "auto" export should aim for, given one render per density
 * preset (ordered roomiest first).
 *
 * The standard preset's own page count is the baseline. But a resume the user
 * kept to N pages should not come back one page longer just because the
 * standard preset runs a few lines over: when a denser preset still lands on
 * the source's page count, that count wins. A source that was longer than the
 * standard render never pads the output back up.
 */
export function resolveAutoPageTarget(
  candidates: readonly FitCandidatePages[],
  sourcePages: number | null | undefined,
): number {
  const standard =
    candidates.find((candidate) => candidate.density === "standard") ??
    candidates[0];
  if (!standard) return 1;
  if (
    !sourcePages ||
    !Number.isInteger(sourcePages) ||
    sourcePages < 1 ||
    sourcePages >= standard.pageCount
  ) {
    return standard.pageCount;
  }
  return candidates.some((candidate) => candidate.pageCount === sourcePages)
    ? sourcePages
    : standard.pageCount;
}
