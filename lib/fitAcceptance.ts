// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { FitDensity } from "./resumeFit";
import type { PageOverflowEstimate } from "./pdf/overflow";

export type FitPresetPages = {
  density: FitDensity;
  pageCount: number;
};

/**
 * One measurement of a candidate document: its page count at every density
 * preset, roomiest first, plus how far the densest readable preset still
 * overflows the target when it does.
 */
export type FitMeasurement = {
  /** Page count the export would use for this candidate. */
  pageCount: number;
  density: FitDensity;
  observedPages: number[];
  presets: FitPresetPages[];
  /** Page count at the standard preset (or the only preset, for a measured source layout). */
  standardPages: number;
  /** Page count at the densest readable preset. */
  densestPages: number;
  overflow: PageOverflowEstimate | null;
};

export type FitVerdict =
  | { kind: "fits"; density: FitDensity }
  /** Every preset, even the densest readable one, still needs more pages. */
  | { kind: "overflow"; densestPages: number }
  /**
   * The target is reached only by enlarging type and spacing: at standard
   * typography the content fills fewer pages than asked for, so more content
   * was removed than the target needed.
   */
  | { kind: "over-cut"; standardPages: number }
  /** Nothing reaches the target and the content is short of it everywhere. */
  | { kind: "under"; roomiestPages: number };

const ROOMY_PRESETS: ReadonlySet<FitDensity> = new Set([
  "very-relaxed",
  "relaxed",
]);

function isDense(density: FitDensity): boolean {
  return !ROOMY_PRESETS.has(density);
}

/**
 * Whether a candidate meets the page target without cheating.
 *
 * Unchanged content (`allowRoomy`) may reach the target at any preset: nothing
 * was removed, so a roomier page is an honest result. A compressed plan must
 * reach it at the standard preset or a denser one. If only the enlarged
 * presets land on the target, the plan cut more than the target needed and
 * the caller should restore content rather than ship a sparse page.
 */
export function judgeFit(
  measurement: FitMeasurement,
  targetPages: number,
  { allowRoomy = false }: { allowRoomy?: boolean } = {},
): FitVerdict {
  const hits = measurement.presets.filter(
    (preset) => preset.pageCount === targetPages,
  );
  const denseHit = hits.some((preset) => isDense(preset.density));
  if (hits.length > 0 && (allowRoomy || denseHit)) {
    // Roomiest preset that reaches the target, so an honest fit is not
    // needlessly squeezed.
    return { kind: "fits", density: hits[0].density };
  }
  if (measurement.densestPages > targetPages) {
    return { kind: "overflow", densestPages: measurement.densestPages };
  }
  const roomiestPages = measurement.presets[0]?.pageCount ?? measurement.pageCount;
  if (roomiestPages < targetPages) {
    return { kind: "under", roomiestPages };
  }
  return { kind: "over-cut", standardPages: measurement.standardPages };
}
