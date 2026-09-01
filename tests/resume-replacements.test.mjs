// Copyright (c) 2026 HowBe LLC. All rights reserved.

// What the format-preserving exports agree to write back. Both the Word and
// LaTeX paths plan from this, so a gap here silently ships a weaker document
// than the rebuilt PDF made from the very same rewrite.

import assert from "node:assert/strict";
import test from "node:test";
import {
  collectResumeReplacements,
  collectSkillReplacements,
  planReplacements,
} from "../lib/resumeReplacements.ts";
import {
  MINIMUM_CONFIDENCE,
  normalizeParagraphText,
  similarity,
} from "../lib/alignParagraphs.ts";

const RESUME = {
  name: "Jane Doe",
  title: "Staff Engineer",
  email: "jane@example.com",
  phone: "",
  location: "Seattle, WA",
  summary: "",
  skills: ["Java", "Python", "Go", "AWS", "GCP"],
  experience: [
    {
      id: "r1",
      company: "Acme",
      title: "Backend Engineer",
      location: "Seattle, WA",
      start: "2021",
      end: "Present",
      bullets: [{ id: "b1", text: "Reduced p99 checkout latency by 43%" }],
    },
  ],
  projects: [],
  education: [],
};

const OPTIMIZATION = {
  title: "Staff Engineer",
  summary: "",
  skills: ["Java", "Python", "Go", "AWS", "GCP"],
  roles: [
    { id: "r1", bullets: [{ id: "b1", text: "Reduced p99 checkout latency by 43%" }] },
  ],
  projects: [],
};

const idsOf = (replacements) => replacements.map((item) => item.id);
const byId = (replacements, id) =>
  replacements.find((item) => item.id === id) ?? null;

// --- additional sections --------------------------------------------------

test("awards and certifications are rewritten, not left behind", () => {
  const replacements = collectResumeReplacements(
    {
      ...RESUME,
      additionalSections: [
        {
          id: "extra1",
          kind: "awards",
          title: "Awards",
          items: [
            {
              id: "a1",
              heading: "Hackathon",
              subheading: "",
              location: "",
              start: "",
              end: "",
              bullets: [{ id: "b9", text: "Won the internal hackathon" }],
            },
          ],
        },
      ],
    },
    {
      ...OPTIMIZATION,
      additionalSections: [
        {
          id: "extra1",
          items: [
            {
              id: "a1",
              bullets: [
                { id: "b9", text: "Won the company-wide hackathon against 60 teams" },
              ],
            },
          ],
        },
      ],
    },
    true,
  );
  assert.equal(
    byId(replacements, "b9").optimized,
    "Won the company-wide hackathon against 60 teams",
  );
});

// --- headline -------------------------------------------------------------

test("a headline that is really a role's job title is never rewritten", () => {
  // The parser reports the most-recent role's title as `title` whenever the
  // resume has no headline of its own. Rewriting that would overwrite an
  // employment entry with a JD-tailored headline.
  const replacements = collectResumeReplacements(
    { ...RESUME, title: "Backend Engineer" },
    { ...OPTIMIZATION, title: "Platform Engineer" },
    true,
  );
  assert.ok(!idsOf(replacements).includes("title"));
});

test("a headline of its own is offered, and only on an exact match", () => {
  const replacements = collectResumeReplacements(
    RESUME,
    { ...OPTIMIZATION, title: "Platform Engineer" },
    true,
  );
  const title = byId(replacements, "title");
  assert.equal(title.original, "Staff Engineer");
  assert.equal(title.optimized, "Platform Engineer");
  assert.equal(title.requireExact, true);
});

test("a near-miss headline is reported rather than written somewhere plausible", () => {
  const drifted = "Staff Engineer.";
  // The fuzzy matcher would happily take this line — requireExact is the only
  // thing standing between the headline and whatever merely resembles it.
  assert.ok(
    similarity(
      normalizeParagraphText(RESUME.title),
      normalizeParagraphText(drifted),
    ) > MINIMUM_CONFIDENCE,
  );
  const plan = planReplacements({
    resume: RESUME,
    optimization: { ...OPTIMIZATION, title: "Platform Engineer" },
    units: [{ index: 0, text: drifted }],
  });
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.unplaced, ["title"]);
});

test("an exact headline line is written back", () => {
  const plan = planReplacements({
    resume: RESUME,
    optimization: { ...OPTIMIZATION, title: "Platform Engineer" },
    units: [{ index: 0, text: "Staff Engineer" }],
  });
  assert.deepEqual(plan.edits, [{ index: 0, text: "Platform Engineer" }]);
});

// --- skills ---------------------------------------------------------------

test("an ungrouped skills line is rewritten whole, additions included", () => {
  const { replacements, omitted } = collectSkillReplacements(RESUME, {
    ...OPTIMIZATION,
    skills: ["Python", "Java", "Go", "AWS", "GCP", "Kubernetes"],
  });
  assert.deepEqual(omitted, []);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].original, "Java, Python, Go, AWS, GCP");
  assert.equal(
    replacements[0].optimized,
    "Python, Java, Go, AWS, GCP, Kubernetes",
  );
});

test("grouped skills are reordered inside their own category", () => {
  const { replacements } = collectSkillReplacements(
    {
      ...RESUME,
      skillGroups: [
        { label: "Languages", skills: ["Java", "Python", "Go"] },
        { label: "Cloud", skills: ["AWS", "GCP"] },
      ],
    },
    {
      ...OPTIMIZATION,
      skills: ["Python", "AWS", "Go", "Java", "GCP"],
    },
  );
  assert.deepEqual(idsOf(replacements), ["skills:Languages", "skills:Cloud"]);
  assert.equal(replacements[0].original, "Languages: Java, Python, Go");
  assert.equal(replacements[0].optimized, "Languages: Python, Go, Java");
  // Every original skill survives, and the label is untouched.
  assert.equal(replacements[1].optimized, "Cloud: AWS, GCP");
});

test("a skill with no category is reported, never filed under a guess", () => {
  const { omitted } = collectSkillReplacements(
    {
      ...RESUME,
      skillGroups: [{ label: "Languages", skills: ["Java", "Python", "Go"] }],
    },
    { ...OPTIMIZATION, skills: ["Python", "Go", "Java", "Kubernetes"] },
  );
  // "Kubernetes" under "Languages" would be worse than not writing it at all.
  assert.deepEqual(omitted, ["Kubernetes"]);
});

test("preserve mode adds no skills, so a grouped source omits nothing", () => {
  const { omitted } = collectSkillReplacements(
    {
      ...RESUME,
      skillGroups: [
        { label: "Languages", skills: ["Java", "Python", "Go"] },
        { label: "Cloud", skills: ["AWS", "GCP"] },
      ],
    },
    { ...OPTIMIZATION, structureMode: "preserve" },
  );
  assert.deepEqual(omitted, []);
});

// --- ordering -------------------------------------------------------------

test("bullets get first claim on a source line, ahead of skills", () => {
  const replacements = collectResumeReplacements(
    RESUME,
    {
      ...OPTIMIZATION,
      title: "Platform Engineer",
      skills: ["Python", "Java", "Go", "AWS", "GCP"],
    },
    true,
  );
  const ids = idsOf(replacements);
  assert.ok(ids.indexOf("b1") < ids.indexOf("title"));
  assert.ok(ids.indexOf("title") < ids.indexOf("skills"));
});
