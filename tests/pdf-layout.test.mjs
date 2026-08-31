// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfLayout } from "../lib/pdfLayout.ts";

// pdf-parse bundles pdf.js v1.10, which tears its worker down after the
// extraction promise has already settled and rejects with "Cannot read
// properties of null (reading 'getBytes')". Nothing here can await that, so
// every extraction happens at module scope below and the tests are pure
// assertions - otherwise the runner blames whichever test ran first for stray
// asynchronous activity. Anything that is not this known artifact propagates.
process.on("unhandledRejection", (error) => {
  if (error instanceof TypeError && /getBytes/.test(error.message)) return;
  throw error;
});

const A4 = [595, 842];

/**
 * Draws runs left-to-right on one baseline, alternating regular and bold, so
 * pdf.js emits a separate positioned item per run - the shape that broke both
 * the column heuristic and inter-word spacing on real resumes.
 */
function drawRuns(page, fonts, runs, { x, y, size = 9 }) {
  let cursor = x;
  for (const [text, weight] of runs) {
    const font = fonts[weight];
    page.drawText(text, { x: cursor, y, size, font });
    cursor += font.widthOfTextAtSize(text, size);
  }
  return cursor;
}

async function pdfWith(build) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const page = doc.addPage(A4);
  build(page, fonts);
  // That same pdf.js v1.10 predates cross-reference/object streams and rejects
  // those documents outright with "Invalid PDF structure".
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// A bullet whose keywords are bold, split into runs exactly like the real file.
// The trailing spaces live on the regular runs, which is what pdf.js reports.
const BULLET_RUNS = [
  ["Built a production Agentic AI platform in ", "regular"],
  ["Python", "bold"],
  [" and ", "regular"],
  ["FastAPI", "bold"],
  [" on ", "regular"],
  ["GCP", "bold"],
  [", running autonomous agents.", "regular"],
];

function singleColumnResume(page, fonts) {
  let y = 650;
  drawRuns(page, fonts, [["PROFESSIONAL EXPERIENCE", "bold"]], { x: 40, y, size: 11 });
  y -= 20;
  for (let i = 0; i < 9; i++) {
    drawRuns(page, fonts, BULLET_RUNS, { x: 40, y });
    y -= 16;
  }
}

function labelledSkills(page, fonts) {
  let y = 650;
  for (const [label, value] of [
    ["Languages: ", "Python, Go, Java"],
    ["Backend: ", "FastAPI, Spring Boot"],
    ["Frontend: ", "React, HTML/CSS"],
  ]) {
    drawRuns(page, fonts, [[label, "bold"], [value, "regular"]], { x: 40, y });
    y -= 16;
  }
  // Padding so the page clears the minimum item count for analysis.
  for (let i = 0; i < 8; i++) {
    drawRuns(page, fonts, BULLET_RUNS, { x: 40, y });
    y -= 16;
  }
}

// The corridor a real sidebar leaves behind is what detection should key on.
function sidebarResume(page, fonts) {
  let y = 650;
  for (let i = 0; i < 11; i++) {
    drawRuns(page, fonts, [[`Skill ${i + 1}`, "regular"]], { x: 40, y });
    y -= 16;
  }
  y = 650;
  for (let i = 0; i < 14; i++) {
    drawRuns(page, fonts, [[`Main column line ${i + 1} with detail text`, "regular"]], {
      x: 240,
      y,
    });
    y -= 16;
  }
}

const single = await extractPdfLayout(await pdfWith(singleColumnResume));
const skills = await extractPdfLayout(await pdfWith(labelledSkills));
const sidebar = await extractPdfLayout(await pdfWith(sidebarResume));
// Forcing the two-column path on single-column content reproduces the situation
// that used to file "...platform in" and the tail of the same sentence into
// blocks hundreds of lines apart.
const forcedTwo = await extractPdfLayout(await pdfWith(singleColumnResume), { 1: 2 });
const empty = await extractPdfLayout(await pdfWith(() => {}));
await new Promise((resolve) => setTimeout(resolve, 200));

test("a single-column resume full of inline bold is not read as two columns", () => {
  assert.equal(single.layout.maxColumns, 1, "inline bold must not look like a gutter");
  assert.equal(single.layout.pages[0].columns, 1);
  assert.deepEqual(single.layout.issues, []);
});

test("bold keywords keep the space in front of them", () => {
  // The whole point: these must be matchable as keywords by JD analysis.
  assert.match(single.text, /platform in Python and FastAPI on GCP/);
  assert.ok(!single.text.includes("inPython"), "space before a bold run was dropped");
  assert.ok(!single.text.includes("andFastAPI"));
  assert.ok(!single.text.includes("onGCP"));
});

test("a label keeps the space before its first value", () => {
  assert.match(skills.text, /Languages: Python/);
  assert.match(skills.text, /Backend: FastAPI/);
  assert.match(skills.text, /Frontend: React/);
});

test("a genuine sidebar layout is still detected", () => {
  assert.equal(sidebar.layout.maxColumns, 2, "an empty corridor is a real gutter");
  assert.match(sidebar.text, /LEFT COLUMN/);
  assert.match(sidebar.text, /RIGHT COLUMN/);
  assert.equal(sidebar.layout.issues.length, 1);
});

test("a line crossing the gutter is kept whole, not cut in two", () => {
  assert.equal(forcedTwo.layout.pages[0].columns, 2, "the forced path should run");
  assert.match(
    forcedTwo.text,
    /platform in Python and FastAPI on GCP, running autonomous agents\./,
    "a full-width line must survive a wrong column call intact",
  );
});

test("an empty page degrades quietly", () => {
  assert.equal(empty.layout.maxColumns, 1);
  assert.ok(empty.text.length < 40);
});
