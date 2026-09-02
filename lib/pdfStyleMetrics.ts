// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Measures a source PDF's own typography and page geometry.
//
// The "Original-inspired" style used to get these numbers by showing a vision
// model a 150 DPI screenshot and asking it to "estimate sizes in print points".
// That threw away data we already hold: pdf.js hands us every text run's
// transform, width, and font, so the body size, heading size, line height and
// margins are all measurable rather than guessable. A resume set in 9.5pt
// Times at 1.1 line height came back as 11pt Helvetica at 1.4 — enough drift
// to push a one-page resume onto two.
//
// Vision keeps the job it is actually good at: reading the page's region
// structure. Numbers come from here.

import type { ResumePageSpec, ResumeStyleMetrics } from "./types";

/** The shape of a pdf.js text item; typed structurally to avoid its types. */
type TextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
};

// pdf.js interleaves marked-content markers with the text runs, so the array
// is genuinely a union and each entry has to be narrowed rather than cast.
type TextContent = {
  items: readonly unknown[];
  /** pdf.js resolves each font to a CSS-ish family, e.g. "serif". */
  styles?: Record<string, { fontFamily?: string } | undefined>;
};

function asTextItem(value: unknown): TextItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as TextItem;
  return typeof item.str === "string" ? item : null;
}

export type MeasurablePdfPage = {
  getTextContent(): Promise<TextContent>;
};

type Run = {
  text: string;
  chars: number;
  size: number;
  x: number;
  /** Baseline y in PDF user space, which counts up from the page bottom. */
  y: number;
  width: number;
  serif: boolean | null;
};

// "sans-serif" contains "serif", so the sans test has to run first.
const SANS_HINTS =
  /sans[-\s]?serif|helvetica|arial|calibri|verdana|tahoma|segoe|roboto|lato|futura|frutiger|gill\s?sans|avenir|inter|nimbus\s?sans/i;
const SERIF_HINTS =
  /\bserif\b|times|georgia|garamond|roman|minion|cambria|palatino|utopia|charter|caslon|baskerville|bookman|century|cormorant/i;

function isSerifFamily(family: string | undefined): boolean | null {
  if (!family) return null;
  if (SANS_HINTS.test(family)) return false;
  if (SERIF_HINTS.test(family)) return true;
  return null;
}

/**
 * pdf.js gives an unrotated run the transform [size, 0, 0, size, x, y].
 * Taking the hypotenuse keeps the answer right for rotated text too, and
 * `height` is the fallback because some producers emit a degenerate matrix.
 */
function runSize(item: TextItem): number {
  const transform = item.transform;
  if (transform && transform.length >= 4) {
    const size = Math.hypot(transform[1] ?? 0, transform[3] ?? 0);
    if (size > 0.5) return size;
  }
  return typeof item.height === "number" && item.height > 0.5 ? item.height : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Quarter-point buckets: finer than the eye, coarser than float noise. */
function bucket(size: number): number {
  return Math.round(size * 4) / 4;
}

/** The bucket holding the most characters — the text the page is made of. */
function dominantSize(runs: readonly Run[]): number {
  const weight = new Map<number, number>();
  for (const run of runs) {
    const key = bucket(run.size);
    weight.set(key, (weight.get(key) ?? 0) + run.chars);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, chars] of weight) {
    if (chars > bestWeight) {
      best = size;
      bestWeight = chars;
    }
  }
  return best;
}

function isHeadingLike(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase();
}

const LEADING_BULLET = /^\s*[•▪●◦⁃∙·‣*]/;

type Line = { y: number; text: string };

/** Runs sharing a baseline are one visual line, in reading order. */
function toLines(runs: readonly Run[]): Line[] {
  const byBaseline = new Map<number, Run[]>();
  for (const run of runs) {
    const key = Math.round(run.y * 2) / 2;
    const bucket = byBaseline.get(key);
    if (bucket) bucket.push(run);
    else byBaseline.set(key, [run]);
  }
  return [...byBaseline.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([y, items]) => ({
      y,
      text: items
        .sort((left, right) => left.x - right.x)
        .map((item) => item.text)
        .join(""),
    }));
}

/**
 * Section, entry and bullet spacing, as the extra distance each one adds on
 * top of a normal line advance.
 *
 * This is the measurement that matters most for whether a resume still fits
 * its original page. Plenty of dense resumes put *no* extra space between
 * bullets at all — the gap above a new bullet is just the line height — while
 * an estimate almost always assumes a few points of breathing room. Twenty-odd
 * bullets later that assumption is worth a fifth of a page.
 */
function measureSpacing(
  lines: readonly Line[],
  lineGap: number,
): ResumeStyleMetrics["spacing"] | null {
  if (lineGap <= 0 || lines.length < 8) return null;
  const section: number[] = [];
  const entry: number[] = [];
  const bullet: number[] = [];
  // Anything beyond this is a column break or a deliberate block of air, not
  // the rhythm of the document.
  const ceiling = lineGap * 4;

  for (let index = 0; index + 1 < lines.length; index += 1) {
    const gap = lines[index].y - lines[index + 1].y;
    if (gap <= 0 || gap > ceiling) continue;
    const following = lines[index + 1].text;
    if (isHeadingLike(following)) section.push(gap);
    else if (LEADING_BULLET.test(following)) bullet.push(gap);
    // A larger-than-normal gap before ordinary text starts a new entry; an
    // ordinary gap there is just the previous line wrapping.
    else if (gap > lineGap * 1.12) entry.push(gap);
  }

  const extra = (gaps: number[], fallback: number) =>
    gaps.length >= 2 ? Math.max(0, median(gaps) - lineGap) : fallback;
  const entryPt = extra(entry, 0);
  return {
    sectionPt: extra(section, entryPt),
    entryPt,
    bulletPt: extra(bullet, 0),
  };
}

