// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Maps optimized resume text back to the exact source unit it came from — a
// Word paragraph or a LaTeX text block; the problem is identical either way,
// so both formats share this one implementation.
//
// Deliberately deterministic rather than model-driven: writing a rewritten
// bullet into the wrong place would corrupt the user's document, so an
// uncertain match is dropped instead of guessed. Anything unmatched simply
// keeps its original wording.

/** The minimum a source unit must expose to be aligned against. */
export type AlignSource = {
  index: number;
  text: string;
};

export type AlignTarget = {
  /** Resume-side identifier, e.g. a bullet id like "b7". */
  id: string;
  /** Verbatim source text as parsed from the document. */
  text: string;
};

export type AlignedTarget = {
  id: string;
  paragraphIndex: number;
  /** 1 for an exact normalized match, otherwise the similarity score. */
  confidence: number;
};

export type AlignmentResult = {
  matched: AlignedTarget[];
  /** Target ids with no confident paragraph; these are never rewritten. */
  unmatched: string[];
};

/** Below this, a fuzzy match is treated as no match at all. */
export const MINIMUM_CONFIDENCE = 0.9;

const LEADING_BULLET = /^[\s•▪●◦⁃∙*\-–—·]+/;

export function normalizeParagraphText(value: string): string {
  return value
    .replace(LEADING_BULLET, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i += 1) {
    const pair = value.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice over character bigrams: order-tolerant, length-normalized. */
export function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let shared = 0;
  for (const [gram, count] of leftGrams) {
    shared += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  return (2 * shared) / (left.length - 1 + (right.length - 1));
}

export function alignToParagraphs(
  targets: readonly AlignTarget[],
  paragraphs: readonly AlignSource[],
  minimumConfidence: number = MINIMUM_CONFIDENCE,
): AlignmentResult {
  const normalizedParagraphs = paragraphs.map((paragraph) => ({
    index: paragraph.index,
    normalized: normalizeParagraphText(paragraph.text),
  }));
  const exact = new Map<string, number[]>();
  for (const paragraph of normalizedParagraphs) {
    if (!paragraph.normalized) continue;
    const bucket = exact.get(paragraph.normalized);
    if (bucket) bucket.push(paragraph.index);
    else exact.set(paragraph.normalized, [paragraph.index]);
  }

  const claimed = new Set<number>();
  const matched: AlignedTarget[] = [];
  const unmatched: string[] = [];
  const pending: AlignTarget[] = [];

  // Exact matches first and across all targets, so a duplicated line can
  // never steal the paragraph that an unambiguous target needs.
  for (const target of targets) {
    const normalized = normalizeParagraphText(target.text);
    if (!normalized) {
      unmatched.push(target.id);
      continue;
    }
    const candidates = (exact.get(normalized) ?? []).filter(
      (index) => !claimed.has(index),
    );
    if (candidates.length === 0) {
      pending.push(target);
      continue;
    }
    // Resume bullets keep document order, so the earliest free duplicate is
    // the right one.
    const chosen = candidates[0];
    claimed.add(chosen);
    matched.push({ id: target.id, paragraphIndex: chosen, confidence: 1 });
  }

  for (const target of pending) {
    const normalized = normalizeParagraphText(target.text);
    let best: { index: number; score: number } | null = null;
    for (const paragraph of normalizedParagraphs) {
      if (claimed.has(paragraph.index) || !paragraph.normalized) continue;
      const score = similarity(normalized, paragraph.normalized);
      if (!best || score > best.score) {
        best = { index: paragraph.index, score };
      }
    }
    if (!best || best.score < minimumConfidence) {
      unmatched.push(target.id);
      continue;
    }
    claimed.add(best.index);
    matched.push({
      id: target.id,
      paragraphIndex: best.index,
      confidence: best.score,
    });
  }

  return { matched, unmatched };
}
