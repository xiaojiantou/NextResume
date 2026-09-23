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
  assert.equal(sourcePageCount({ sourceLayout: { pageCount: 2 } }), 2);
  assert.equal(
    sourcePageCount({ structureManifest: { pageCount: 3 } }),
    3,
  );
  assert.equal(
    sourcePageCount({
      sourceLayout: { pageCount: 1 },
      structureManifest: { pageCount: 3 },
    }),
    1,
  );
  assert.equal(sourcePageCount({}), null);
  assert.equal(sourcePageCount({ sourceLayout: { pageCount: 0 } }), null);
  assert.equal(sourcePageCount({ sourceLayout: { pageCount: 2.5 } }), null);
});
