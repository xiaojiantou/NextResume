// Copyright (c) 2026 HowBe LLC. All rights reserved.
import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_VERB_CEILING, projectAfter } from "../lib/atsProjection.ts";
import { scoreResume } from "../lib/atsScore.ts";

const job = {
  title: "Backend Engineer",
  company: "Acme",
  seniority: "mid",
  requiredKeywords: ["Kubernetes", "PostgreSQL", "Go", "gRPC"],
  niceToHaveKeywords: [],
  responsibilities: [],
};

function resumeWith(bullets) {
  return {
    name: "Sam",
    title: "",
    email: "sam@example.com",
    phone: "",
    location: "Boston",
    summary: "",
    skills: ["Go"],
    experience: [
      {
        id: "r1",
        company: "Acme",
        title: "Software Developer",
        bullets: bullets.map((text, index) => ({ id: `b${index}`, text })),
      },
    ],
    projects: [],
    education: [],
  };
}

const category = (categories, label) =>
  categories.find((c) => c.label === label);

test("quantified impact is never projected to rise", () => {
  const resume = resumeWith([
    "Worked on Go services for the billing team.",
    "Helped migrate the API to gRPC.",
  ]);
  const scored = scoreResume(resume, job);
  const { categoriesAfter } = projectAfter(scored.categories, resume, scored.overall);
  assert.equal(
    category(categoriesAfter, "Quantified impact").score,
    category(scored.categories, "Quantified impact").score,
  );
});

test("English bullets project action verbs up to the ceiling, Chinese ones stay put", () => {
  const english = resumeWith([
    "Worked on Go services for the billing team.",
    "Helped migrate the API to gRPC.",
  ]);
  const scoredEn = scoreResume(english, job);
  const en = projectAfter(scoredEn.categories, english, scoredEn.overall);
  assert.equal(category(en.categoriesAfter, "Action verbs").score, ACTION_VERB_CEILING);

  const chinese = resumeWith(["负责计费团队的 Go 服务。", "参与将 API 迁移到 gRPC。"]);
  const scoredZh = scoreResume(chinese, job);
  const zh = projectAfter(scoredZh.categories, chinese, scoredZh.overall);
  assert.equal(
    category(zh.categoriesAfter, "Action verbs").score,
    category(scoredZh.categories, "Action verbs").score,
  );
});

test("headline is projected to match and the total never drops below the source", () => {
  const resume = resumeWith(["Worked on Go services."]);
  const scored = scoreResume(resume, job);
  const { overallAfter, categoriesAfter } = projectAfter(
    scored.categories,
    resume,
    scored.overall,
  );
  assert.equal(category(categoriesAfter, "Title match").score, 100);
  assert.ok(overallAfter >= scored.overall);
  assert.ok(overallAfter <= 100);
});

test("the projection promises less than the old formula did", () => {
  const resume = resumeWith([
    "Worked on Go services for the billing team.",
    "Helped migrate the API to gRPC.",
  ]);
  const scored = scoreResume(resume, job);
  const { overallAfter } = projectAfter(scored.categories, resume, scored.overall);
  // Old formula: title 100, verbs 90, keyword +40% of gap, quantified +30%.
  const close = (s, share) => Math.round(s + (100 - s) * share);
  const weights = {
    "Keyword match": 0.45,
    "Title match": 0.2,
    "Quantified impact": 0.15,
    "Action verbs": 0.12,
    "ATS formatting": 0.08,
  };
  const old = Math.round(
    scored.categories.reduce((sum, c) => {
      const score =
        c.label === "Title match" ? 100
          : c.label === "Action verbs" ? Math.max(c.score, 90)
            : c.label === "Keyword match" ? close(c.score, 0.4)
              : c.label === "Quantified impact" ? close(c.score, 0.3)
                : c.score;
      return sum + score * weights[c.label];
    }, 0),
  );
  assert.ok(overallAfter < old, `${overallAfter} should be below the old ${old}`);
});
