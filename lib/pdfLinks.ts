// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Recovers hyperlink targets from a PDF's annotation layer and pairs each one
// with the text sitting under it. A resume header that shows only the word
// "LinkedIn", or a bare icon, keeps its URL nowhere else — the text layer has
// no idea the link exists — so text extraction alone always loses it.
import type { ResumeLink } from "./resumeLinks.ts";
import { labelForUrl, normalizeLinkUrl, dedupeResumeLinks } from "./resumeLinks.ts";

export type PdfLinkAnnotation = {
  /** [x1, y1, x2, y2] in PDF user space; corners may be in any order. */
  rect?: number[];
  url?: string;
  subtype?: string;
};

export type PositionedTextItem = {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
};

type Box = { left: number; right: number; bottom: number; top: number };

function normalizeRect(rect: readonly number[]): Box | null {
  if (rect.length < 4) return null;
  const [x1, y1, x2, y2] = rect;
  if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) return null;
  return {
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    bottom: Math.min(y1, y2),
    top: Math.max(y1, y2),
  };
}

// Trimmed from a clipped label: the separators a contact line puts between
// its fields, which a proportional cut can leave dangling at either end.
const EDGE_NOISE = /^[\s·•|,;/–—-]+|[\s·•|,;/–—-]+$/g;

/**
 * The text layer combines adjacent runs, so one item routinely spans well
 * past a single link — a contact line can arrive as "A · LinkedIn ·" in one
 * piece. Taking such an item whole would label the link with its neighbours,
 * so the portion actually sitting inside the rectangle is clipped out by
 * proportional width. An item that fits entirely inside is taken as is.
 */
function clipToBox(item: PositionedTextItem, box: Box): string {
  const transform = item.transform;
  if (!transform || transform.length < 6) return "";
  const text = item.str ?? "";
  const x = transform[4];
  const y = transform[5];
  const width = Math.max(0, item.width ?? 0);
  const height = Math.max(6, item.height ?? Math.abs(transform[3] ?? 8));
  // A link rectangle is drawn around the whole word, a little below the
  // baseline and above the cap height, so the baseline needs tolerance.
  const tolerance = Math.max(2, height * 0.6);
  if (y < box.bottom - tolerance || y > box.top + tolerance) return "";
  if (x > box.right + 1 || x + width < box.left - 1) return "";
  if (!text || width <= 0) return text;
  if (x >= box.left - 1 && x + width <= box.right + 1) return text;

  const startRatio = Math.max(0, (box.left - x) / width);
  const endRatio = Math.min(1, (box.right - x) / width);
  if (endRatio <= startRatio) return "";
  const start = startRatio * text.length;
  const end = endRatio * text.length;
  // Glyph widths are not uniform, so the proportional cut lands a character
  // or two off and would otherwise leave "t thing" where "thing" was linked.
  // Whole words decide it: a word counts as linked when at least half of it
  // falls inside the rectangle.
  let label = "";
  for (const match of text.matchAll(/\S+/g)) {
    const wordStart = match.index ?? 0;
    const wordEnd = wordStart + match[0].length;
    const inside =
      Math.min(end, wordEnd) - Math.max(start, wordStart);
    if (inside >= Math.max(0.5, match[0].length / 2)) {
      label += `${label ? " " : ""}${match[0]}`;
    }
  }
  return label;
}

/**
 * Pairs each link annotation with the text underneath it. An annotation with
 * no text of its own — an icon, or a link drawn over an image — still yields
 * a usable entry labelled from its URL.
 */
export function pairLinkAnnotations(
  annotations: readonly PdfLinkAnnotation[],
  items: readonly PositionedTextItem[],
): ResumeLink[] {
  const links: ResumeLink[] = [];
  for (const annotation of annotations) {
    if (annotation.subtype && annotation.subtype !== "Link") continue;
    const url = annotation.url ? normalizeLinkUrl(annotation.url) : undefined;
    if (!url || !annotation.rect) continue;
    const box = normalizeRect(annotation.rect);
    if (!box) continue;
    const covered = items
      .filter((item) => item.str?.trim())
      .sort(
        (left, right) =>
          (left.transform?.[4] ?? 0) - (right.transform?.[4] ?? 0),
      )
      .map((item) => clipToBox(item, box))
      .join("")
      .replace(/\s+/g, " ")
      .replace(EDGE_NOISE, "")
      .trim();
    links.push({ label: covered || labelForUrl(url), url });
  }
  return dedupeResumeLinks(links);
}
