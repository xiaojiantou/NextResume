import assert from "node:assert/strict";
import test from "node:test";
import {
  SHRINK_BATCH_SIZES,
  findShrinkCandidates,
  revertShrinkCandidates,
} from "../lib/texPageGuard.ts";

const resume = {
  name: "Candidate",
  title: "Engineer",
  summary: "Builds reliable backend systems.",
  skills: ["Python"],
  experience: [
    {
      id: "r1",
      company: "Acme",
      title: "Engineer",
      bullets: [
        { id: "b1", text: "Wrote the internal client library other teams used to publish events." },
        { id: "b2", text: "Owned on-call for the payments domain." },
        { id: "b3", text: "Shipped a caching layer." },
      ],
    },
  ],
  projects: [
    { id: "p1", name: "Side", role: "", bullets: [{ id: "b4", text: "Built a CLI tool." }] },
  ],
  additionalSections: [],
};

const bullet = (id, text) => ({ id, text, evidence: [id], matchedKeywords: ["k"], rationale: "why", contentReview: { status: "improved" } });

test("only bullets and a summary that grew past their source are shrink candidates, longest growth first", () => {
  const optimization = {
    summary: "Builds reliable backend systems used company-wide across every product line.",
    title: "Engineer",
    skills: ["Python"],
    roles: [{ id: "r1", bullets: [
      bullet("b1", "Wrote the internal client library in Python that other teams used to publish events, standardizing integration."),
      bullet("b2", "Ran on-call."), // shorter than source: never a candidate
      bullet("b3", "Shipped a caching layer."), // unchanged: never a candidate
    ] }],
    projects: [{ id: "p1", bullets: [bullet("p1-unused", "irrelevant")] }],
  };
  // p1's real bullet id is b4; give it a growth too for coverage.
  optimization.projects[0].bullets = [bullet("b4", "Built and documented a small CLI tool for the team.")];

  const candidates = findShrinkCandidates(resume, optimization);
  const ids = candidates.map((c) => c.id);
  assert.deepEqual(ids, ["summary", "b1", "b4"]);
  assert.deepEqual(
    candidates.map((c) => c.growth),
    candidates.map((c) => c.growth).slice().sort((a, b) => b - a),
  );
  assert.equal(candidates.find((c) => c.id === "summary").kind, "summary");
  assert.equal(candidates.find((c) => c.id === "b1").kind, "bullet");
});

test("reverting restores exact source wording and strips rewrite annotations, leaving other bullets untouched", () => {
  const optimization = {
    summary: "A much longer summary than the original one ever was.",
    title: "Engineer",
    skills: ["Python"],
    roles: [{ id: "r1", bullets: [
      bullet("b1", "A longer rewrite of the client library bullet."),
      bullet("b2", "Owned on-call for the payments domain."), // identical to source
      bullet("b3", "Shipped a caching layer."),
    ] }],
    projects: [{ id: "p1", bullets: [bullet("b4", "A longer rewrite of the CLI bullet.")] }],
  };
  const reverted = revertShrinkCandidates(resume, optimization, new Set(["b1", "summary"]));
  assert.equal(reverted.summary, resume.summary);
  const b1 = reverted.roles[0].bullets.find((b) => b.id === "b1");
  assert.equal(b1.text, resume.experience[0].bullets[0].text);
  assert.deepEqual(b1.evidence, ["b1"]);
  assert.deepEqual(b1.matchedKeywords, []);
  assert.equal(b1.contentReview, undefined);
  // Untouched sibling bullets and the other entry keep their rewritten text.
  assert.equal(reverted.roles[0].bullets.find((b) => b.id === "b3").text, "Shipped a caching layer.");
  assert.equal(reverted.projects[0].bullets[0].text, "A longer rewrite of the CLI bullet.");
});

test("reverting an empty id set is a no-op that returns the same optimization", () => {
  const optimization = { summary: "x", title: "t", skills: [], roles: [], projects: [] };
  assert.equal(revertShrinkCandidates(resume, optimization, new Set()), optimization);
});

test("batch sizes escalate from small to large so a small overflow reverts few bullets", () => {
  assert.deepEqual(SHRINK_BATCH_SIZES, [1, 3, 8]);
  assert.ok(SHRINK_BATCH_SIZES.every((size, i) => i === 0 || size > SHRINK_BATCH_SIZES[i - 1]));
});
