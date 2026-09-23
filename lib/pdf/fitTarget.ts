// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { FitDensity } from "../resumeFit";
import type { Resume } from "../types";
import type { PageOverflowEstimate } from "./overflow";

export type FitCandidatePages = {
  pageCount: number;
  density: FitDensity;
};

/**
 * Page count the uploaded resume had, when the parse actually measured one.
 *
 * A PDF's coordinate pass records the real count. A .tex or .docx upload has
 * no page geometry, and the parser fills in a linear-text layout with a
 * placeholder count of 1: that is not a one-page resume, it is an unknown.
 */
export function sourcePageCount(resume: Resume): number | null {
  const layout = resume.sourceLayout;
  if (layout) {
    if (layout.parser === "linear-text" && layout.pages.length === 0) {
      return null;
    }
    return Number.isInteger(layout.pageCount) && layout.pageCount >= 1
      ? layout.pageCount
      : null;
  }
  const manifest = resume.structureManifest;
  if (manifest && manifest.parser !== "linear-text") {
    return Number.isInteger(manifest.pageCount) && manifest.pageCount >= 1
      ? manifest.pageCount
      : null;
  }
  return null;
}

/** An extra page whose spill-over is this small is not worth keeping. */
export const SQUEEZE_PAGE_FILL = 0.5;

/**
 * Page count an "auto" export should aim for, given one render per density
 * preset (ordered roomiest first).
 *
 * The standard preset's own page count is the baseline. But a resume the user
 * kept to N pages should not come back one page longer just because the
 * standard preset runs a few lines over: when a denser preset still lands on
 * the source's page count, that count wins. A source that was longer than the
 * standard render never pads the output back up.
 *
 * When the source's page count is unknown, `standardSpill` says how much of
 * the standard render lands on its last page. A final page that is less than
 * half full is squeezed away whenever a denser preset can do it.
 */
export function resolveAutoPageTarget(
  candidates: readonly FitCandidatePages[],
  sourcePages: number | null | undefined,
  standardSpill?: PageOverflowEstimate | null,
): number {
  const standard =
    candidates.find((candidate) => candidate.density === "standard") ??
    candidates[0];
  if (!standard) return 1;
  const reachable = (pages: number) =>
    candidates.some((candidate) => candidate.pageCount === pages);
  if (sourcePages && Number.isInteger(sourcePages) && sourcePages >= 1) {
    if (sourcePages >= standard.pageCount) return standard.pageCount;
    return reachable(sourcePages) ? sourcePages : standard.pageCount;
  }
  if (
    standard.pageCount > 1 &&
    standardSpill &&
    standardSpill.overflowLines > 0 &&
    standardSpill.overflowFraction < SQUEEZE_PAGE_FILL &&
    reachable(standard.pageCount - 1)
  ) {
    return standard.pageCount - 1;
  }
  return standard.pageCount;
}
