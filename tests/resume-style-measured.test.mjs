// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The clamps that keep a vision model honest were also being applied to
// numbers read off the source file. This pins the distinction: a guess stays
// clamped, a measurement is adopted.

import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeResumeStyleProfile } from "../lib/resumeStyle.ts";

const PAGE = { widthPt: 595.32, heightPt: 841.92, orientation: "portrait" };

// What the vision model returned for the resume in question: plausible,
// generic, and wrong in every dimension that controls density.
const ESTIMATE = {
  fontFamily: "Helvetica",
  headingFontFamily: "Helvetica",
  typography: {
    bodyPt: 11,
    lineHeight: 1.4,
    namePt: 24,
    titlePt: 13,
    sectionPt: 14,
    metaPt: 10,
  },
  spacing: { sectionPt: 16, entryPt: 10, bulletPt: 6 },
  marginsPt: { top: 54, right: 54, bottom: 54, left: 54 },
};

// What the file actually does, straight off its own text geometry.
const METRICS = {
  bodyPt: 9.5,
  namePt: 20,
  titlePt: 10,
  sectionPt: 11,
  metaPt: 9.5,
  lineHeight: 1.158,
  spacing: { sectionPt: 14.25, entryPt: 3, bulletPt: 0.5 },
  marginsPt: { top: 13.7, right: 28, bottom: 28, left: 28 },
  serif: true,
  sampledChars: 5315,
};

const sourceWith = (styleMetrics) => ({
  screenshots: ["data:image/jpeg;base64,AA=="],
  page: PAGE,
  pageCount: 1,
  styleMetrics,
});

test("measured typography is adopted instead of the estimate", () => {
  const profile = sanitizeResumeStyleProfile(ESTIMATE, sourceWith(METRICS));
  assert.equal(profile.typography.bodyPt, 9.5);
  assert.equal(profile.typography.sectionPt, 11);
  assert.equal(profile.typography.namePt, 20);
  assert.ok(Math.abs(profile.typography.lineHeight - 1.158) < 0.001);
  assert.equal(profile.measured, true);
});

test("measured values survive bounds the estimate would have been clamped by", () => {
  const profile = sanitizeResumeStyleProfile(ESTIMATE, sourceWith(METRICS));
  // The old floors were bodyPt 10, lineHeight 1.25, margins 36. Each one is a
  // silent inflation when the source genuinely sits below it.
  assert.ok(profile.typography.bodyPt < 10);
  assert.ok(profile.typography.lineHeight < 1.25);
  assert.equal(profile.marginsPt.left, 28);
  assert.equal(profile.marginsPt.right, 28);
});

test("measured bullet spacing survives the floor the estimate pays", () => {
  const profile = sanitizeResumeStyleProfile(ESTIMATE, sourceWith(METRICS));
  // The estimate's floor is 1.5pt per bullet. Across a resume's worth of
  // bullets that is the single largest contributor to a one-page source
  // rendering as two.
  assert.equal(profile.spacing.bulletPt, 0.5);
  assert.equal(profile.spacing.entryPt, 3);
  assert.ok(Math.abs(profile.spacing.sectionPt - 14.25) < 0.01);
});

test("spacing falls back to the estimate when it could not be measured", () => {
  const profile = sanitizeResumeStyleProfile(
    ESTIMATE,
    sourceWith({ ...METRICS, spacing: null }),
  );
  assert.equal(profile.spacing.bulletPt, 6);
  // Typography was still measured, so the rest of the override still applies.
  assert.equal(profile.typography.bodyPt, 9.5);
});

test("an unreadable measurement is still refused", () => {
  const profile = sanitizeResumeStyleProfile(
    ESTIMATE,
    sourceWith({ ...METRICS, bodyPt: 2, marginsPt: { ...METRICS.marginsPt, left: 0 } }),
  );
  assert.ok(profile.typography.bodyPt >= 8);
  assert.ok(profile.marginsPt.left >= 18);
});

test("a serif source is not rendered in the sans the model guessed", () => {
  const profile = sanitizeResumeStyleProfile(ESTIMATE, sourceWith(METRICS));
  assert.equal(profile.fontFamily, "Times New Roman");
  assert.equal(profile.headingFontFamily, "Times New Roman");
});

test("a model that already picked the right class keeps its choice", () => {
  // Georgia is a serif; the measurement agrees on the class, so there is
  // nothing to correct and the model's more specific pick stands.
  const profile = sanitizeResumeStyleProfile(
    { ...ESTIMATE, fontFamily: "Georgia", headingFontFamily: "Georgia" },
    sourceWith(METRICS),
  );
  assert.equal(profile.fontFamily, "Georgia");
});

test("an undecidable font mix leaves the estimate alone", () => {
  const profile = sanitizeResumeStyleProfile(
    ESTIMATE,
    sourceWith({ ...METRICS, serif: null }),
  );
  assert.equal(profile.fontFamily, "Helvetica");
});

test("without a measurement the estimate is clamped exactly as before", () => {
  const profile = sanitizeResumeStyleProfile(ESTIMATE, sourceWith(null));
  assert.equal(profile.typography.bodyPt, 11);
  assert.equal(profile.typography.lineHeight, 1.4);
  assert.equal(profile.marginsPt.left, 54);
  assert.equal(profile.fontFamily, "Helvetica");
  assert.notEqual(profile.measured, true);
});
