// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAutoPageTarget,
  sourcePageCount,
} from "../lib/pdf/fitTarget.ts";

// One render per preset, roomiest first, mirroring FIXED_FIT_PRESETS.
const candidates = (pages) =>
  ["very-relaxed", "relaxed", "standard", "compact", "tight", "minimum-safe"].map(
    (density, index) => ({ density, pageCount: pages[index] }),
  );

test("auto keeps a two-page source at two pages when a denser preset fits", () => {
  // Standard spills onto a third page by a few lines; compact does not.
  const target = resolveAutoPageTarget(candidates([4, 3, 3, 2, 2, 2]), 2);
  assert.equal(target, 2);
});

test("auto falls back to the standard page count when no preset reaches the source's", () => {
  const target = resolveAutoPageTarget(candidates([4, 4, 3, 3, 3, 3]), 2);
  assert.equal(target, 3);
});

test("auto never pads a resume back up to a longer source", () => {
  const target = resolveAutoPageTarget(candidates([3, 2, 2, 2, 1, 1]), 3);
  assert.equal(target, 2);
});

test("auto uses the standard page count when the source count is unknown", () => {
  assert.equal(resolveAutoPageTarget(candidates([4, 3, 3, 2, 2, 2]), null), 3);
  assert.equal(
    resolveAutoPageTarget(candidates([4, 3, 3, 2, 2, 2]), undefined),
    3,
  );
});

test("auto does not squeeze a source onto fewer pages than it had", () => {
  // Source was 2 pages and standard renders 2: tighter presets that reach 1
  // page are not preferred.
  assert.equal(resolveAutoPageTarget(candidates([3, 2, 2, 1, 1, 1]), 2), 2);
});

test("sourcePageCount reads the parse's page count and rejects bad values", () => {
  const pdf = (pageCount, extra = {}) => ({
    parser: "pdfjs-coordinates",
    pageCount,
    maxColumns: 1,
    pages: Array.from({ length: pageCount }, (_, i) => ({ page: i + 1 })),
    issues: [],
    ...extra,
  });
  assert.equal(sourcePageCount({ sourceLayout: pdf(2) }), 2);
  assert.equal(
    sourcePageCount({
      structureManifest: { parser: "pdfjs-coordinates", pageCount: 3 },
    }),
    3,
  );
  assert.equal(
    sourcePageCount({
      sourceLayout: pdf(1),
      structureManifest: { parser: "pdfjs-coordinates", pageCount: 3 },
    }),
    1,
  );
  assert.equal(sourcePageCount({}), null);
  assert.equal(sourcePageCount({ sourceLayout: pdf(0, { pages: [] }) }), null);
  assert.equal(sourcePageCount({ sourceLayout: pdf(2.5) }), null);
});

test("a .tex or .docx upload's placeholder page count is unknown, not one page", () => {
  const placeholder = {
    parser: "linear-text",
    pageCount: 1,
    maxColumns: 1,
    pages: [],
    issues: [],
  };
  assert.equal(sourcePageCount({ sourceLayout: placeholder }), null);
  assert.equal(
    sourcePageCount({
      structureManifest: { parser: "linear-text", pageCount: 1 },
    }),
    null,
  );
});

test("with an unknown source, a barely used last page is squeezed away", () => {
  const spill = (overflowLines, linesPerPage = 50) => ({
    pageCount: 3,
    targetPages: 2,
    linesPerPage,
    charsPerLine: 90,
    overflowLines,
    overflowChars: overflowLines * 60,
    overflowFraction: overflowLines / linesPerPage,
  });
  // Standard spills 8 of 50 lines onto page 3; minimum-safe reaches 2.
  assert.equal(
    resolveAutoPageTarget(candidates([4, 4, 3, 3, 3, 2]), null, spill(8)),
    2,
  );
  // More than half a page of real content on page 3 stays at 3 pages.
  assert.equal(
    resolveAutoPageTarget(candidates([4, 4, 3, 3, 3, 2]), null, spill(30)),
    3,
  );
  // No denser preset reaches 2 pages: nothing to squeeze into.
  assert.equal(
    resolveAutoPageTarget(candidates([4, 4, 3, 3, 3, 3]), null, spill(8)),
    3,
  );
  // A known source count takes precedence over the spill heuristic.
  assert.equal(
    resolveAutoPageTarget(candidates([4, 4, 3, 3, 3, 2]), 3, spill(8)),
    3,
  );
  // Without a spill estimate the standard count stands.
  assert.equal(
    resolveAutoPageTarget(candidates([4, 4, 3, 3, 3, 2]), null, null),
    3,
  );
});
