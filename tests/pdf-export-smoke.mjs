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
        {
          id: "award-2",
          heading:
            "First Prize and Best Creativity Award — National College Students' E-Commerce \"Innovation, Creativity, and Entrepreneurship\" Challenge",
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
  sectionOrder: [
    "projects",
    "skills",
    "experience",
    "summary",
    "education",
    "additional:awards",
  ],
  sectionLabels: {
    summary: "Professional Summary",
    skills: "Technical Skills",
    experience: "Professional Experience",
    projects: "Research Projects",
    education: "Academic Background",
  },
};

const job = {
  title: "Senior Data & AI Engineer",
  company: "Example Company",
  seniority: "Senior",
  requiredKeywords: ["TypeScript", "Machine Learning"],
  niceToHaveKeywords: ["research"],
  responsibilities: ["Build reliable data and AI systems."],
};

const report = {
  overallBefore: 75,
  overallAfter: 92,
  categoriesBefore: [],
  categoriesAfter: [],
  missingKeywords: [],
  presentKeywords: ["TypeScript", "Machine Learning"],
};

const expectedText = [
  "Alex Morgan",
  "Northstar Labs",
  "Built a production platform supporting research workflows.",
  "Research Assistant",
  "Created a cited workflow for research synthesis.",
  "State University",
  "Research Excellence Award",
  "First Prize and Best Creativity Award",
];
const expectedHeadings = [
  "Professional Summary",
  "Technical Skills",
  "Professional Experience",
  "Research Projects",
  "Academic Background",
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
  const compactText = parsed.text.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const value of expectedText) {
    assert.ok(
      normalized.includes(value),
      `${definition.id}: missing "${value}"`,
    );
  }
  for (const heading of expectedHeadings) {
    assert.ok(
      compactText.includes(heading.toLowerCase().replace(/[^a-z0-9]/g, "")),
      `${definition.id}: missing optimized heading "${heading}"`,
    );
  }
  process.stdout.write(
    `${definition.id}: ${response.headers.get("x-resume-pages")} page(s), ${response.headers.get("x-resume-density")}\n`,
  );
}

const fitResponse = await fetch(`${baseUrl}/api/fit-resume`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    resume,
    optimization,
    job,
    report,
    model: "test-model-not-used-for-layout-only-fit",
    style: "classic",
    palette: "classic-ink",
    targetPages: 2,
    pageSize: {
      widthPt: 612,
      heightPt: 792,
      orientation: "portrait",
    },
    keptContentIds: [],
    priorityContentIds: [],
  }),
});
if (!fitResponse.ok) {
  const detail = await fitResponse.text();
  assert.fail(`fit API: ${fitResponse.status} ${detail}`);
}
const fitData = await fitResponse.json();
assert.equal(fitData.variant.actualPages, 2);
assert.equal(fitData.variant.targetPages, 2);
assert.equal(fitData.variant.style, "classic");
assert.equal(fitData.variant.changes.length, 0);

const fittedExportResponse = await fetch(`${baseUrl}/api/export/pdf`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    resume,
    optimization,
    targetTitle: job.title,
    style: "classic",
    palette: "classic-ink",
    targetPages: 2,
    pageSize: fitData.variant.page,
    fitVariant: fitData.variant,
    sourceRevision: fitData.variant.sourceRevision,
  }),
});
if (!fittedExportResponse.ok) {
  const detail = await fittedExportResponse.text();
  assert.fail(
    `fitted export: ${fittedExportResponse.status} ${detail}`,
  );
}
assert.equal(fittedExportResponse.headers.get("x-resume-pages"), "2");
const fittedBuffer = Buffer.from(await fittedExportResponse.arrayBuffer());
const fittedParsed = await pdfParse(fittedBuffer);
assert.ok(fittedParsed.text.includes("Northstar Labs"));
assert.ok(fittedParsed.text.includes("Research Excellence Award"));
process.stdout.write("fit API: exact balanced 2-page variant exported\n");

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
assert.equal(
  denseResponse.headers.get("x-resume-density"),
  "minimum-safe",
);
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
    targetPages: 3,
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
assert.equal(personalizedResponse.headers.get("x-resume-target-pages"), "3");
assert.equal(personalizedResponse.headers.get("x-resume-pages"), "3");
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

if (process.env.PDF_TEST_AI_MODEL) {
  const mediumResume = {
    ...denseResume,
    experience: denseResume.experience.slice(0, 5),
    projects: [],
  };
  const mediumOptimization = {
    ...optimization,
    roles: mediumResume.experience.map((role) => ({
      id: role.id,
      bullets: role.bullets.map((bullet) => ({
        id: `optimized-${bullet.id}`,
        text: bullet.text,
        evidence: [bullet.id],
        matchedKeywords: [],
        rationale: "Preserves source evidence.",
      })),
    })),
    projects: [],
  };
  const aiFitResponse = await fetch(`${baseUrl}/api/fit-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume: mediumResume,
      optimization: mediumOptimization,
      job,
      report,
      model: process.env.PDF_TEST_AI_MODEL,
      style: "classic",
      palette: "classic-ink",
      targetPages: 1,
      pageSize: {
        widthPt: 612,
        heightPt: 792,
        orientation: "portrait",
      },
      keptContentIds: [],
      priorityContentIds: [],
    }),
  });
  if (!aiFitResponse.ok) {
    const detail = await aiFitResponse.text();
    assert.fail(`AI fit: ${aiFitResponse.status} ${detail}`);
  }
  const aiFitData = await aiFitResponse.json();
  assert.equal(aiFitData.variant.actualPages, 1);
  assert.equal(
    aiFitData.variant.fittedResume.experience.length,
    mediumResume.experience.length,
  );
  assert.ok(aiFitData.variant.changes.length > 0);
  for (const role of aiFitData.variant.fittedOptimization.roles) {
    for (const bullet of role.bullets) {
      assert.ok(bullet.evidence.length > 0);
    }
  }
  process.stdout.write(
    `AI fit: exact 1-page variant with ${aiFitData.variant.changes.length} tracked changes\n`,
  );
}
