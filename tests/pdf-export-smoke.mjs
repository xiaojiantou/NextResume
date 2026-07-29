import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { PDF_STYLE_DEFINITIONS } from "../lib/pdf/config.ts";

const baseUrl = process.env.PDF_TEST_BASE_URL || "http://127.0.0.1:3100";
const outputDir = process.env.PDF_TEST_OUTPUT_DIR;
if (outputDir) mkdirSync(outputDir, { recursive: true });

const resume = {
  name: "Alex Morgan",
  title: "Data & AI Engineer",
  email: "alex@example.com",
  phone: "+1 555 0100",
  location: "New York, NY",
  summary:
    "Data and AI engineer building reliable research and production systems.",
  skills: ["TypeScript", "Python", "Machine Learning"],
  experience: [
    {
      id: "r1",
      company: "Northstar Labs",
      title: "Senior Engineer",
      location: "Remote",
      start: "2023",
      end: "Present",
      bullets: [
        { id: "b1", text: "Built the original platform." },
        { id: "b2", text: "Improved reliability across critical workflows." },
      ],
    },
  ],
  projects: [
    {
      id: "p1",
      name: "Research Assistant",
      role: "Lead Developer",
      location: "",
      start: "2024",
      end: "2025",
      bullets: [{ id: "pb1", text: "Created a cited research workflow." }],
    },
  ],
  education: [
    {
      school: "State University",
      degree: "BS Computer Science",
      year: "2023",
    },
  ],
  additionalSections: [
    {
      id: "awards",
      kind: "awards",
      title: "Awards",
      items: [
        {
          id: "award-1",
          heading: "Research Excellence Award",
          subheading: "",
          location: "",
          start: "",
          end: "2024",
          bullets: [],
        },
      ],
    },
  ],
  sectionOrder: [
    "summary",
    "skills",
    "experience",
    "projects",
    "education",
    "additional:awards",
  ],
};

const optimization = {
  summary:
    "Data and AI engineer delivering reliable research and production systems.",
  title: "Senior Data & AI Engineer",
  skills: ["TypeScript", "Python", "Machine Learning"],
  roles: [
    {
      id: "r1",
      bullets: [
        {
          id: "ob1",
          text: "Built a production platform supporting research workflows.",
          evidence: ["b1"],
          matchedKeywords: ["platform"],
          rationale: "Clarifies production impact.",
        },
        {
          id: "ob2",
          text: "Improved reliability across critical engineering workflows.",
          evidence: ["b2"],
          matchedKeywords: ["reliability"],
          rationale: "Keeps the original result.",
        },
      ],
    },
  ],
  projects: [
    {
      id: "p1",
      bullets: [
        {
          id: "op1",
          text: "Created a cited workflow for research synthesis.",
          evidence: ["pb1"],
          matchedKeywords: ["research"],
          rationale: "Preserves project evidence.",
        },
      ],
    },
  ],
};

const expectedText = [
  "Alex Morgan",
  "Northstar Labs",
  "Built a production platform supporting research workflows.",
  "Research Assistant",
  "Created a cited workflow for research synthesis.",
  "State University",
  "Research Excellence Award",
];

