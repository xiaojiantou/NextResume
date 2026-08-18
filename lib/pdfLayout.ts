// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { ResumeSourceLayout } from "./types";
import type { ResumeLink } from "./resumeLinks.ts";
import { dedupeResumeLinks } from "./resumeLinks.ts";
import { pairLinkAnnotations, type PdfLinkAnnotation } from "./pdfLinks.ts";

export type PdfTextItem = {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
};

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutPage = ResumeSourceLayout["pages"][number] & {
  readingOrderText: string;
};

/**
 * A null split means "no second column", but that answer is only worth acting
 * on when the geometry was legible. Too little text, or a file that emits one
 * positioned item per character, is "cannot tell" — and the two must not be
 * confused, because the expensive visual check exists precisely for the
 * cases we cannot decide here.
 */
type ColumnDetection = {
  split: number | null;
  confident: boolean;
};

export type PdfLayoutExtraction = {
  text: string;
  layout: ResumeSourceLayout;
  /** Hyperlink targets recovered from the annotation layer, in page order. */
  links: ResumeLink[];
};

const PRIVATE_FONT_WARNING = "Warning: Ran out of space in font private use area.";
let warningFilterUsers = 0;
let originalConsoleLog: typeof console.log | null = null;
let filteredConsoleLog: typeof console.log | null = null;

function acquirePdfWarningFilter(): () => void {
  warningFilterUsers += 1;
  if (warningFilterUsers === 1) {
    originalConsoleLog = console.log;
    filteredConsoleLog = (...args: unknown[]) => {
      if (args.length === 1 && args[0] === PRIVATE_FONT_WARNING) return;
      originalConsoleLog?.(...args);
    };
    console.log = filteredConsoleLog;
  }
  return () => {
    warningFilterUsers = Math.max(0, warningFilterUsers - 1);
    if (
      warningFilterUsers === 0 &&
      originalConsoleLog &&
      console.log === filteredConsoleLog
    ) {
      console.log = originalConsoleLog;
      originalConsoleLog = null;
      filteredConsoleLog = null;
    }
  };
}

function lineText(items: PositionedText[]): string {
  const sorted = [...items].sort((left, right) => left.x - right.x);
  let output = "";
  let rightEdge = 0;
  for (const item of sorted) {
    const gap = item.x - rightEdge;
    output += output && gap > Math.max(2, item.height * 0.18) ? " " : "";
    output += item.text;
    rightEdge = Math.max(rightEdge, item.x + item.width);
  }
  return output.replace(/\s+/g, " ").trim();
}

function groupLines(items: PositionedText[]): string[] {
  const lines: Array<{ y: number; height: number; items: PositionedText[] }> = [];
  for (const item of [...items].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const line = lines.find(
      (candidate) =>
        Math.abs(candidate.y - item.y) <= Math.max(2, candidate.height * 0.3),
    );
    if (line) {
      line.items.push(item);
      line.height = Math.max(line.height, item.height);
    } else {
      lines.push({ y: item.y, height: item.height, items: [item] });
    }
  }
  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => lineText(line.items))
    .filter(Boolean);
}

function detectColumnSplit(
  items: PositionedText[],
  width: number,
  height: number,
): ColumnDetection {
  const body = items.filter((item) => item.y < height * 0.83);
  if (body.length < 20) return { split: null, confident: false };
  const bands = new Map<number, PositionedText[]>();
  for (const item of body) {
    const key = Math.round(item.y / 6);
    bands.set(key, [...(bands.get(key) ?? []), item]);
  }
  // Some PDFs emit one positioned item per character. Geometry from those
  // files is too fragmented for a trustworthy column decision; the visual
  // screenshot analysis can still override this conservative fallback.
  if (body.length / Math.max(1, bands.size) > 18) {
    return { split: null, confident: false };
  }

  let best: {
    split: number;
    score: number;
    left: number;
    right: number;
    dual: number;
  } | null = null;
  for (const ratio of [0.28, 0.32, 0.36, 0.4, 0.44, 0.48]) {
    const split = width * ratio;
    const gutter = Math.max(8, width * 0.018);
    let dualBands = 0;
    let left = 0;
    let right = 0;
    for (const band of bands.values()) {
      // Use text origins, not item centres. A long single-column sentence may
      // cross every candidate split, while a real main column repeatedly
      // starts to the right of a stable gutter.
      const hasLeft = band.some((item) => item.x < split - gutter);
      const hasRight = band.some((item) => item.x > split + gutter);
      if (hasLeft) left += 1;
      if (hasRight) right += 1;
      if (hasLeft && hasRight) dualBands += 1;
    }
    const balance = Math.min(left, right) / Math.max(1, Math.max(left, right));
    const score = dualBands * balance;
    if (!best || score > best.score) {
      best = { split, score, left, right, dual: dualBands };
    }
  }
  if (!best) return { split: null, confident: false };
  const minimumDualBands = Math.max(6, Math.round(bands.size * 0.22));
  const minimumSideBands = Math.max(8, Math.round(bands.size * 0.3));
  const isTwoColumn =
    best.dual >= minimumDualBands &&
    Math.min(best.left, best.right) >= minimumSideBands;
  // Legible geometry that simply shows no second column: a confident answer.
  return { split: isTwoColumn ? best.split : null, confident: true };
}

