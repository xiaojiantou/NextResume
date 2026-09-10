// Copyright (c) 2026 HowBe LLC. All rights reserved.
import assert from "node:assert/strict";
import test from "node:test";
import { bulletAtsGain } from "../lib/bulletAtsGain.ts";
import { parseContentReviews, selectReviewedContent } from "../lib/contentQuality.ts";

const job = { requiredKeywords: ["API development", "Kubernetes"], niceToHaveKeywords: [] };

test("a stronger opener the audit certifies is a gain", () => {
  assert.match(
    bulletAtsGain({ source: "Helped prepare email campaigns for course launches.", candidate: "Prepared email campaigns for course launches.", job }),
    /"Prepared"/,
  );
  assert.match(
    bulletAtsGain({ source: "I was responsible for adding prompt caching to the assistant.", candidate: "Added prompt caching to the assistant.", job }),
    /"Added"/,
  );
  // Leading with the documented result is the writing standard's own example.
  assert.match(
    bulletAtsGain({
      source: "I was responsible for adding prompt caching; cost fell from $12 to $9 per 1,000 requests.",
      candidate: "Reduced cost from $12 to $9 per 1,000 requests by adding prompt caching.",
      job,
    }),
    /"Reduced"/,
  );
});

test("an ownership verb the source never used is not a gain, nor is a same-strength swap", () => {
  assert.equal(bulletAtsGain({ source: "Assisted with weekly supplier reviews.", candidate: "Owned supplier strategy.", job }), null);
  assert.equal(bulletAtsGain({ source: "Helped prepare email campaigns.", candidate: "Led email campaigns.", job }), null);
  assert.equal(bulletAtsGain({ source: "Helped the team ship the release.", candidate: "Managed the release.", job }), null);
  // The source already claims it, so the verb is not an upgrade.
  assert.match(bulletAtsGain({ source: "Was responsible for managing vendor onboarding.", candidate: "Managed vendor onboarding.", job }), /"Managed"/);
  // Already-strong openers have nothing to gain.
  assert.equal(bulletAtsGain({ source: "Built a Python API for invoices.", candidate: "Developed a Python API for invoices.", job }), null);
});

test("Chinese rewrites follow the same rules", () => {
  assert.match(
    bulletAtsGain({ source: "负责用 SQL 整理门店销售数据，并向区域经理展示销售趋势。", candidate: "用 SQL 整理门店销售数据后，向区域经理展示按品类拆分的销售趋势。", job }),
    /opens with/,
  );
  assert.match(
    bulletAtsGain({ source: "参与将 API 迁移到 gRPC。", candidate: "迁移 API 到 gRPC。", job }),
    /"迁移"/,
  );
  // "主导" asserts ownership the source ("协助") never claimed.
  assert.equal(bulletAtsGain({ source: "协助运营经理整理供应商评审。", candidate: "主导供应商评审。", job }), null);
});

test("naming a posting keyword the source lacks is a gain; an alias the source already has is not", () => {
  assert.match(
    bulletAtsGain({ source: "Built REST endpoints for the billing service.", candidate: "Built REST endpoints, handling API development for the billing service.", job }),
    /"API development"/,
  );
  assert.equal(bulletAtsGain({ source: "Deployed services on K8s.", candidate: "Deployed services on Kubernetes.", job }), null);
});

test("a retained rewrite with the facts certified intact ships when it moves the rubric", () => {
  const pair = [{ id: "b1", source: "Helped prepare email campaigns for course launches.", candidate: "Prepared email campaigns for course launches." }];
  const rows = { reviews: [{ id: "b1", decision: "retain", supported: true, detailsPreserved: true, causalityPreserved: true, reason: "Cosmetic verb change only.", dimensions: [], nextStep: "ask", question: "How many campaigns?" }] };
  const review = parseContentReviews(rows, pair, job).get("b1");
  assert.equal(review.status, "improved");
  assert.equal(review.reviewerDecision, "retain");
  assert.equal(review.selectionBasis, "ats_rubric");
  assert.equal(review.nextStep, "ask");
  assert.equal(review.revisionInstruction, undefined);
  assert.match(review.reason, /Kept the rewrite/);
  assert.match(review.question, /campaigns/);
  const candidate = { roles: [{ id: "r1", bullets: [{ id: "b1", text: pair[0].candidate, evidence: ["b1"], matchedKeywords: [], rationale: "" }] }], projects: [] };
  const selected = selectReviewedContent(candidate, new Map([["b1", review]])).roles[0].bullets[0];
  assert.equal(selected.text, pair[0].candidate);
  assert.equal(selected.contentReview.reviewerDecision, "retain");
  assert.equal(selected.contentReview.selectionBasis, "ats_rubric");
});

test("a failed audit flag or an unchanged bullet never unlocks the ATS path", () => {
  const pair = [{ id: "b1", source: "Helped prepare email campaigns.", candidate: "Prepared email campaigns." }];
  for (const flag of ["supported", "detailsPreserved", "causalityPreserved"]) {
    const rows = { reviews: [{ id: "b1", decision: "retain", supported: true, detailsPreserved: true, causalityPreserved: true, reason: "Lost a detail.", dimensions: [], [flag]: false }] };
    const review = parseContentReviews(rows, pair, job).get("b1");
    assert.equal(review.status, "retained");
    assert.equal(review.reviewerDecision, "retain");
    assert.equal(review.selectionBasis, "source");
  }
  const same = [{ id: "b1", source: pair[0].source, candidate: pair[0].source }];
  const rows = { reviews: [{ id: "b1", decision: "retain", supported: true, detailsPreserved: true, causalityPreserved: true, reason: "Unchanged.", dimensions: [] }] };
  const review = parseContentReviews(rows, same, job).get("b1");
  assert.equal(review.status, "retained");
  assert.equal(review.reviewerDecision, "retain");
  assert.equal(review.selectionBasis, "source");
});

test("a model endorsement stays distinct from the final source selection when an audit fails", () => {
  const pair = [{ id: "b1", source: "Was responsible for documenting the escalation process.", candidate: "Documented the escalation process." }];
  const row = { id: "b1", decision: "improved", supported: true, detailsPreserved: true, causalityPreserved: true, reason: "The documented task is stated directly.", dimensions: ["clarity"] };
  const endorsed = parseContentReviews({ reviews: [row] }, pair, job).get("b1");
  assert.equal(endorsed.status, "improved");
  assert.equal(endorsed.reviewerDecision, "improved");
  assert.equal(endorsed.selectionBasis, "quality_review");

  const rejected = parseContentReviews({ reviews: [{ ...row, supported: false }] }, pair, job).get("b1");
  assert.equal(rejected.status, "retained");
  assert.equal(rejected.reviewerDecision, "improved");
  assert.equal(rejected.selectionBasis, "source");
});

test("missing, malformed and duplicate reviews do not invent a reviewer decision or selection basis", () => {
  const pair = [{ id: "b1", source: "Helped prepare email campaigns.", candidate: "Prepared email campaigns." }];
  const row = { id: "b1", decision: "retain", supported: true, detailsPreserved: true, causalityPreserved: true, reason: "Cosmetic only.", dimensions: [] };
  for (const raw of [null, { reviews: [] }, { reviews: [{ id: "b1", decision: "retain" }] }, { reviews: [row, row] }, { reviews: [{ ...row, decision: "improved" }] }]) {
    const review = parseContentReviews(raw, pair, job).get("b1");
    assert.equal(review.status, "unreviewed");
    assert.equal(Object.hasOwn(review, "reviewerDecision"), false);
    assert.equal(Object.hasOwn(review, "selectionBasis"), false);
  }
});
