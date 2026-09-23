// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { PdfTextItem } from "../pdfLayout";

export type PageOverflowEstimate = {
  pageCount: number;
  targetPages: number;
  /** Text lines a full page holds in this layout. */
  linesPerPage: number;
  /** Characters a full-width line holds in this layout. */
  charsPerLine: number;
  /** Text lines that landed beyond the target page count. */
  overflowLines: number;
  /** Characters on those lines, the amount of content a cut must remove. */
  overflowChars: number;
  /** overflowLines as a fraction of a page. */
  overflowFraction: number;
};

type PageStats = { lines: number; chars: number; maxLineChars: number };

/**
 * Groups a page's text items into baseline rows. Items closer than half a
 * typical text height share a line.
 */
export function pageTextStats(items: PdfTextItem[]): PageStats {
  const heights = items
    .map((item) => item.height ?? 0)
    .filter((height) => height > 0);
  const typicalHeight =
    heights.length > 0
      ? heights.sort((left, right) => left - right)[Math.floor(heights.length / 2)]
      : 10;
  const tolerance = Math.max(1, typicalHeight / 2);
  const keyed: Array<{ y: number; chars: number }> = [];
  for (const item of items) {
    const text = (item.str ?? "").trim();
    if (!text) continue;
    const y = item.transform?.[5] ?? 0;
    const existing = keyed.find((row) => Math.abs(row.y - y) <= tolerance);
    if (existing) {
      existing.chars += text.length;
    } else {
      keyed.push({ y, chars: text.length });
    }
  }
  const chars = keyed.reduce((total, row) => total + row.chars, 0);
  const maxLineChars = keyed.reduce((max, row) => Math.max(max, row.chars), 0);
  return { lines: keyed.length, chars, maxLineChars };
}

export function estimateFromPageStats(
  pages: PageStats[],
  targetPages: number,
): PageOverflowEstimate | null {
  if (pages.length === 0 || targetPages < 1) return null;
  const full = pages.slice(0, Math.min(targetPages, pages.length));
  const linesPerPage = Math.max(
    1,
    Math.round(
      full.reduce((total, page) => total + page.lines, 0) / full.length,
    ),
  );
  const fullLineSamples = pages.map((page) => page.maxLineChars).filter(Boolean);
  const charsPerLine = Math.max(
    40,
    Math.round(
      fullLineSamples.length > 0
        ? fullLineSamples.reduce((total, value) => total + value, 0) /
            fullLineSamples.length
        : 90,
    ),
  );
  const overflowPages = pages.slice(targetPages);
  const overflowLines = overflowPages.reduce(
    (total, page) => total + page.lines,
    0,
  );
  const overflowChars = overflowPages.reduce(
    (total, page) => total + page.chars,
    0,
  );
  return {
    pageCount: pages.length,
    targetPages,
    linesPerPage,
    charsPerLine,
    overflowLines,
    overflowChars,
    overflowFraction: overflowLines / linesPerPage,
  };
}

/**
 * How much of a rendered PDF spills past the target page count, measured
 * from the text layer. Best effort: any parser failure yields null and the
 * caller falls back to page counts alone.
 */
export async function estimatePageOverflow(
  buffer: Buffer,
  targetPages: number,
): Promise<PageOverflowEstimate | null> {
  try {
    // @ts-expect-error the legacy CommonJS PDF.js bundle has no declarations.
    const pdfJs = (await import("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js"))
      .default as { PDFJS?: { verbosity?: number } };
    if (pdfJs.PDFJS) pdfJs.PDFJS.verbosity = 0;
    // @ts-expect-error pdf-parse's internal implementation has no exported types.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
      value: Buffer,
      options?: {
        pagerender?: (pageData: {
          getTextContent: (options: Record<string, boolean>) => Promise<{
            items: PdfTextItem[];
          }>;
        }) => Promise<string>;
      },
    ) => Promise<{ numpages: number; text: string }>;
    const pages: PageStats[] = [];
    await pdfParse(buffer, {
      pagerender: async (pageData) => {
        const content = await pageData.getTextContent({
          normalizeWhitespace: true,
          disableCombineTextItems: false,
        });
        pages.push(pageTextStats(content.items));
        return "";
      },
    });
    return estimateFromPageStats(pages, targetPages);
  } catch (error) {
    console.warn("[fit-resume] overflow estimate unavailable", error);
    return null;
  }
}
