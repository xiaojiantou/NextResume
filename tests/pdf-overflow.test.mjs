// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  estimateFromPageStats,
  estimatePageOverflow,
  pageTextStats,
} from "../lib/pdf/overflow.ts";

// See pdf-layout.test.mjs: the bundled pdf.js rejects late with a getBytes
// TypeError after extraction has already settled.
process.on("unhandledRejection", (error) => {
  if (error instanceof TypeError && /getBytes/.test(error.message)) return;
  throw error;
});

test("pageTextStats groups items on one baseline into a single line", () => {
  const item = (str, y, height = 10) => ({
    str,
    height,
    transform: [1, 0, 0, 1, 50, y],
  });
  const stats = pageTextStats([
    item("Built the ", 700),
    item("platform", 700.4),
    item("Second line", 686),
    item("", 672),
    item("Third", 660),
  ]);
  assert.equal(stats.lines, 3);
  assert.equal(stats.chars, "Built the".length + "platform".length + 11 + 5);
  assert.equal(stats.maxLineChars, "Built the".length + "platform".length);
});

test("estimateFromPageStats reports the lines and characters past the target", () => {
  const page = (lines, chars, maxLineChars = 95) => ({ lines, chars, maxLineChars });
  const estimate = estimateFromPageStats(
    [page(60, 5400), page(58, 5200), page(6, 480)],
    2,
  );
  assert.equal(estimate.pageCount, 3);
  assert.equal(estimate.linesPerPage, 59);
  assert.equal(estimate.charsPerLine, 95);
  assert.equal(estimate.overflowLines, 6);
  assert.equal(estimate.overflowChars, 480);
  assert.ok(Math.abs(estimate.overflowFraction - 6 / 59) < 1e-9);
});

test("estimateFromPageStats reports zero overflow when within the target", () => {
  const estimate = estimateFromPageStats(
    [{ lines: 40, chars: 3000, maxLineChars: 90 }],
    2,
  );
  assert.equal(estimate.overflowLines, 0);
  assert.equal(estimate.overflowChars, 0);
});

const overflowFromRealPdf = await (async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const line = "Shipped a production feature across four rendering paths.";
  for (const lineCount of [50, 50, 7]) {
    const page = doc.addPage([612, 792]);
    for (let index = 0; index < lineCount; index += 1) {
      page.drawText(line, { x: 50, y: 740 - index * 13, size: 10, font });
    }
  }
  const buffer = Buffer.from(await doc.save({ useObjectStreams: false }));
  return estimatePageOverflow(buffer, 2);
})();

test("estimatePageOverflow reads line counts from a rendered PDF", () => {
  assert.ok(overflowFromRealPdf);
  assert.equal(overflowFromRealPdf.pageCount, 3);
  assert.equal(overflowFromRealPdf.overflowLines, 7);
  assert.equal(overflowFromRealPdf.linesPerPage, 50);
});