for (const definition of PDF_STYLE_DEFINITIONS) {
  if (definition.id === "personalized") continue;
  const response = await fetch(`${baseUrl}/api/export/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume,
      optimization,
      style: definition.id,
      palette: definition.palettes[0].id,
      targetPages: 1,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    assert.fail(`${definition.id}: ${response.status} ${detail}`);
  }
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/pdf/);
  assert.ok(Number(response.headers.get("x-resume-pages")) >= 1);
  assert.ok(response.headers.get("x-resume-density"));

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
  if (outputDir) {
    writeFileSync(join(outputDir, `${definition.id}.pdf`), buffer);
  }
  const parsed = await pdfParse(buffer);
  const normalized = parsed.text.replace(/\s+/g, " ");
  for (const value of expectedText) {
    assert.ok(
      normalized.includes(value),
      `${definition.id}: missing "${value}"`,
    );
  }
  process.stdout.write(
    `${definition.id}: ${response.headers.get("x-resume-pages")} page(s), ${response.headers.get("x-resume-density")}\n`,
  );
}

const denseResume = {
  ...resume,
  summary:
    "Senior data and AI engineer leading complex platform, research, and delivery programs across multiple organizations.",
  experience: Array.from({ length: 12 }, (_, roleIndex) => ({
    id: `dense-role-${roleIndex}`,
    company: `Organization ${roleIndex + 1}`,
    title: `Senior Engineering Role ${roleIndex + 1}`,
    location: roleIndex % 2 === 0 ? "New York, NY" : "Remote",
    start: String(2011 + roleIndex),
    end: roleIndex === 11 ? "Present" : String(2012 + roleIndex),
    bullets: Array.from({ length: 5 }, (_, bulletIndex) => ({
      id: `dense-bullet-${roleIndex}-${bulletIndex}`,
      text:
        `Delivered program ${roleIndex + 1}.${bulletIndex + 1} while preserving detailed evidence, measurable outcomes, cross-functional ownership, and production reliability.`,
    })),
  })),
};

const denseResponse = await fetch(`${baseUrl}/api/export/pdf`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    resume: denseResume,
    optimization: null,
    style: "classic",
    palette: "classic-ink",
    targetPages: 1,
  }),
});
if (!denseResponse.ok) {
  const detail = await denseResponse.text();
  assert.fail(`dense overflow: ${denseResponse.status} ${detail}`);
}
assert.equal(denseResponse.headers.get("x-resume-target-pages"), "1");
assert.equal(denseResponse.headers.get("x-resume-density"), "tight-safe");
assert.equal(denseResponse.headers.get("x-resume-overflow"), "true");
assert.ok(Number(denseResponse.headers.get("x-resume-pages")) > 1);

const denseBuffer = Buffer.from(await denseResponse.arrayBuffer());
if (outputDir) {
  writeFileSync(join(outputDir, "dense-overflow.pdf"), denseBuffer);
}
const denseParsed = await pdfParse(denseBuffer);
const denseText = denseParsed.text.replace(/\s+/g, " ");
assert.ok(denseText.includes("Organization 1"));
assert.ok(denseText.includes("Organization 12"));
assert.ok(denseText.includes("Delivered program 12.5"));
process.stdout.write(
  `dense overflow: ${denseResponse.headers.get("x-resume-pages")} page(s), content preserved\n`,
);

const personalizedFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/export-personalized.json", import.meta.url),
    "utf8",
  ),
);
const personalizedResponse = await fetch(`${baseUrl}/api/export/pdf`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ...personalizedFixture,
    targetPages: 1,
  }),
});
if (!personalizedResponse.ok) {
  const detail = await personalizedResponse.text();
  assert.fail(
    `personalized: ${personalizedResponse.status} ${detail}`,
  );
}
assert.match(
  personalizedResponse.headers.get("content-type") || "",
  /application\/pdf/,
);
assert.equal(personalizedResponse.headers.get("x-resume-target-pages"), "1");
const personalizedBuffer = Buffer.from(
  await personalizedResponse.arrayBuffer(),
);
if (outputDir) {
  writeFileSync(join(outputDir, "personalized.pdf"), personalizedBuffer);
}
const personalizedParsed = await pdfParse(personalizedBuffer);
const personalizedText = personalizedParsed.text.replace(/\s+/g, " ");
assert.ok(personalizedText.includes("Northstar Labs"));
assert.ok(personalizedText.includes("Intelligent Documents"));
assert.ok(personalizedText.includes("Example University"));
assert.ok(personalizedText.includes("National Competition First Prize"));
process.stdout.write(
  `personalized: ${personalizedResponse.headers.get("x-resume-pages")} page(s), content preserved\n`,
);
