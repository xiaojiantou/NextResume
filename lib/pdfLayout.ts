import type { ResumeSourceLayout } from "./types";

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
  /**
   * Whether the source run carried whitespace at that edge. pdf.js includes a
   * run's trailing space in its advance width, so once the character is dropped
   * the geometry alone cannot tell "platform in Python" from "platform inPython"
   * — the gap between the runs is zero either way.
   */
  spaceBefore: boolean;
  spaceAfter: boolean;
};

type LayoutPage = ResumeSourceLayout["pages"][number] & {
  readingOrderText: string;
};

export type PdfLayoutExtraction = {
  text: string;
  layout: ResumeSourceLayout;
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
  let previous: PositionedText | null = null;
  for (const item of sorted) {
    const gap = item.x - rightEdge;
    // Either side remembering a space is enough. Falling back to the gap alone
    // glued every bold keyword to the word before it — "inPython", "andFastAPI"
    // — which also made those keywords invisible to JD matching.
    const separated =
      previous?.spaceAfter ||
      item.spaceBefore ||
      gap > Math.max(2, item.height * 0.18);
    output += output && separated ? " " : "";
    output += item.text;
    rightEdge = Math.max(rightEdge, item.x + item.width);
    previous = item;
  }
  return output.replace(/\s+/g, " ").trim();
}

type LineGroup = { y: number; height: number; items: PositionedText[] };

function groupLineItems(items: PositionedText[]): LineGroup[] {
  const lines: LineGroup[] = [];
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
  return lines.sort((left, right) => right.y - left.y);
}

function groupLines(items: PositionedText[]): string[] {
  return groupLineItems(items)
    .map((line) => lineText(line.items))
    .filter(Boolean);
}

/** Horizontal ink extent of a line, used to find a gutter nothing crosses. */
function lineSpan(line: LineGroup): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const item of line.items) {
    start = Math.min(start, item.x);
    end = Math.max(end, item.x + item.width);
  }
  return { start, end };
}

// A column boundary is a vertical corridor of whitespace: a real sidebar layout
// has an x that essentially no line of text crosses.
//
// The previous heuristic asked whether *item origins* appeared on both sides of
// a candidate x, on the theory that a long single-column sentence is one item
// and so cannot straddle. Inline formatting breaks that: pdf.js emits a
// separate run per bold span, so an ordinary single-column bullet peppered with
// bold keywords produces origins scattered across the full width and scores as
// two columns. A measured single-column resume was misread as two, and the
// centre-based split below then tore each line in half.
//
// Working from whole-line ink extents removes the dependency on how a line
// happens to be chunked into runs.
const COLUMN_RATIOS = [0.28, 0.32, 0.36, 0.4, 0.44, 0.48] as const;
/** A gutter may be nicked by this share of bands — rules, glyph overhang. */
const MAX_INKED_SHARE = 0.06;
/** Bands with text on both sides of the corridor, or it is not a column pair. */
const MIN_PAIRED_SHARE = 0.25;

function detectColumnSplit(
  items: PositionedText[],
  width: number,
  height: number,
): number | null {
  const body = items.filter((item) => item.y < height * 0.83);
  if (body.length < 20) return null;

  // Bands, not lines: at a given height a sidebar layout has text in both
  // columns, so a band's overall extent crosses the gutter even though the
  // corridor between the runs is empty. What matters is the hole, not the span.
  const bands = groupLineItems(body);
  if (bands.length < 8) return null;

  const gutter = Math.max(8, width * 0.018);
  let best: { split: number; paired: number } | null = null;

  for (const ratio of COLUMN_RATIOS) {
    const split = width * ratio;
    const low = split - gutter;
    const high = split + gutter;
    let clear = 0;
    let paired = 0;
    for (const band of bands) {
      // Runs on a single-column line tile it end to end, so one of them always
      // covers the corridor. Bold splitting a line into many runs does not
      // open a hole; a real gutter does.
      const inked = band.items.some(
        (item) => item.x < high && item.x + item.width > low,
      );
      if (inked) continue;
      clear += 1;
      const hasLeft = band.items.some((item) => item.x + item.width <= low);
      const hasRight = band.items.some((item) => item.x >= high);
      if (hasLeft && hasRight) paired += 1;
    }
    const clearShare = clear / bands.length;
    const pairedShare = paired / bands.length;
    if (clearShare < 1 - MAX_INKED_SHARE) continue;
    if (pairedShare < MIN_PAIRED_SHARE) continue;
    if (!best || pairedShare > best.paired) best = { split, paired: pairedShare };
  }

  return best?.split ?? null;
}

export function analyzePdfPageLayout(
  page: number,
  widthPt: number,
  heightPt: number,
  rawItems: PdfTextItem[],
  forcedColumns?: 1 | 2,
): LayoutPage {
  const items: PositionedText[] = [];
  // A run that is nothing but whitespace still carries a word boundary, so it
  // hands its space to whichever run comes next instead of vanishing.
  let pendingSpace = false;
  for (const item of rawItems) {
    const collapsed = item.str?.replace(/\s+/g, " ") ?? "";
    const text = collapsed.trim();
    const transform = item.transform;
    if (!text) {
      if (collapsed) pendingSpace = true;
      continue;
    }
    if (!transform || transform.length < 6) continue;
    items.push({
      text,
      x: transform[4] ?? 0,
      y: transform[5] ?? 0,
      width: Math.max(0, item.width ?? 0),
      height: Math.max(6, item.height ?? Math.abs(transform[3] ?? 8)),
      spaceBefore: pendingSpace || /^\s/.test(collapsed),
      spaceAfter: /\s$/.test(collapsed),
    });
    pendingSpace = false;
  }
  const detectedSplit = detectColumnSplit(items, widthPt, heightPt);
  if (forcedColumns === 1 || (!detectedSplit && forcedColumns !== 2)) {
    return {
      page,
      widthPt,
      heightPt,
      columns: 1,
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

  // Assign whole lines, never individual runs. Splitting by run centre used to
  // cut a line that crossed the gutter into two fragments filed hundreds of
  // lines apart, which is how "…platform in" ended up adjacent to "pooling cut
  // p95 API latency ~40%." and the middle of the sentence disappeared. Keeping
  // lines intact degrades a wrong column call to imperfect ordering rather than
  // destroyed content. A line that does cross the gutter is treated as
  // full-width and read with the first column.
  const gutter = Math.max(8, widthPt * 0.018);
  const leftLines: string[] = [];
  const rightLines: string[] = [];
  for (const line of groupLineItems(body)) {
    const text = lineText(line.items);
    if (!text) continue;
    const { start, end } = lineSpan(line);
    const spansGutter = start < split - gutter && end > split + gutter;
    if (spansGutter || end <= split + gutter) leftLines.push(text);
    else rightLines.push(text);
  }

  return {
    page,
    widthPt,
    heightPt,
    columns: 2,
    readingOrderText: [
      `[PAGE ${page} HEADER]`,
      ...groupLines(header),
      `[PAGE ${page} LEFT COLUMN]`,
      ...leftLines,
      `[PAGE ${page} RIGHT COLUMN]`,
      ...rightLines,
    ].join("\n"),
  };
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
      }) => Promise<string>;
    },
  ) => Promise<{ numpages: number; text: string }>;
  const pages: LayoutPage[] = [];
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
    layout: {
      parser: "pdfjs-coordinates",
      pageCount: result.numpages || pages.length || 1,
      maxColumns,
      pages: pages.map(({ readingOrderText: _text, ...page }) => page),
      issues,
    },
  };
}
