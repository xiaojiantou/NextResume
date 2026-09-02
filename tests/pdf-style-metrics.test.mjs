// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Round-trips a PDF built at known sizes back through the measurer. The whole
// point of measuring is that the numbers are not guesses, so the test supplies
// its own ground truth rather than asserting against a recorded snapshot.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { measurePdfStyle } from "../lib/pdfStyleMetrics.ts";

const PAGE = { widthPt: 612, heightPt: 792, orientation: "portrait" };
const BODY_PT = 9.5;
const NAME_PT = 20;
const SECTION_PT = 11;
const LEADING = 11; // 9.5pt body at ~1.158 line height
const SECTION_EXTRA = 14;
const ENTRY_EXTRA = 3;
const BULLET_EXTRA = 0; // A dense resume runs its bullets on plain leading.
const LEFT = 28;
const TOP_GAP = 14;

async function buildPdf({ serif = true } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.widthPt, PAGE.heightPt]);
  const body = await doc.embedFont(
    serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica,
  );
  const bold = await doc.embedFont(
    serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold,
  );

  let y = PAGE.heightPt - TOP_GAP - NAME_PT;
  page.drawText("Jane Doe", { x: LEFT, y, size: NAME_PT, font: bold });

  // A real resume's rhythm: headings sit on a wide gap, entries on a small
  // one, bullets on none at all. Drawing each gap explicitly gives the
  // spacing measurement exact ground truth to be checked against.
  for (const section of ["EDUCATION", "PROFESSIONAL EXPERIENCE", "PROJECTS"]) {
    y -= LEADING + SECTION_EXTRA;
    page.drawText(section, { x: LEFT, y, size: SECTION_PT, font: bold });
    for (let entry = 0; entry < 2; entry += 1) {
      y -= LEADING + ENTRY_EXTRA;
      page.drawText(`Acme Corporation Staff Engineer ${entry}`, {
        x: LEFT,
        y,
        size: BODY_PT,
        font: bold,
      });
      for (let point = 0; point < 3; point += 1) {
        y -= LEADING + BULLET_EXTRA;
        page.drawText(
          `• Reduced p99 checkout latency by 43 percent ${point}`,
          { x: LEFT, y, size: BODY_PT, font: body },
        );
        y -= LEADING;
        page.drawText("across the pricing path and the checkout service", {
          x: LEFT,
          y,
          size: BODY_PT,
          font: body,
        });
      }
    }
  }
  return Buffer.from(await doc.save());
}

async function measure(buffer) {
  const canvasLib = await import("@napi-rs/canvas");
  for (const [name, impl] of Object.entries({
    Path2D: canvasLib.Path2D,
    DOMMatrix: canvasLib.DOMMatrix,
    ImageData: canvasLib.ImageData,
    DOMPoint: canvasLib.DOMPoint,
  })) {
    if (!(name in globalThis)) globalThis[name] = impl;
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const asset = (dir) =>
    `${path.join(process.cwd(), "node_modules", "pdfjs-dist", dir)}/`;
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    standardFontDataUrl: asset("standard_fonts"),
    cMapUrl: asset("cmaps"),
    cMapPacked: true,
  }).promise;
  try {
    return await measurePdfStyle(await doc.getPage(1), PAGE);
  } finally {
    await doc.destroy();
  }
}

test("body size is the size most of the characters are set in", async () => {
  const metrics = await measure(await buildPdf());
  assert.equal(metrics.bodyPt, BODY_PT);
});

test("the name is measured apart from the body it towers over", async () => {
  const metrics = await measure(await buildPdf());
  assert.ok(Math.abs(metrics.namePt - NAME_PT) < 0.5, `got ${metrics.namePt}`);
});

test("headings set barely above body size are not read as much larger", async () => {
  // A vision model looking at a picture reliably calls these 14pt, because
  // caps and weight read as size. They are 11pt.
  const metrics = await measure(await buildPdf());
  assert.equal(metrics.sectionPt, SECTION_PT);
});

test("line height is recovered from the gaps between baselines", async () => {
  const metrics = await measure(await buildPdf());
  assert.ok(
    Math.abs(metrics.lineHeight - LEADING / BODY_PT) < 0.02,
    `got ${metrics.lineHeight}`,
  );
});

test("bullets that run on plain leading are measured as adding no space", async () => {
  // The estimate floor for this is 1.5pt. Paid twenty-odd times across a
  // resume, that alone is worth about a fifth of a page — which is why a
  // one-page source kept coming back as two.
  const metrics = await measure(await buildPdf());
  assert.ok(
    metrics.spacing.bulletPt <= 1,
    `expected ~${BULLET_EXTRA}, got ${metrics.spacing.bulletPt}`,
  );
});

test("section and entry spacing are told apart from each other", async () => {
  const metrics = await measure(await buildPdf());
  assert.ok(
    Math.abs(metrics.spacing.sectionPt - SECTION_EXTRA) < 1.5,
    `section: got ${metrics.spacing.sectionPt}`,
  );
  assert.ok(
    Math.abs(metrics.spacing.entryPt - ENTRY_EXTRA) < 1.5,
    `entry: got ${metrics.spacing.entryPt}`,
  );
});

test("a wrapped continuation line is not mistaken for a new entry", async () => {
  // Continuation lines sit on plain leading. Counting them as entry starts
  // would drag the measured entry gap down to zero.
  const metrics = await measure(await buildPdf());
  assert.ok(metrics.spacing.entryPt > 1, `got ${metrics.spacing.entryPt}`);
});

test("margins come from where the text actually starts", async () => {
  const metrics = await measure(await buildPdf());
  assert.ok(Math.abs(metrics.marginsPt.left - LEFT) < 1, `got ${metrics.marginsPt.left}`);
  // The top edge is the name's ascent, approximated by its point size.
  assert.ok(metrics.marginsPt.top < 20, `got ${metrics.marginsPt.top}`);
});

test("serif and sans sources are told apart by their embedded fonts", async () => {
  const serif = await measure(await buildPdf({ serif: true }));
  const sans = await measure(await buildPdf({ serif: false }));
  assert.equal(serif.serif, true);
  assert.equal(sans.serif, false);
});

test("a page with no real text layer is reported as unmeasurable", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([PAGE.widthPt, PAGE.heightPt]);
  // A scan has no text runs at all; returning null keeps the caller on the
  // vision estimate rather than on numbers derived from nothing.
  assert.equal(await measure(Buffer.from(await doc.save())), null);
});
