import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeParsedResumes,
  normalizeParsedResume,
  splitResumeText,
} from "../lib/resumeParser.ts";
import { resolveResumeContent } from "../lib/pdf/shared.ts";
import { partitionResumeForPages } from "../lib/pdf/balancedPages.ts";
import {
  PDF_STYLE_DEFINITIONS,
  getResumePalette,
  normalizeTargetPages,
} from "../lib/pdf/config.ts";
import { TEMPLATE_DESIGN_SPECS } from "../lib/pdf/templateDesignSpecs.ts";
import {
  createFitCacheKey,
  createResumeRevision,
  defaultResumePage,
  pruneFitVariants,
} from "../lib/resumeFit.ts";
import {
  RESUME_STYLE_PROFILE_VERSION,
  isCurrentResumeStyleProfile,
  sanitizeResumeStyleProfile,
} from "../lib/resumeStyle.ts";

const fixtureResume = normalizeParsedResume({
  name: "Candidate",
  title: "Engineer",
  summary: "Builds reliable systems.",
  skills: ["TypeScript"],
  experience: [
    {
      id: "r1",
      company: "Company",
      title: "Engineer",
      bullets: [{ id: "b1", text: "Built a reliable platform." }],
    },
  ],
});
const fixtureOptimization = {
  title: "Senior Engineer",
  summary: "Builds reliable production systems.",
  skills: ["TypeScript"],
  roles: [
    {
      id: "r1",
      bullets: [
        {
          id: "ob1",
          text: "Built a reliable production platform.",
          evidence: ["b1"],
          matchedKeywords: ["reliable"],
          rationale: "Clarifies the result.",
        },
      ],
    },
  ],
  projects: [],
};

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

test("fixed PDF styles expose three curated palettes and one design spec", () => {
  const fixed = PDF_STYLE_DEFINITIONS.filter(
    (definition) => definition.id !== "personalized",
  );
  assert.equal(fixed.length, 7);
  assert.equal(
    PDF_STYLE_DEFINITIONS.find(
      (definition) => definition.id === "personalized",
    )?.palettes.length,
    0,
  );

  const paletteIds = new Set();
  for (const definition of fixed) {
    assert.equal(definition.palettes.length, 3, definition.id);
    assert.ok(
      TEMPLATE_DESIGN_SPECS.some((spec) => spec.style === definition.id),
      `missing design spec for ${definition.id}`,
    );
    for (const candidate of definition.palettes) {
      assert.ok(!paletteIds.has(candidate.id), candidate.id);
      paletteIds.add(candidate.id);
    }
    assert.equal(
      getResumePalette(definition.id, "not-a-real-palette").id,
      definition.palettes[0].id,
    );
  }
});

test("personalized style treats a header photo/contact rail as single-column", () => {
  const source = {
    screenshots: ["data:image/png;base64,fixture"],
    page: {
      widthPt: 595.276,
      heightPt: 841.89,
      orientation: "portrait",
    },
    pageCount: 1,
  };
  const headerRail = sanitizeResumeStyleProfile(
    {
      layout: "sidebar-right",
      sidebarSections: ["contact"],
      header: { photoPosition: "right" },
    },
    source,
  );
  assert.equal(headerRail.version, RESUME_STYLE_PROFILE_VERSION);
  assert.equal(headerRail.layout, "single-column");
  assert.deepEqual(headerRail.sidebarSections, []);
  assert.equal(headerRail.header.photoPosition, "right");
  assert.equal(isCurrentResumeStyleProfile(headerRail), true);
  assert.equal(isCurrentResumeStyleProfile({ ...headerRail, version: 1 }), false);

  const realSidebar = sanitizeResumeStyleProfile(
    {
      layout: "sidebar-right",
      sidebarSections: ["contact", "skills"],
    },
    source,
  );
  assert.equal(realSidebar.layout, "sidebar-right");
  assert.deepEqual(realSidebar.sidebarSections, ["contact", "skills"]);
});