export function analyzePdfPageLayout(
  page: number,
  widthPt: number,
  heightPt: number,
  rawItems: PdfTextItem[],
  forcedColumns?: 1 | 2,
): LayoutPage {
  const items: PositionedText[] = rawItems.flatMap((item) => {
    const text = item.str?.replace(/\s+/g, " ").trim();
    const transform = item.transform;
    if (!text || !transform || transform.length < 6) return [];
    return [
      {
        text,
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        width: Math.max(0, item.width ?? 0),
        height: Math.max(6, item.height ?? Math.abs(transform[3] ?? 8)),
      },
    ];
  });
  const detection = detectColumnSplit(items, widthPt, heightPt);
  const detectedSplit = detection.split;
  if (forcedColumns === 1 || (!detectedSplit && forcedColumns !== 2)) {
    return {
      page,
      widthPt,
      heightPt,
      columns: 1,
      // A forced value came from the visual check, which is authoritative.
      columnsConfident: forcedColumns !== undefined || detection.confident,
      readingOrderText: `[PAGE ${page}]\n${groupLines(items).join("\n")}`,
    };
  }
  // If screenshot analysis found a sidebar that coordinate heuristics missed,
  // use the conventional one-third split to restore a safe column reading
  // order. A detected split remains preferable whenever available.
  const split = detectedSplit ?? widthPt * 0.34;
  const headerCutoff = heightPt * 0.83;
  const header = items.filter((item) => item.y >= headerCutoff);
  const body = items.filter((item) => item.y < headerCutoff);
  const left = body.filter((item) => item.x + item.width * 0.5 < split);
  const right = body.filter((item) => item.x + item.width * 0.5 >= split);
  return {
    page,
    widthPt,
    heightPt,
    columns: 2,
    columnsConfident: forcedColumns !== undefined || detection.confident,
    readingOrderText: [
      `[PAGE ${page} HEADER]`,
      ...groupLines(header),
      `[PAGE ${page} LEFT COLUMN]`,
      ...groupLines(left),
      `[PAGE ${page} RIGHT COLUMN]`,
      ...groupLines(right),
    ].join("\n"),
  };
}

/**
 * Whether the visual model still has something to decide. Rasterising pages
 * and sending them to a vision model is by far the slowest step of an upload,
 * and for a single-column resume whose geometry read cleanly it cannot change
 * the outcome — the coordinate pass already answered the only question it is
 * asked. Anything unresolved, or any hint of a second column, still goes.
 */
export function needsVisualColumnCheck(
  layout: ResumeSourceLayout | undefined | null,
): boolean {
  if (!layout || layout.pages.length === 0) return true;
  if (layout.maxColumns === 2) return true;
  return layout.pages.some((page) => page.columnsConfident !== true);
}

export async function extractPdfLayout(
  buffer: Buffer,
  pageColumns: Readonly<Record<number, 1 | 2>> = {},
): Promise<PdfLayoutExtraction> {
  // The bundled legacy PDF.js build is unusually noisy for documents whose
  // fonts use a large private Unicode area. Silence parser warnings before
  // pdf-parse loads the same cached module; extraction still fails normally
  // if the document itself cannot be read.
  // @ts-expect-error the legacy CommonJS PDF.js bundle has no declarations.
  const pdfJs = (await import("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js"))
    .default as { PDFJS?: { verbosity?: number } };
  if (pdfJs.PDFJS) pdfJs.PDFJS.verbosity = 0;
  // @ts-expect-error pdf-parse's internal implementation has no exported types.
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
    value: Buffer,
    options?: {
      pagerender?: (pageData: {
        pageNumber?: number;
        getViewport: (scale: number) => { width: number; height: number };
        getTextContent: (options: Record<string, boolean>) => Promise<{
          items: PdfTextItem[];
        }>;
        getAnnotations?: () => Promise<PdfLinkAnnotation[]>;
      }) => Promise<string>;
    },
  ) => Promise<{ numpages: number; text: string }>;
  const pages: LayoutPage[] = [];
  const links: ResumeLink[] = [];
  let pageIndex = 0;
  const releaseWarningFilter = acquirePdfWarningFilter();
  let result: { numpages: number; text: string };
  try {
    result = await pdfParse(buffer, {
      pagerender: async (pageData) => {
        pageIndex += 1;
        const viewport = pageData.getViewport(1);
        const content = await pageData.getTextContent({
          normalizeWhitespace: true,
          disableCombineTextItems: false,
        });
        const page = analyzePdfPageLayout(
          pageData.pageNumber ?? pageIndex,
          viewport.width,
          viewport.height,
          content.items,
          pageColumns[pageData.pageNumber ?? pageIndex],
        );
        pages.push(page);
        // Annotations come from the page we already have open, so recovering
        // link targets costs no extra parse. A document without an annotation
        // layer simply yields none.
        if (typeof pageData.getAnnotations === "function") {
          try {
            links.push(
              ...pairLinkAnnotations(await pageData.getAnnotations(), content.items),
            );
          } catch {
            // A malformed annotation layer must never fail the upload.
          }
        }
        return page.readingOrderText;
      },
    });
  } finally {
    releaseWarningFilter();
  }
  const maxColumns = pages.some((page) => page.columns === 2) ? 2 : 1;
  const issues =
    maxColumns === 2
      ? [
          "A multi-column PDF layout was detected. Confirm the semantic section order before using Keep original.",
        ]
      : [];
  return {
    text: pages.map((page) => page.readingOrderText).join("\n\n").trim(),
    links: dedupeResumeLinks(links),
    layout: {
      parser: "pdfjs-coordinates",
      pageCount: result.numpages || pages.length || 1,
      maxColumns,
      pages: pages.map(({ readingOrderText: _text, ...page }) => page),
      issues,
    },
  };
}
