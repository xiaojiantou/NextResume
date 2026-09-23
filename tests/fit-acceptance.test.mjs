// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { judgeFit } from "../lib/fitAcceptance.ts";

const DENSITIES = [
  "very-relaxed",
  "relaxed",
  "standard",
  "compact",
  "tight",
  "minimum-safe",
];

function measurement(pages, overflow = null) {
  const presets = DENSITIES.map((density, index) => ({
    density,
    pageCount: pages[index],
  }));
  return {
    pageCount: pages[2],
    density: "standard",
    observedPages: pages,
    presets,
    standardPages: pages[2],
    densestPages: pages[5],
    overflow,
  };
}

test("a plan that reaches the target at standard or denser typography fits", () => {
  assert.deepEqual(judgeFit(measurement([4, 3, 3, 2, 2, 2]), 2), {
    kind: "fits",
    density: "compact",
  });
  assert.deepEqual(judgeFit(measurement([3, 3, 2, 2, 2, 1]), 2), {
    kind: "fits",
    density: "standard",
  });
});

test("the roomiest preset is reported when a denser one also fits", () => {
  // Nothing was squeezed out: relaxed and standard both land on 2 pages.
  assert.deepEqual(judgeFit(measurement([3, 2, 2, 2, 1, 1]), 2), {
    kind: "fits",
    density: "relaxed",
  });
});

test("a plan that reaches the target only with enlarged typography is over-cut", () => {
  // Very-relaxed lands on 2 pages but standard needs just 1: the content was
  // cut well past what a 2-page target needed.
  assert.deepEqual(judgeFit(measurement([2, 2, 1, 1, 1, 1]), 2), {
    kind: "over-cut",
    standardPages: 1,
  });
});

test("unchanged content may accept an enlarged preset", () => {
  assert.deepEqual(
    judgeFit(measurement([2, 2, 1, 1, 1, 1]), 2, { allowRoomy: true }),
    { kind: "fits", density: "very-relaxed" },
  );
});

test("content that overflows at every preset reports overflow", () => {
  assert.deepEqual(judgeFit(measurement([5, 4, 3, 3, 3, 3]), 2), {
    kind: "overflow",
    densestPages: 3,
  });
});

test("content short of the target at every preset reports under", () => {
  assert.deepEqual(judgeFit(measurement([1, 1, 1, 1, 1, 1]), 2), {
    kind: "under",
    roomiestPages: 1,
  });
});

test("a single measured preset judges on its own page count", () => {
  const single = (pageCount) => ({
    pageCount,
    density: "source",
    observedPages: [pageCount],
    presets: [{ density: "source", pageCount }],
    standardPages: pageCount,
    densestPages: pageCount,
    overflow: null,
  });
  assert.equal(judgeFit(single(2), 2).kind, "fits");
  assert.equal(judgeFit(single(3), 2).kind, "overflow");
  assert.equal(judgeFit(single(1), 2).kind, "under");
});
