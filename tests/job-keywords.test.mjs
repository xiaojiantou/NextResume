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

test("heading suffixes are stripped down to the searchable term", () => {
  // "AI Development:" and "Generative AI Solutions:" are section labels in the
  // Volvo posting; the term inside each one is real.
  assert.deepEqual(
    sanitizeKeywords(["AI development", "Generative AI Solutions", "AI-powered applications"]),
    ["AI", "Generative AI", "AI-powered"],
  );

  // Terms that merely end in a similar-looking noun must survive intact.
  assert.deepEqual(
    sanitizeKeywords(["prompt engineering", "distributed systems", "data analysis", "machine learning"]),
    ["prompt engineering", "distributed systems", "data analysis", "machine learning"],
  );
});

test("stripping a suffix can collapse into an existing keyword", () => {
  assert.deepEqual(
    sanitizeKeywords(["Generative AI", "Generative AI tools"]),
    ["Generative AI"],
  );
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
