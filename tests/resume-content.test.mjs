import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeParsedResumes,
  normalizeParsedResume,
  splitResumeText,
} from "../lib/resumeParser.ts";
import { resolveResumeContent } from "../lib/pdf/shared.ts";

test("splitResumeText retains all paragraphs without a hard tail cutoff", () => {
  const paragraphs = Array.from(
    { length: 40 },
    (_, index) => `Section ${index}\n${"content ".repeat(50)}${index}`,
  );
  const source = paragraphs.join("\n\n");
  const chunks = splitResumeText(source, 700);

  assert.ok(chunks.length > 1);
  for (const paragraph of paragraphs) {
    assert.ok(
      chunks.some((chunk) => chunk.includes(paragraph)),
      `missing paragraph: ${paragraph.slice(0, 20)}`,
    );
  }
});

test("mergeParsedResumes preserves core and additional sections in source order", () => {
  const parsed = normalizeParsedResume({
    name: "Candidate",
    language: "en",
    experience: [
      {
        id: "local-role",
        company: "Company",
        title: "Engineer",
        start: "2024",
        end: "Present",
        bullets: [{ id: "local-bullet", text: "Built a product." }],
      },
    ],
    education: [
      { school: "University", degree: "BSc", year: "2024" },
    ],
    additionalSections: [
      {
        id: "award-source",
        kind: "awards",
        title: "Competition Awards",
        items: [
          {
            id: "award-1",
            heading: "First Prize",
            bullets: [],
          },
        ],
      },
    ],
    sectionOrder: [
      "education",
      "experience",
      "additional:award-source",
    ],
  });
  const merged = mergeParsedResumes([parsed]);

  assert.equal(merged.experience[0].id, "r1");
  assert.equal(merged.experience[0].bullets[0].id, "b1");
  assert.equal(merged.additionalSections?.[0].kind, "awards");
  assert.deepEqual(merged.sectionOrder, [
    "education",
    "experience",
    "additional:extra1",
  ]);
});

test("mergeParsedResumes deduplicates overlapping chunk entries", () => {
  const part = normalizeParsedResume({
    name: "Candidate",
    projects: [
      {
        name: "Project",
        role: "Developer",
        start: "2025",
        end: "2026",
        bullets: [{ text: "Designed the system." }],
      },
    ],
  });
  const merged = mergeParsedResumes([part, part]);

  assert.equal(merged.projects.length, 1);
  assert.equal(merged.projects[0].bullets.length, 1);
});

test("all PDF styles can consume one canonical complete document", () => {
  const resume = normalizeParsedResume({
    name: "Candidate",
    title: "Engineer",
    email: "candidate@example.com",
    experience: [
      {
        id: "r1",
        company: "Company",
        title: "Engineer",
        bullets: [{ id: "b1", text: "Original role bullet." }],
      },
    ],
    projects: [
      {
        id: "p1",
        name: "Project",
        role: "Lead",
        bullets: [{ id: "b2", text: "Original project bullet." }],
      },
    ],
    education: [{ school: "University", degree: "BSc", year: "2024" }],
    additionalSections: [
      {
        id: "extra1",
        kind: "awards",
        title: "Competition Awards",
        items: [
          {
            id: "award1",
            heading: "First Prize",
            bullets: [],
          },
        ],
      },
    ],
    sectionOrder: [
      "education",
      "projects",
      "experience",
      "additional:extra1",
    ],
  });
  const optimization = {
    title: "Senior Engineer",
    summary: "Optimized summary.",
    skills: ["TypeScript"],
    roles: [
      {
        id: "r1",
        bullets: [{ id: "ob1", text: "Optimized role bullet." }],
      },
    ],
    projects: [
      {
        id: "p1",
        bullets: [{ id: "ob2", text: "Optimized project bullet." }],
      },
    ],
  };

  const content = resolveResumeContent(resume, optimization);

  assert.equal(content.title, "Senior Engineer");
  assert.equal(content.summary, "Optimized summary.");
  assert.deepEqual(content.skills, ["TypeScript"]);
  assert.deepEqual(content.experience[0].bullets, ["Optimized role bullet."]);
  assert.deepEqual(content.projects[0].bullets, ["Optimized project bullet."]);
  assert.equal(content.education[0].school, "University");
  assert.equal(content.additionalSections[0].title, "Competition Awards");
  assert.equal(
    content.additionalSections[0].items[0].heading,
    "First Prize",
  );
  assert.deepEqual(content.sectionOrder, [
    "summary",
    "skills",
    "education",
    "projects",
    "experience",
    "additional:extra1",
  ]);
});
