import assert from "node:assert/strict";
import test from "node:test";
import {
  isNoiseKeyword,
  sanitizeJobKeywords,
  sanitizeKeywords,
} from "../lib/jobKeywords.ts";

// Verbatim output from the production parser on a real Volvo Financial
// Services posting. The last six are the posting's own section labels and its
// eligibility criteria.
const OBSERVED_BAD_PARSE = [
  "Python",
  "Java",
  "C#",
  "JavaScript",
  "Generative AI",
  "machine learning",
  "data analysis",
  "AI development",
  "testing and validation",
  "documentation",
  "collaboration",
  "continuous improvement",
  "Computer Science degree",
  "2.75 GPA",
];

test("the observed bad parse is cleaned without losing real skills", () => {
  const cleaned = sanitizeKeywords(OBSERVED_BAD_PARSE);

  for (const keep of ["Python", "Java", "C#", "JavaScript", "Generative AI", "machine learning"]) {
    assert.ok(cleaned.includes(keep), `dropped a real skill: ${keep}`);
  }
  for (const drop of ["testing and validation", "documentation", "collaboration", "continuous improvement", "Computer Science degree", "2.75 GPA"]) {
    assert.ok(!cleaned.includes(drop), `kept noise: ${drop}`);
  }
});

test("section labels and soft skills are noise", () => {
  for (const noise of [
    "documentation", "collaboration", "communication", "teamwork",
    "continuous improvement", "testing and validation", "problem solving",
    "attention to detail", "cross-functional collaboration", "ownership",
  ]) {
    assert.ok(isNoiseKeyword(noise), `should be noise: ${noise}`);
  }
});

test("eligibility and logistics are noise", () => {
  for (const noise of [
    "Computer Science degree", "2.75 GPA", "cumulative GPA of at least 2.75",
    "30 semester hours", "Bachelor's degree", "must be enrolled",
    "work authorization", "40 hours per week",
  ]) {
    assert.ok(isNoiseKeyword(noise), `should be noise: ${noise}`);
  }
});

test("real skills survive, including short and punctuated ones", () => {
  for (const keep of [
    "Python", "C#", "C++", "Next.js", "CI/CD", "PyTorch", "Generative AI",
    "machine learning", "A/B testing", "data analysis", "Kubernetes",
    "5+ years", "serverless", "REST API", "prompt engineering",
  ]) {
    assert.ok(!isNoiseKeyword(keep), `should survive: ${keep}`);
  }
});

test("sentence fragments are rejected on length", () => {
  assert.ok(isNoiseKeyword("experience with one or more programming languages"));
  assert.ok(isNoiseKeyword("ability to translate business needs into technical solutions"));
});

// Detected from the posting text, so this works on any posting rather than a
// hand-tuned suffix list.
test("section headings are identified from the posting itself", () => {
  const posting = `
    Data Analysis: Review and analyze large datasets to find patterns.
    AI Development: Collaborate with engineering teams to train and refine
    machine learning and Generative AI solutions using Python and PyTorch.
    Documentation: Maintain clear records of model performance.
  `;
  const cleaned = sanitizeKeywords(
    ["AI Development", "Data Analysis", "Python", "PyTorch", "machine learning", "Generative AI"],
    posting,
  );
  // Headings appear only as headings; the real terms appear in the prose.
  assert.deepEqual(cleaned, ["Python", "PyTorch", "machine learning", "Generative AI"]);
});

test("a term used in prose survives even if it also heads a section", () => {
  const posting = `
    Python: You will write Python daily, and our services are built in Python.
    Kubernetes: Deploy to Kubernetes.
  `;
  assert.deepEqual(
    sanitizeKeywords(["Python", "Kubernetes"], posting),
    ["Python", "Kubernetes"],
  );
});

// The suffix-stripping heuristic this replaced was tuned to one posting and
// would have wrecked these.
test("real compound terms are never mangled", () => {
  const posting = "We need Business Development, Software Development, prompt engineering, distributed systems, and data analysis.";
  assert.deepEqual(
    sanitizeKeywords(
      ["Business Development", "Software Development", "prompt engineering", "distributed systems", "data analysis"],
      posting,
    ),
    ["Business Development", "Software Development", "prompt engineering", "distributed systems", "data analysis"],
  );
});

test("heading detection is skipped when no posting text is supplied", () => {
  assert.deepEqual(sanitizeKeywords(["AI Development"]), ["AI Development"]);
});

test("duplicates are collapsed case-insensitively, order preserved", () => {
  assert.deepEqual(
    sanitizeKeywords(["Python", "python", " PYTHON ", "Docker"]),
    ["Python", "Docker"],
  );
});

test("a nice-to-have that is also required is dropped from nice-to-have", () => {
  const job = sanitizeJobKeywords({
    requiredKeywords: ["Python", "Docker", "documentation"],
    niceToHaveKeywords: ["docker", "Kubernetes", "teamwork"],
  });
  assert.deepEqual(job.requiredKeywords, ["Python", "Docker"]);
  assert.deepEqual(job.niceToHaveKeywords, ["Kubernetes"]);
});

test("malformed model output degrades to an empty list, not a crash", () => {
  assert.deepEqual(sanitizeKeywords(undefined), []);
  assert.deepEqual(sanitizeKeywords("Python"), []);
  assert.deepEqual(sanitizeKeywords([null, 42, "", "   ", "Python"]), ["Python"]);
});