/**
 * Line height as a multiple of the body size, from the gaps between adjacent
 * baselines. Gaps far outside a plausible leading range are section breaks or
 * column jumps, not line advances.
 */
function measureLineHeight(runs: readonly Run[], bodyPt: number): number | null {
  if (bodyPt <= 0) return null;
  const baselines = [
    ...new Set(runs.map((run) => Math.round(run.y * 2) / 2)),
  ].sort((left, right) => right - left);
  const gaps: number[] = [];
  for (let index = 0; index + 1 < baselines.length; index += 1) {
    const gap = baselines[index] - baselines[index + 1];
    if (gap >= bodyPt * 0.7 && gap <= bodyPt * 2.4) gaps.push(gap);
  }
  if (gaps.length < 4) return null;
  return median(gaps) / bodyPt;
}

export async function measurePdfStyle(
  page: MeasurablePdfPage,
  spec: ResumePageSpec,
): Promise<ResumeStyleMetrics | null> {
  let content: TextContent;
  try {
    content = await page.getTextContent();
  } catch {
    return null;
  }

  const runs: Run[] = [];
  for (const candidate of content.items ?? []) {
    const item = asTextItem(candidate);
    if (!item) continue;
    const text = item.str ?? "";
    const chars = text.trim().length;
    if (chars === 0) continue;
    const size = runSize(item);
    if (size <= 0) continue;
    const transform = item.transform ?? [];
    runs.push({
      text,
      chars,
      size,
      x: transform[4] ?? 0,
      y: transform[5] ?? 0,
      width: typeof item.width === "number" ? item.width : 0,
      serif: isSerifFamily(
        item.fontName ? content.styles?.[item.fontName]?.fontFamily : undefined,
      ),
    });
  }

  // A scanned page, or one whose text layer is a handful of stray glyphs, has
  // nothing to measure. Saying so lets the caller keep the estimate instead of
  // adopting a number derived from noise.
  const totalChars = runs.reduce((sum, run) => sum + run.chars, 0);
  if (runs.length < 20 || totalChars < 200) return null;

  const bodyPt = dominantSize(runs);
  if (bodyPt <= 0) return null;

  // The name is the largest real word on the page; a lone oversized glyph
  // (a decorative rule or icon) is not a candidate.
  const namePt = runs.reduce(
    (largest, run) => (run.chars >= 3 ? Math.max(largest, run.size) : largest),
    0,
  );

  // Section headings are the uppercase runs that are not the name. Measuring
  // them separately matters because plenty of resumes set headings at body
  // size and lean on weight and caps alone — a model looking at a picture
  // reliably reads that as "bigger".
  const headingRuns = runs.filter(
    (run) => isHeadingLike(run.text) && bucket(run.size) < bucket(namePt),
  );
  const sectionPt = headingRuns.length >= 2 ? dominantSize(headingRuns) : bodyPt;

  // Dates and locations: the largest body-adjacent size below the body text.
  const smallRuns = runs.filter((run) => bucket(run.size) < bucket(bodyPt));
  const smallChars = smallRuns.reduce((sum, run) => sum + run.chars, 0);
  const metaPt =
    smallChars > totalChars * 0.04 ? dominantSize(smallRuns) : bodyPt;

  // A title line sits between the name and the body, above the contact row.
  const titleRuns = runs.filter(
    (run) =>
      bucket(run.size) > bucket(bodyPt) && bucket(run.size) < bucket(namePt),
  );
  const titlePt = titleRuns.length > 0 ? dominantSize(titleRuns) : bodyPt;

  const left = Math.min(...runs.map((run) => run.x));
  const right =
    spec.widthPt - Math.max(...runs.map((run) => run.x + run.width));
  // Baselines sit above the glyph's bottom, so the top edge is approximated by
  // the tallest run's ascent and the bottom by its descent.
  const top = spec.heightPt - Math.max(...runs.map((run) => run.y + run.size));
  const bottom = Math.min(...runs.map((run) => run.y)) - bodyPt * 0.25;

  const serifChars = runs
    .filter((run) => run.serif === true)
    .reduce((sum, run) => sum + run.chars, 0);
  const sansChars = runs
    .filter((run) => run.serif === false)
    .reduce((sum, run) => sum + run.chars, 0);
  const serif =
    serifChars === sansChars ? null : serifChars > sansChars;

  const lineHeight = measureLineHeight(runs, bodyPt);
  const spacing =
    lineHeight === null
      ? null
      : measureSpacing(toLines(runs), lineHeight * bodyPt);

  return {
    bodyPt,
    namePt: namePt > bodyPt ? namePt : bodyPt,
    titlePt,
    sectionPt,
    metaPt,
    lineHeight,
    spacing,
    marginsPt: {
      top: Math.max(0, top),
      right: Math.max(0, right),
      bottom: Math.max(0, bottom),
      left: Math.max(0, left),
    },
    serif,
    sampledChars: totalChars,
  };
}