test("target page values are constrained to Auto or 1–10 pages", () => {
  assert.equal(normalizeTargetPages("auto"), "auto");
  assert.equal(normalizeTargetPages(1), 1);
  assert.equal(normalizeTargetPages(7), 7);
  assert.equal(normalizeTargetPages(0), 1);
  assert.equal(normalizeTargetPages(99), 10);
  assert.equal(normalizeTargetPages("invalid"), "auto");
});

test("balanced page chunks preserve content without duplicating body sections", () => {
  const chunks = partitionResumeForPages({
    resume: fixtureResume,
    optimization: fixtureOptimization,
    pageCount: 2,
  });
  assert.equal(chunks?.length, 2);
  assert.equal(
    chunks.reduce(
      (total, chunk) => total + chunk.resume.experience.length,
      0,
    ),
    fixtureResume.experience.length,
  );
  assert.equal(
    chunks.filter(
      (chunk) =>
        Boolean(chunk.optimization?.summary) || Boolean(chunk.resume.summary),
    ).length,
    1,
  );
  assert.equal(
    chunks.filter(
      (chunk) =>
        Boolean(chunk.optimization?.skills.length) ||
        chunk.resume.skills.length > 0,
    ).length,
    1,
  );
  assert.equal(
    partitionResumeForPages({
      resume: fixtureResume,
      optimization: fixtureOptimization,
      pageCount: 4,
    }),
    null,
  );
});

test("resume revisions change with content but not object key order", () => {
  const first = createResumeRevision({
    resume: fixtureResume,
    optimization: fixtureOptimization,
    job: { title: "Engineer", company: "", seniority: "", requiredKeywords: [], niceToHaveKeywords: [], responsibilities: [] },
    modelId: "model-a",
  });
  const reordered = createResumeRevision({
    resume: { ...fixtureResume },
    optimization: { ...fixtureOptimization },
    job: { responsibilities: [], niceToHaveKeywords: [], requiredKeywords: [], seniority: "", company: "", title: "Engineer" },
    modelId: "model-a",
  });
  const edited = createResumeRevision({
    resume: { ...fixtureResume, summary: `${fixtureResume.summary} Updated.` },
    optimization: fixtureOptimization,
    job: { title: "Engineer", company: "", seniority: "", requiredKeywords: [], niceToHaveKeywords: [], responsibilities: [] },
    modelId: "model-a",
  });
  assert.equal(first, reordered);
  assert.notEqual(first, edited);
});

test("fit cache keys include template, page target, paper, and keep choices", () => {
  const page = defaultResumePage(null);
  const base = {
    sourceRevision: "revision",
    targetPages: 1,
    style: "classic",
    page,
    modelId: "model-a",
    keptContentIds: [],
  };
  assert.notEqual(
    createFitCacheKey(base),
    createFitCacheKey({ ...base, targetPages: 2 }),
  );
  assert.notEqual(
    createFitCacheKey(base),
    createFitCacheKey({ ...base, style: "sidebar" }),
  );
  assert.notEqual(
    createFitCacheKey(base),
    createFitCacheKey({ ...base, keptContentIds: ["b1"] }),
  );
});

test("fit variant pruning keeps the newest version per key and caps history", () => {
  const variants = Array.from({ length: 14 }, (_, index) => ({
    id: `variant-${index}`,
    cacheKey: index < 2 ? "duplicate" : `key-${index}`,
    sourceRevision: "revision",
    targetPages: 1,
    actualPages: 1,
    style: "classic",
    page: defaultResumePage(null),
    modelId: "model-a",
    density: "standard",
    fittedResume: fixtureResume,
    fittedOptimization: fixtureOptimization,
    changes: [],
    keptContentIds: [],
    atsScore: 90,
    sourceAtsScore: 92,
    createdAt: new Date(index * 1000).toISOString(),
    lastUsedAt: new Date((index < 2 ? 20 + index : index) * 1000).toISOString(),
  }));
  const pruned = pruneFitVariants(variants);
  assert.equal(pruned.length, 12);
  assert.equal(
    pruned.find((variant) => variant.cacheKey === "duplicate")?.id,
    "variant-1",
  );
});
