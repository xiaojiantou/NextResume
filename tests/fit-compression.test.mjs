// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import {
  createFullFitPlan,
  createProportionalCompressionPlan,
} from "../lib/fitCompression.ts";
import { planTextLength } from "../lib/fitPlan.ts";

const text = (n, length = 120) => `Bullet ${n} `.padEnd(length, "x");

function bullet(id, { keywords = 0, number = false, length = 120 } = {}) {
  return {
    id,
    text: `${text(id, length - (number ? 4 : 0))}${number ? " 42%" : ""}`,
    evidence: [id],
    matchedKeywords: Array.from({ length: keywords }, (_, i) => `kw${i}`),
    rationale: "test",
  };
}

const resume = {
  name: "Test",
  title: "",
  email: "",
  phone: "",
  location: "",
  summary: "First sentence. Second sentence. Third sentence.",
  skills: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
  experience: [
    {
      id: "new",
      company: "Newest",
      title: "Lead",
      location: "",
      start: "2024",
      end: "Present",
      bullets: ["n1", "n2", "n3", "n4"].map((id) => ({ id, text: text(id) })),
    },
    {
      id: "mid",
      company: "Middle",
      title: "Engineer",
      location: "",
      start: "2020",
      end: "2023",
      bullets: ["m1", "m2", "m3"].map((id) => ({ id, text: text(id) })),
    },
    {
      id: "old",
      company: "Oldest",
      title: "Intern",
      location: "",
      start: "2016",
      end: "2017",
      bullets: ["o1", "o2"].map((id) => ({ id, text: text(id) })),
    },
  ],
  projects: [],
  education: [],
};

const optimization = {
  summary: resume.summary,
  title: "",
  skills: resume.skills,
  roles: [
    {
      id: "new",
      bullets: [
        bullet("n1", { keywords: 3, number: true }),
        bullet("n2", { keywords: 2 }),
        bullet("n3", { keywords: 1 }),
        bullet("n4"),
      ],
    },
    {
      id: "mid",
      bullets: [
        bullet("m1", { keywords: 2, number: true }),
        bullet("m2"),
        bullet("m3"),
      ],
    },
    { id: "old", bullets: [bullet("o1"), bullet("o2")] },
  ],
  projects: [],
};

const visibleBulletIds = (plan) =>
  plan.roles
    .filter((role) => !role.hidden)
    .flatMap((role) => role.bullets.map((b) => b.id));

test("zero removal keeps the full master", () => {
  const plan = createProportionalCompressionPlan({
    resume,
    optimization,
    structureMode: "optimize",
    protectedContentIds: [],
    removalLines: 0,
  });
  assert.deepEqual(plan, createFullFitPlan(resume, optimization));
  assert.equal(visibleBulletIds(plan).length, 9);
});

test("a small overflow removes only the weakest bullets from the oldest entries", () => {
  const plan = createProportionalCompressionPlan({
    resume,
    optimization,
    structureMode: "optimize",
    protectedContentIds: [],
    removalLines: 3,
    charsPerLine: 90,
  });
  const visible = visibleBulletIds(plan);
  // Two unremarkable bullets go (each ~2 wrapped lines plus a row gap).
  assert.equal(visible.length, 7);
  // The oldest role's plain bullet goes first; its last bullet stays as the
  // per-role minimum, so the next victim is a plain bullet in the middle role.
  assert.ok(!visible.includes("o2") || !visible.includes("o1"));
  assert.ok(visible.includes("n1") && visible.includes("n2"));
  assert.ok(visible.includes("m1"));
  assert.ok(plan.roles.every((role) => !role.hidden));
  assert.equal(plan.summary, resume.summary);
  assert.equal(plan.skills.length, 10);
});

test("bullet removal respects per-role minimums before hiding whole entries", () => {
  const plan = createProportionalCompressionPlan({
    resume,
    optimization,
    structureMode: "optimize",
    protectedContentIds: [],
    removalLines: 8,
    charsPerLine: 90,
  });
  const newest = plan.roles.find((role) => role.id === "new");
  const mid = plan.roles.find((role) => role.id === "mid");
  const old = plan.roles.find((role) => role.id === "old");
  assert.ok(newest.bullets.length >= 2);
  assert.ok(!newest.hidden);
  // Older roles are trimmed to one bullet each before either is hidden.
  for (const role of [mid, old]) {
    if (!role.hidden) assert.ok(role.bullets.length >= 1);
  }
});

test("a large overflow hides the oldest role first and never the newest", () => {
  const plan = createProportionalCompressionPlan({
    resume,
    optimization,
    structureMode: "optimize",
    protectedContentIds: [],
    removalLines: 14,
    charsPerLine: 90,
  });
  const old = plan.roles.find((role) => role.id === "old");
  const newest = plan.roles.find((role) => role.id === "new");
  assert.equal(old.hidden, true);
  assert.equal(newest.hidden, false);
  assert.ok(newest.bullets.length >= 2);
});

test("the summary is trimmed only after entries are exhausted", () => {
  const modest = createProportionalCompressionPlan({
    resume,
    optimization,
    structureMode: "optimize",
    protectedContentIds: [],
    removalLines: 6,
  });
  assert.equal(modest.summary, resume.summary);
  const drastic = createProportionalCompressionPlan({
    resume,
    optimization,
    structureMode: "optimize",
    protectedContentIds: [],
    removalLines: 60,
  });
  assert.equal(drastic.summary, "First sentence.");
  assert.ok(drastic.skills.length >= 8);
});

test("protected content is never removed", () => {
  const plan = createProportionalCompressionPlan({
    resume,
    optimization,
    structureMode: "optimize",
    protectedContentIds: ["o2", "mid", "summary"],
    removalLines: 60,
  });
  const old = plan.roles.find((role) => role.id === "old");
  const mid = plan.roles.find((role) => role.id === "mid");
  assert.equal(old.hidden, false);
  assert.ok(old.bullets.some((b) => b.id === "o2"));
  assert.equal(mid.hidden, false);
  assert.equal(mid.bullets.length, 3);
  assert.equal(plan.summary, resume.summary);
});

test("planTextLength shrinks with the cut", () => {
  const full = createFullFitPlan(resume, optimization);
  const cut = createProportionalCompressionPlan({
    resume,
    optimization,
    structureMode: "optimize",
    protectedContentIds: [],
    removalLines: 3,
  });
  assert.ok(planTextLength(cut) < planTextLength(full));
});
