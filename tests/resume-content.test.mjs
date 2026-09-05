import assert from "node:assert/strict";
import test from "node:test";
import {
  attachResumeStructureMetadata,
  mergeParsedResumes,
  normalizeParsedResume,
  splitResumeText,
} from "../lib/resumeParser.ts";
import {
  analyzePdfPageLayout,
  needsVisualColumnCheck,
} from "../lib/pdfLayout.ts";
import {
  compactAdditionalItemLabel,
  isCompactAdditionalSection,
  resolveOptimizedBulletSourceIds,
  resolveResumeContent,
} from "../lib/pdf/shared.ts";
import { partitionResumeForPages } from "../lib/pdf/balancedPages.ts";
import {
  PDF_STYLE_DEFINITIONS,
  getResumePalette,
  normalizeTargetPages,
} from "../lib/pdf/config.ts";
import { TEMPLATE_DESIGN_SPECS } from "../lib/pdf/templateDesignSpecs.ts";
import {
  createFitCacheKey,
  createFitLayoutRevision,
  createResumeRevision,
  defaultResumePage,
  pruneFitVariants,
} from "../lib/resumeFit.ts";
import { createPdfPreviewCacheEntry } from "../lib/pdfPreviewCache.ts";
import {
  RESUME_STYLE_PROFILE_VERSION,
  approximateResumeStyleProfile,
  isCurrentResumeStyleProfile,
  sanitizeResumeStyleProfile,
} from "../lib/resumeStyle.ts";
import {
  createOptimizationCacheKey,
  createStructureIntegrity,
  constrainRoleOptimizedStructure,
  currentResumeManifestSections,
  constrainPreservedOptimization,
  enforceLockedOptimization,
  numbersAreGrounded,
  reconcileGroundedSkills,
  validateGroundedOptimization,
  validateLockedOptimization,
  validatePreservedFitOptimization,
  validatePreservedOptimization,
  validateResumeStructureManifest,
  unsupportedNumberClaims,
} from "../lib/resumeStructure.ts";

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

test("company teams keep their achievements grouped through resolution", () => {
  const merged = mergeParsedResumes([
    normalizeParsedResume({
      name: "Candidate",
      experience: [
        {
          id: "chunk-r1",
          company: "Acme",
          title: "Engineer",
          start: "2023",
          end: "Present",
          bullets: [{ id: "source-direct", text: "Led company rollout." }],
          teams: [
            {
              id: "chunk-team1",
              name: "Platform Team",
              title: "Backend",
              bullets: [{ id: "source-team1", text: "Built platform APIs." }],
            },
          ],
        },
      ],
    }),
    normalizeParsedResume({
      experience: [
        {
          id: "chunk-r2",
          company: "Acme",
          title: "Engineer",
          start: "2023",
          end: "Present",
          teams: [
            {
              id: "chunk-team2",
              name: "Platform Team",
              title: "Backend",
              bullets: [
                { id: "source-team2", text: "Improved API reliability." },
              ],
            },
          ],
        },
      ],
    }),
  ]);

  assert.equal(merged.experience.length, 1);
  assert.deepEqual(
    merged.experience[0].bullets.map((bullet) => bullet.id),
    ["b1", "b2", "b3"],
  );
  assert.deepEqual(merged.experience[0].teams?.[0], {
    id: "r1-team1",
    name: "Platform Team",
    title: "Backend",
    location: "",
    start: "",
    end: "",
    bulletIds: ["b2", "b3"],
  });

  const content = resolveResumeContent(merged, {
    title: "",
    summary: "",
    skills: [],
    roles: [
      {
        id: "r1",
        bullets: [
          {
            id: "b1",
            text: "Led company rollout.",
            evidence: ["b1"],
            matchedKeywords: [],
            rationale: "",
          },
          {
            id: "b2",
            text: "Built reliable platform APIs.",
            evidence: ["b2"],
            matchedKeywords: [],
            rationale: "",
          },
          {
            id: "b3",
            text: "Improved platform API reliability.",
            evidence: ["b3"],
            matchedKeywords: [],
            rationale: "",
          },
        ],
      },
    ],
    projects: [],
  });

  assert.deepEqual(content.experience[0].bullets, ["Led company rollout."]);
  assert.equal(content.experience[0].teams?.[0].heading, "Platform Team");
  assert.deepEqual(content.experience[0].teams?.[0].bullets, [
    "Built reliable platform APIs.",
    "Improved platform API reliability.",
  ]);
});

test("dated project headings flattened into a role's bullets become teams", () => {
  const resume = normalizeParsedResume({
    experience: [
      {
        id: "r1",
        company: "Howbe LLC",
        title: "Founder",
        start: "July 2025",
        end: "Present",
        bullets: [
          { id: "b1", text: "Founded the company." },
          {
            id: "b2",
            text: "IOLTA Ledger: AI-Powered Trust Accounting & Compliance for Law Firms Jul 2026 - Present",
          },
          { id: "b3", text: "– Solo designed, built, and operate a legal trust accounting SaaS." },
          { id: "b4", text: "– Engineered a Plaid bank-feed pipeline." },
          { id: "b5", text: "NextResume: AI Resume Tailoring & Optimization Jun 2026 - Present" },
          { id: "b6", text: "– Built an AI resume optimization app on Next.js 15." },
        ],
      },
    ],
  });
  const role = resume.experience[0];
  assert.deepEqual(
    role.bullets.map((bullet) => bullet.text),
    [
      "Founded the company.",
      "Solo designed, built, and operate a legal trust accounting SaaS.",
      "Engineered a Plaid bank-feed pipeline.",
      "Built an AI resume optimization app on Next.js 15.",
    ],
  );
  assert.deepEqual(
    role.teams?.map(({ id: _id, ...team }) => team),
    [
      {
        name: "IOLTA Ledger",
        title: "AI-Powered Trust Accounting & Compliance for Law Firms",
        location: "",
        start: "Jul 2026",
        end: "Present",
        bulletIds: ["b3", "b4"],
      },
      {
        name: "NextResume",
        title: "AI Resume Tailoring & Optimization",
        location: "",
        start: "Jun 2026",
        end: "Present",
        bulletIds: ["b6"],
      },
    ],
  );

  // Ordinary achievements that merely mention years are left alone.
  const plain = normalizeParsedResume({
    experience: [
      {
        id: "r1",
        company: "Acme",
        bullets: [
          { id: "b1", text: "Led the 2023 - 2024 migration to Kubernetes." },
          { id: "b2", text: "Cut costs 30% in 2024." },
        ],
      },
    ],
  });
  assert.equal(plain.experience[0].teams, undefined);
  assert.equal(plain.experience[0].bullets.length, 2);
});

test("a rewrite citing a team bullet as evidence stays with the bullet it rewrites", () => {
  const role = {
    bullets: [
      { id: "b1", text: "Led company rollout." },
      { id: "b2", text: "Built platform APIs." },
      { id: "b3", text: "Improved API reliability." },
    ],
  };
  assert.deepEqual(
    resolveOptimizedBulletSourceIds(role, [
      { id: "b1", evidence: ["b1", "b2"] },
      { id: "b2", evidence: ["b2"] },
      { id: "b3", evidence: ["b3", "b1"] },
    ]),
    ["b1", "b2", "b3"],
  );
  // Renamed ids fall back to the first cited source bullet, then position;
  // a source bullet is claimed at most once.
  assert.deepEqual(
    resolveOptimizedBulletSourceIds(role, [
      { id: "x1", evidence: ["b3", "b1"] },
      { id: "x2", evidence: [] },
      { id: "x3", evidence: ["b3"] },
    ]),
    ["b3", "b2", null],
  );
});

test("summary-like header spillover is removed from contact fields", () => {
  const resume = normalizeParsedResume({
    name: "Candidate",
    email: "candidate@example.com",
    phone: "+1 555 0100",
    location:
      "Howbe, LLC · Founder, CEO IOLTA Ledger: AI-Powered Trust Accounting",
    links: [
      { label: "Portfolio", url: "https://candidate.dev" },
      { label: "LinkedIn Profile" },
      { label: "Howbe, LLC" },
      {
        label:
          "Founder, CEO IOLTA Ledger: AI-Powered Trust Accounting & Compliance",
      },
    ],
    summary: "Founder building AI-native workflow products.",
  });

  assert.equal(resume.location, "");
  assert.deepEqual(resume.links, [
    { label: "Portfolio", url: "https://candidate.dev/" },
    { label: "LinkedIn Profile" },
  ]);
  assert.equal(
    resolveResumeContent(resume, null).summary,
    "Founder building AI-native workflow products.",
  );
});

test("short coursework and skill taxonomies render as compact flowing lists", () => {
  const coursework = {
    id: "coursework",
    kind: "custom",
    title: "Core Coursework",
    items: [
      {
        id: "course-1",
        heading: "Operating Systems",
        subheading: "97",
        location: "",
        start: "",
        end: "",
        bullets: [],
      },
      {
        id: "course-2",
        heading: "Data Structures",
        subheading: "93",
        location: "",
        start: "",
        end: "",
        bullets: [],
      },
    ],
  };
  const award = {
    ...coursework,
    id: "awards",
    kind: "awards",
    title: "Awards",
  };

  assert.equal(isCompactAdditionalSection(coursework), true);
  assert.equal(compactAdditionalItemLabel(coursework.items[0]), "Operating Systems · 97");
  assert.equal(isCompactAdditionalSection(award), false);
});

test("coordinate layout detection preserves two-column reading regions", () => {
  const bodyItems = Array.from({ length: 10 }, (_, index) => {
    const y = 620 - index * 35;
    return [
      { str: `Sidebar ${index}`, width: 70, height: 10, transform: [1, 0, 0, 10, 40, y] },
      { str: `Main ${index}`, width: 90, height: 10, transform: [1, 0, 0, 10, 360, y] },
    ];
  }).flat();
  const page = analyzePdfPageLayout(1, 600, 800, [
    { str: "Candidate Name", width: 100, height: 12, transform: [1, 0, 0, 12, 250, 730] },
    ...bodyItems,
  ]);

  assert.equal(page.columns, 2);
  assert.match(page.readingOrderText, /\[PAGE 1 HEADER\]/);
  assert.ok(
    page.readingOrderText.indexOf("Sidebar 0") <
      page.readingOrderText.indexOf("Main 0"),
  );
});

test("right-aligned dates do not turn a single-column resume into two columns", () => {
  const items = Array.from({ length: 30 }, (_, index) => {
    const y = 700 - index * 20;
    return [
      {
        str: `Single-column content line ${index}`,
        width: 440,
        height: 10,
        transform: [1, 0, 0, 10, 40, y],
      },
      ...(index % 6 === 0
        ? [
            {
              str: "2024",
              width: 28,
              height: 10,
              transform: [1, 0, 0, 10, 520, y],
            },
          ]
        : []),
    ];
  }).flat();
  const page = analyzePdfPageLayout(1, 600, 800, items);

  assert.equal(page.columns, 1);
  assert.doesNotMatch(page.readingOrderText, /LEFT COLUMN/);
});

test("visual page classification can override coordinate column detection", () => {
  const items = Array.from({ length: 12 }, (_, index) => {
    const y = 650 - index * 30;
    return [
      { str: `Left ${index}`, width: 60, height: 10, transform: [1, 0, 0, 10, 40, y] },
      { str: `Right ${index}`, width: 90, height: 10, transform: [1, 0, 0, 10, 360, y] },
    ];
  }).flat();

  assert.equal(analyzePdfPageLayout(1, 600, 800, items, 1).columns, 1);
});

test("structure metadata records layout, coverage, and protected ids", () => {
  const resume = attachResumeStructureMetadata({
    resume: fixtureResume,
    sourceText:
      "Candidate Engineer Builds reliable systems TypeScript Company Built a reliable platform",
    layout: {
      parser: "pdfjs-coordinates",
      pageCount: 2,
      maxColumns: 2,
      pages: [
        { page: 1, widthPt: 595, heightPt: 842, columns: 2 },
        { page: 2, widthPt: 595, heightPt: 842, columns: 1 },
      ],
      issues: ["Confirm multi-column order."],
    },
  });

  assert.equal(resume.sourceLayout?.maxColumns, 2);
  assert.equal(resume.structureManifest?.pageCount, 2);
  assert.equal(resume.structureManifest?.confirmed, false);
  assert.equal(resume.structureConfidence?.level, "low");
  assert.deepEqual(
    resume.structureManifest?.sections.find(
      (section) => section.ref === "experience",
    )?.bulletIds,
    ["b1"],
  );
});

test("confirmed structure manifest detects added or removed entries", () => {
  const order = ["summary", "skills", "experience"];
  const confirmed = {
    ...fixtureResume,
    sectionOrder: order,
    structureManifest: {
      version: 1,
      sourceFingerprint: "fixture",
      parser: "linear-text",
      pageCount: 1,
      maxColumns: 1,
      coverage: 1,
      confirmed: true,
      sectionOrder: order,
      sections: currentResumeManifestSections({
        ...fixtureResume,
        sectionOrder: order,
      }),
    },
  };
  assert.deepEqual(validateResumeStructureManifest(confirmed), []);

  const changed = structuredClone(confirmed);
  changed.experience[0].bullets.push({ id: "b2", text: "New bullet." });
  assert.ok(
    validateResumeStructureManifest(changed).some((issue) =>
      issue.includes("Bullets in experience changed"),
    ),
  );
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
  assert.equal(content.additionalSections[0].title, "Awards");
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
  assert.equal(isCurrentResumeStyleProfile({ ...headerRail, version: 2 }), false);

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

test("original-inspired blueprint safely supports three flow regions", () => {
  const source = {
    screenshots: ["data:image/png;base64,fixture"],
    page: {
      widthPt: 595.276,
      heightPt: 841.89,
      orientation: "portrait",
    },
    pageCount: 2,
  };
  const profile = sanitizeResumeStyleProfile(
    {
      layoutBlueprint: {
        headerPlacement: "primary",
        primaryRegionId: "content",
        gutterPt: 10,
        regions: [
          {
            id: "left rail",
            role: "sidebar",
            widthPercent: 35,
            surface: "sidebar",
            sections: ["contact", "photo", "skills"],
          },
          {
            id: "content",
            role: "main",
            widthPercent: 30,
            surface: "sidebar",
            sections: ["experience", "skills"],
          },
          {
            id: "right support",
            role: "supporting",
            widthPercent: 35,
            surface: "subtle",
            sections: ["additional"],
          },
        ],
      },
    },
    source,
  );

  assert.equal(profile.version, 5);
  assert.equal(profile.pageLayouts.length, 2);
  assert.equal(profile.pageLayouts[0].layout, "regional");
  assert.equal(profile.pageLayouts[1].layout, "regional");
  assert.equal(profile.layout, "regional");
  assert.equal(profile.layoutBlueprint.regions.length, 3);
  assert.equal(profile.layoutBlueprint.primaryRegionId, "content");
  assert.ok(
    profile.layoutBlueprint.regions.find((region) => region.id === "content")
      .widthPercent >= 42,
  );
  assert.equal(
    profile.layoutBlueprint.regions.reduce(
      (total, region) => total + region.widthPercent,
      0,
    ),
    100,
  );
  assert.equal(
    profile.layoutBlueprint.regions.filter((region) =>
      region.sections.includes("skills"),
    ).length,
    1,
  );
  assert.equal(
    profile.layoutBlueprint.regions.find((region) => region.id === "content")
      .surface,
    "page",
  );
  for (const section of ["summary", "projects", "education"]) {
    assert.ok(
      profile.layoutBlueprint.regions
        .find((region) => region.id === "content")
        .sections.includes(section),
    );
  }
});

test("original-inspired profiles preserve different source layouts page by page", () => {
  const source = {
    screenshots: ["data:image/png;base64,page1", "data:image/png;base64,page2"],
    page: {
      widthPt: 595.276,
      heightPt: 841.89,
      orientation: "portrait",
    },
    pageCount: 2,
  };
  const profile = sanitizeResumeStyleProfile(
    {
      pageLayouts: [
        {
          page: 1,
          layoutBlueprint: {
            headerPlacement: "full",
            primaryRegionId: "main",
            gutterPt: 8,
            regions: [
              {
                id: "rail",
                role: "sidebar",
                widthPercent: 28,
                surface: "subtle",
                sections: ["skills", "additional"],
              },
              {
                id: "main",
                role: "main",
                widthPercent: 72,
                surface: "page",
                sections: ["experience", "projects", "education"],
              },
            ],
          },
        },
        {
          page: 2,
          layoutBlueprint: {
            headerPlacement: "none",
            primaryRegionId: "main",
            gutterPt: 0,
            regions: [
              {
                id: "main",
                role: "main",
                widthPercent: 100,
                surface: "page",
                sections: ["experience", "projects", "skills", "additional"],
              },
            ],
          },
        },
      ],
    },
    source,
  );

  assert.equal(profile.pageLayouts.length, 2);
  assert.equal(profile.pageLayouts[0].layout, "sidebar-left");
  assert.equal(profile.pageLayouts[0].layoutBlueprint.headerPlacement, "full");
  assert.equal(profile.pageLayouts[1].layout, "single-column");
  assert.equal(profile.pageLayouts[1].layoutBlueprint.headerPlacement, "none");
});

test("vision fallback keeps a detected document sidebar across sparse continuation pages", () => {
  const profile = approximateResumeStyleProfile({
    screenshots: ["data:image/jpeg;base64,page1", "data:image/jpeg;base64,page2"],
    page: {
      widthPt: 595.276,
      heightPt: 841.89,
      orientation: "portrait",
    },
    pageCount: 2,
    sourceLayout: {
      parser: "pdfjs-coordinates",
      pageCount: 2,
      maxColumns: 2,
      pages: [
        { page: 1, widthPt: 595.276, heightPt: 841.89, columns: 2 },
        { page: 2, widthPt: 595.276, heightPt: 841.89, columns: 1 },
      ],
      issues: [],
    },
  });

  assert.equal(profile.approximate, true);
  assert.deepEqual(
    profile.pageLayouts.map((page) => page.layout),
    ["sidebar-left", "sidebar-left"],
  );
  assert.equal(profile.pageLayouts[0].layoutBlueprint.headerPlacement, "full");
  assert.equal(profile.pageLayouts[1].layoutBlueprint.headerPlacement, "none");
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

test("balanced pagination does not revive explicitly removed summary or skills", () => {
  const resume = normalizeParsedResume({
    name: "Candidate",
    summary: "Source summary that the page-fit version removed.",
    skills: ["Source-only skill"],
    experience: [],
    projects: [],
    education: [],
    additionalSections: [],
    sectionOrder: ["summary", "skills"],
  });
  const optimization = {
    title: "Engineer",
    summary: "",
    skills: [],
    roles: [],
    projects: [],
    sectionOrder: ["summary", "skills"],
  };

  assert.equal(
    partitionResumeForPages({ resume, optimization, pageCount: 2 }),
    null,
  );
});

test("balanced page chunks can continue one long entry without splitting a bullet", () => {
  const resume = {
    ...fixtureResume,
    summary: "",
    skills: [],
    projects: [],
    education: [],
    additionalSections: [],
    sectionOrder: ["experience"],
    experience: [
      {
        ...fixtureResume.experience[0],
        bullets: Array.from({ length: 4 }, (_, index) => ({
          id: `continued-${index + 1}`,
          text: `Delivered a distinct evidence-backed result ${index + 1}.`,
        })),
      },
    ],
  };
  const optimization = {
    ...fixtureOptimization,
    summary: "",
    skills: [],
    projects: [],
    sectionOrder: ["experience"],
    roles: [
      {
        id: resume.experience[0].id,
        bullets: resume.experience[0].bullets.map((bullet) => ({
          id: bullet.id,
          text: bullet.text,
          evidence: [bullet.id],
          matchedKeywords: [],
          rationale: "Source-backed.",
        })),
      },
    ],
  };
  const chunks = partitionResumeForPages({
    resume,
    optimization,
    pageCount: 2,
  });
  assert.equal(chunks?.length, 2);
  assert.ok(chunks.every((chunk) => chunk.resume.experience.length === 1));
  const ids = chunks.flatMap((chunk) =>
    chunk.optimization.roles.flatMap((role) =>
      role.bullets.map((bullet) => bullet.id),
    ),
  );
  assert.deepEqual(ids.sort(), resume.experience[0].bullets.map((bullet) => bullet.id).sort());
});

test("balanced pagination does not duplicate source-only additional bullets", () => {
  const resume = normalizeParsedResume({
    name: "Candidate",
    summary: "",
    skills: [],
    experience: [],
    projects: [],
    education: [],
    additionalSections: [
      {
        id: "awards",
        kind: "awards",
        title: "Awards",
        items: [
          {
            id: "award-entry",
            heading: "Selected Awards",
            bullets: Array.from({ length: 4 }, (_, index) => ({
              id: `award-${index + 1}`,
              text: `Received evidence-backed award ${index + 1}.`,
            })),
          },
        ],
      },
    ],
    sectionOrder: ["additional:awards"],
  });
  const optimization = {
    title: "Engineer",
    summary: "",
    skills: [],
    roles: [],
    projects: [],
    additionalSections: [],
    structureMode: "optimize",
    sectionOrder: ["additional:awards"],
  };
  const chunks = partitionResumeForPages({
    resume,
    optimization,
    pageCount: 2,
  });

  assert.equal(chunks?.length, 2);
  const ids = chunks.flatMap((chunk) =>
    chunk.resume.additionalSections.flatMap((section) =>
      section.items.flatMap((item) => item.bullets.map((bullet) => bullet.id)),
    ),
  );
  assert.deepEqual(ids.sort(), resume.additionalSections[0].items[0].bullets.map((bullet) => bullet.id).sort());
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
  assert.notEqual(
    createFitCacheKey(base),
    createFitCacheKey({ ...base, layoutRevision: "rebuilt-layout" }),
  );
  assert.notEqual(
    createFitLayoutRevision(null),
    createFitLayoutRevision({ version: 5, layout: "single-column" }),
  );
});

test("PDF preview cache keys reuse exact inputs and change for rendered output changes", () => {
  const page = defaultResumePage(null);
  const base = {
    resume: fixtureResume,
    optimization: fixtureOptimization,
    style: "classic",
    palette: "classic-ink",
    targetPages: "auto",
    pageSize: page,
    personalizedStyleProfile: null,
    fitVariant: null,
    sourceRevision: "revision",
    includeSummary: true,
  };
  const first = createPdfPreviewCacheEntry(base);
  const reordered = createPdfPreviewCacheEntry({
    ...base,
    resume: { ...fixtureResume },
    optimization: { ...fixtureOptimization },
  });

  assert.equal(first.key, reordered.key);
  assert.equal(first.signature, reordered.signature);
  assert.notEqual(
    first.key,
    createPdfPreviewCacheEntry({ ...base, palette: "sage" }).key,
  );
  assert.notEqual(
    first.key,
    createPdfPreviewCacheEntry({ ...base, includeSummary: false }).key,
  );
  assert.notEqual(
    first.key,
    createPdfPreviewCacheEntry({
      ...base,
      pageSize: { ...page, widthPt: page.widthPt + 1 },
    }).key,
  );
  assert.notEqual(
    first.key,
    createPdfPreviewCacheEntry({
      ...base,
      fitVariant: {
        id: "fit-1",
        cacheKey: "fit-cache-1",
        createdAt: "2026-09-03T20:00:00.000Z",
        lastUsedAt: "2026-09-03T20:00:00.000Z",
        actualPages: 1,
        targetPages: 1,
      },
    }).key,
  );
  assert.notEqual(
    createPdfPreviewCacheEntry({
      ...base,
      style: "personalized",
      personalizedStyleProfile: { version: 1, layout: "single-column" },
    }).key,
    createPdfPreviewCacheEntry({
      ...base,
      style: "personalized",
      personalizedStyleProfile: { version: 2, layout: "single-column" },
    }).key,
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

const preservedResume = normalizeParsedResume({
  name: "Candidate",
  title: "Engineer",
  summary: "Built reliable systems for 4 years.",
  skills: ["TypeScript", "PostgreSQL"],
  experience: [
    {
      id: "r1",
      company: "Company",
      title: "Engineer",
      start: "2022",
      end: "Present",
      bullets: [
        { id: "b1", text: "Improved reliability by 20%." },
        { id: "b2", text: "Built an internal platform." },
      ],
    },
  ],
  projects: [
    {
      id: "p1",
      name: "Project",
      role: "Lead",
      bullets: [{ id: "b3", text: "Created a research workflow." }],
    },
  ],
  education: [{ school: "University", degree: "BSc", year: "2022" }],
  additionalSections: [
    {
      id: "extra1",
      kind: "awards",
      title: "Selected Honors",
      items: [
        {
          id: "extra1-item1",
          heading: "Research Award",
          bullets: [{ id: "b4", text: "Recognized for the research workflow." }],
        },
      ],
    },
  ],
  sectionLabels: {
    experience: "PROFESSIONAL HISTORY",
    projects: "SELECTED WORK",
  },
  sectionOrder: [
    "summary",
    "experience",
    "projects",
    "education",
    "skills",
    "additional:extra1",
  ],
});

const preservedOptimization = {
  title: "Engineer",
  summary: "Engineer who built reliable systems for 4 years.",
  skills: ["PostgreSQL", "TypeScript"],
  roles: [
    {
      id: "r1",
      bullets: [
        {
          id: "b1",
          text: "Raised system reliability by 20%.",
          evidence: ["b1"],
          matchedKeywords: ["reliability"],
          rationale: "Clarifies impact.",
        },
        {
          id: "b2",
          text: "Built an internal engineering platform.",
          evidence: ["b2"],
          matchedKeywords: ["platform"],
          rationale: "Clarifies scope.",
        },
      ],
    },
  ],
  projects: [
    {
      id: "p1",
      bullets: [
        {
          id: "b3",
          text: "Created a workflow supporting research.",
          evidence: ["b3"],
          matchedKeywords: ["research"],
          rationale: "Improves relevance.",
        },
      ],
    },
  ],
  additionalSections: [
    {
      id: "extra1",
      items: [
        {
          id: "extra1-item1",
          bullets: [
            {
              id: "b4",
              text: "Recognized for the research workflow.",
              evidence: ["b4"],
              matchedKeywords: [],
              rationale: "Preserves the award evidence.",
            },
          ],
        },
      ],
    },
  ],
  structureMode: "preserve",
};

test("Keep original accepts one-to-one rewrites while preserving source labels and order", () => {
  assert.deepEqual(
    validatePreservedOptimization(preservedResume, preservedOptimization),
    [],
  );
  const content = resolveResumeContent(
    preservedResume,
    preservedOptimization,
  );
  assert.equal(content.sectionLabels.experience, "PROFESSIONAL HISTORY");
  assert.equal(content.sectionLabels.projects, "SELECTED WORK");
  assert.deepEqual(content.sectionOrder, preservedResume.sectionOrder);
  const integrity = createStructureIntegrity(
    preservedResume,
    preservedOptimization,
    "preserve",
  );
  assert.equal(integrity.valid, true);
  assert.equal(integrity.bulletsPreserved, integrity.totalBullets);
});

test("Keep original page fitting locks headings but may trim lower-priority content", () => {
  const fitted = structuredClone(preservedOptimization);
  fitted.skills = ["TypeScript"];
  fitted.roles[0].bullets = [fitted.roles[0].bullets[0]];
  fitted.projects[0].bullets = [];
  fitted.additionalSections[0].items[0].bullets = [];

  assert.deepEqual(
    validatePreservedFitOptimization(
      preservedResume,
      fitted,
      preservedOptimization,
    ),
    [],
  );

  const missingEntry = structuredClone(fitted);
  missingEntry.projects = [];
  assert.ok(
    validatePreservedFitOptimization(
      preservedResume,
      missingEntry,
      preservedOptimization,
    ).some((issue) => issue.includes("entire project section")),
  );

  const missingSkillsSection = structuredClone(fitted);
  missingSkillsSection.skills = [];
  assert.ok(
    validatePreservedFitOptimization(
      preservedResume,
      missingSkillsSection,
      preservedOptimization,
    ).some((issue) => issue.includes("entire skills section")),
  );

  const resumeWithExtraEntries = structuredClone(preservedResume);
  resumeWithExtraEntries.experience.push({
    id: "r2",
    company: "Earlier Company",
    title: "Intern",
    start: "2021",
    end: "2021",
    bullets: [{ id: "b5", text: "Supported an internal reporting tool." }],
  });
  resumeWithExtraEntries.projects.push({
    id: "p2",
    name: "Older Project",
    role: "Contributor",
    bullets: [{ id: "b6", text: "Built a prototype dashboard." }],
  });
  resumeWithExtraEntries.additionalSections[0].items.push({
    id: "extra1-item2",
    heading: "Earlier Award",
    bullets: [{ id: "b7", text: "Received an earlier award." }],
  });
  const optimizationWithExtraEntries = structuredClone(preservedOptimization);
  optimizationWithExtraEntries.roles.push({
    id: "r2",
    bullets: [{
      id: "b5",
      text: "Supported an internal reporting tool.",
      evidence: ["b5"],
      matchedKeywords: [],
      rationale: "Preserves evidence.",
    }],
  });
  optimizationWithExtraEntries.projects.push({
    id: "p2",
    bullets: [{
      id: "b6",
      text: "Built a prototype dashboard.",
      evidence: ["b6"],
      matchedKeywords: [],
      rationale: "Preserves evidence.",
    }],
  });
  optimizationWithExtraEntries.additionalSections[0].items.push({
    id: "extra1-item2",
    bullets: [{
      id: "b7",
      text: "Received an earlier award.",
      evidence: ["b7"],
      matchedKeywords: [],
      rationale: "Preserves evidence.",
    }],
  });
  const onePageSubset = structuredClone(optimizationWithExtraEntries);
  onePageSubset.roles = onePageSubset.roles.slice(0, 1);
  onePageSubset.projects = onePageSubset.projects.slice(0, 1);
  onePageSubset.additionalSections[0].items =
    onePageSubset.additionalSections[0].items.slice(0, 1);
  assert.deepEqual(
    validatePreservedFitOptimization(
      resumeWithExtraEntries,
      onePageSubset,
      optimizationWithExtraEntries,
    ),
    [],
  );
});

test("page-fit rendering honors explicit empty optimized fields", () => {
  const fitted = structuredClone(preservedOptimization);
  fitted.summary = "";
  fitted.skills = [];
  fitted.roles[0].bullets = [];
  fitted.projects[0].bullets = [];
  fitted.additionalSections[0].items[0].bullets = [];

  const content = resolveResumeContent(preservedResume, fitted);
  assert.equal(content.summary, "");
  assert.deepEqual(content.skills, []);
  assert.deepEqual(content.experience[0].bullets, []);
  assert.deepEqual(content.projects[0].bullets, []);
  assert.deepEqual(content.additionalSections[0].items[0].bullets, []);
});

test("Keep original rebuilds malformed model JSON from the source structure", () => {
  const constrained = constrainPreservedOptimization({
    resume: preservedResume,
    candidate: {
      title: "Engineer",
      summary: "Engineer with 99 years of experience.",
      skills: ["Go", "TypeScript"],
      roles: [
        {
          id: "wrong-role",
          bullets: [
            {
              id: "invented-id",
              text: "Raised system reliability by 20%.",
              evidence: ["b1"],
              matchedKeywords: ["reliability"],
              rationale: "Safe rewrite with a malformed id.",
            },
          ],
        },
      ],
      projects: [],
      additionalSections: [],
    },
    baseline: null,
    lockedContentIds: [],
  });

  assert.deepEqual(
    validatePreservedOptimization(preservedResume, constrained),
    [],
  );
  assert.equal(constrained.roles[0].id, "r1");
  assert.deepEqual(
    constrained.roles[0].bullets.map((bullet) => bullet.id),
    ["b1", "b2"],
  );
  assert.equal(
    constrained.roles[0].bullets[0].text,
    "Raised system reliability by 20%.",
  );
  assert.equal(
    constrained.roles[0].bullets[1].text,
    preservedResume.experience[0].bullets[1].text,
  );
  assert.equal(constrained.summary, preservedResume.summary);
  assert.deepEqual(constrained.sectionOrder, preservedResume.sectionOrder);
  assert.deepEqual(constrained.sectionLabels, preservedResume.sectionLabels);
  assert.deepEqual(
    new Set(constrained.skills.map((skill) => skill.toLowerCase())),
    new Set(preservedResume.skills.map((skill) => skill.toLowerCase())),
  );
});

test("Optimize for role safely applies relevant headings and section order", () => {
  const resume = normalizeParsedResume({
    ...preservedResume,
    sectionOrder: [
      "education",
      "experience",
      "projects",
      "skills",
      "summary",
      "additional:extra1",
    ],
  });
  const optimized = constrainRoleOptimizedStructure({
    resume,
    candidate: {
      ...preservedOptimization,
      structureMode: "optimize",
      sectionOrder: [
        "projects",
        "projects",
        "additional:not-real",
        "experience",
      ],
      sectionLabels: {
        projects: "Research Projects",
        experience: "Totally Custom History",
      },
    },
  });

  assert.deepEqual(optimized.sectionOrder, [
    "projects",
    "experience",
    "summary",
    "skills",
    "education",
    "additional:extra1",
  ]);
  assert.equal(optimized.sectionLabels?.projects, "Research Projects");
  assert.equal(
    optimized.sectionLabels?.experience,
    "Professional Experience",
  );
  assert.equal(new Set(optimized.sectionOrder).size, optimized.sectionOrder.length);

  const content = resolveResumeContent(resume, optimized);
  assert.deepEqual(content.sectionOrder, optimized.sectionOrder);
  assert.equal(content.sectionLabels.projects, "Research Projects");
  assert.equal(content.additionalSections[0].title, "Awards");
});

test("Optimize for role folds coursework and exam details into Education", () => {
  const resume = normalizeParsedResume({
    name: "Candidate",
    additionalSections: [
      {
        id: "extra1",
        kind: "custom",
        title: "GRAD. ENTRANCE EXAM",
        items: [{ id: "exam", heading: "Code 11408", bullets: [] }],
      },
      {
        id: "extra2",
        kind: "custom",
        title: "CORE COURSEWORK",
        items: [{ id: "course", heading: "Operating Systems 97", bullets: [] }],
      },
    ],
    sectionOrder: ["additional:extra1", "additional:extra2"],
  });
  const optimization = {
    title: "Software Engineer",
    summary: "",
    skills: [],
    roles: [],
    projects: [],
    structureMode: "optimize",
    sectionOrder: ["additional:extra1", "additional:extra2"],
    sectionLabels: {},
  };

  const content = resolveResumeContent(resume, optimization);
  assert.equal(content.additionalSections.length, 0);
  assert.deepEqual(
    content.education.map((item) => [item.school, item.degree]),
    [
      [
        "Education details",
        "Graduate Entrance Exam: Code 11408 · Relevant Coursework: Operating Systems 97",
      ],
    ],
  );
  assert.deepEqual(content.sectionOrder, ["education"]);
});

test("Optimize for role maps familiar source headings to system extras", () => {
  const resume = normalizeParsedResume({
    name: "Candidate",
    additionalSections: [
      {
        id: "extra1",
        kind: "custom",
        title: "COMMUNITY",
        items: [{ id: "community", heading: "AI tooling reviews", bullets: [] }],
      },
    ],
  });
  const content = resolveResumeContent(resume, {
    title: "Engineer",
    summary: "",
    skills: [],
    roles: [],
    projects: [],
    structureMode: "optimize",
  });

  assert.equal(content.additionalSections[0].kind, "volunteering");
  assert.equal(content.additionalSections[0].title, "Volunteering");
});

test("Optimize for role folds AGENT / AI source groups into Skills", () => {
  const resume = normalizeParsedResume({
    name: "Candidate",
    skills: ["Python"],
    additionalSections: [
      {
        id: "extra1",
        kind: "custom",
        title: "AGENT / AI",
        items: [
          { id: "agent", heading: "Agent Engineering", bullets: [] },
          { id: "rag", heading: "RAG", bullets: [] },
          { id: "python", heading: "Python", bullets: [] },
        ],
      },
    ],
    sectionOrder: ["additional:extra1", "skills"],
  });
  const content = resolveResumeContent(resume, {
    title: "AI Engineer",
    summary: "",
    skills: ["Python", "FastAPI"],
    roles: [],
    projects: [],
    structureMode: "optimize",
    sectionOrder: ["additional:extra1", "skills"],
  });

  assert.deepEqual(content.skills, [
    "Python",
    "FastAPI",
    "Agent Engineering",
    "RAG",
  ]);
  assert.equal(content.additionalSections.length, 0);
  assert.deepEqual(content.sectionOrder, ["skills"]);
});

test("Keep original rejects missing, reordered, merged, or numerically invented bullets", () => {
  const invalid = structuredClone(preservedOptimization);
  invalid.roles[0].bullets = [
    {
      ...invalid.roles[0].bullets[1],
      text: "Built an internal platform used by 500 people.",
      evidence: ["b1", "b2"],
    },
    invalid.roles[0].bullets[0],
  ];
  const issues = validatePreservedOptimization(preservedResume, invalid);
  assert.ok(issues.some((issue) => /count, ids, or order/i.test(issue)));
  const inventedNumber = structuredClone(preservedOptimization);
  inventedNumber.roles[0].bullets[1].text =
    "Built an internal platform used by 500 people.";
  assert.ok(
    validateGroundedOptimization(preservedResume, inventedNumber).some(
      (issue) => /unsupported number/i.test(issue),
    ),
  );
});

test("number grounding accepts safe formatting and lower-bound weakening", () => {
  assert.equal(numbersAreGrounded("Reached 800 users.", "Reached 800+ users."), true);
  assert.equal(numbersAreGrounded("Reviewed 1K profiles.", "Reviewed 1,000 profiles."), true);
  assert.equal(numbersAreGrounded("Reached 80+ users.", "Reached 80 users."), false);
  assert.equal(numbersAreGrounded("Improved 80%.", "Improved 80."), false);
  assert.deepEqual(unsupportedNumberClaims("Reached 80+ users.", "Reached 80 users."), ["80+"]);
});

test("digits inside product names are matched as names, not magnitudes", () => {
  // Scoring "S3" as the magnitude 3 rejected grounded rewrites with repair
  // feedback the model could not act on ('unsupported "3,"'), and it let an
  // invented count pass whenever the source happened to name an S3 or EC2.
  assert.equal(numbersAreGrounded("Archived logs to S3.", "Nightly archive to S3 buckets."), true);
  assert.equal(numbersAreGrounded("Scaled to 3 regions.", "Nightly archive to S3 buckets."), false);
  assert.equal(numbersAreGrounded("Owned p95 latency.", "Cut p95 latency by 18%."), true);
  assert.equal(numbersAreGrounded("Owned p99 latency.", "Cut p95 latency by 18%."), false);
  assert.deepEqual(unsupportedNumberClaims("Shipped GPT-4 search.", "Shipped LLM search."), ["GPT-4"]);
});

test("number grounding tolerates sentence punctuation and spelled-out counts", () => {
  // Number("1.5.") is NaN, which used to fall back to the raw string as the
  // key, so the same figure stopped matching itself across a sentence end.
  assert.equal(numbersAreGrounded("Cut spend by 1.5.", "Cut spend by 1.5 overall"), true);
  assert.equal(numbersAreGrounded("Led a team of 3 engineers.", "Led a team of three engineers."), true);
  // Words only widen what the source supports; prose in a rewrite is not a claim.
  assert.equal(numbersAreGrounded("Owned one of the largest queues.", "Owned the largest queue."), true);
  assert.equal(numbersAreGrounded("Led 7 engineers.", "Led a team of three engineers."), false);
});

test("grounding accepts skills containing PDF whitespace and Unicode separators", () => {
  const resume = structuredClone(preservedResume);
  resume.skills = [
    "vision\u00a0models",
    "knowledge\u200b graphs",
    "AI\ninsights",
    "embed\u200bdings",
  ];
  const optimization = structuredClone(preservedOptimization);
  optimization.skills = [
    "Vision Models",
    "knowledge graphs",
    "AI insights",
    "embeddings",
  ];

  assert.deepEqual(validateGroundedOptimization(resume, optimization), []);

  optimization.skills.push("Invented Skill");
  assert.ok(
    validateGroundedOptimization(resume, optimization).some((issue) =>
      issue.includes('Skill "Invented Skill"'),
    ),
  );
});

test("role optimization drops unsupported skills instead of failing the resume", () => {
  const grounded = reconcileGroundedSkills(fixtureResume, [
    "Vision Models",
    "reliable platform",
  ]);

  assert.deepEqual(grounded.skills, ["reliable platform", "TypeScript"]);
  assert.deepEqual(
    validateGroundedOptimization(fixtureResume, {
      ...fixtureOptimization,
      skills: grounded.skills,
      skillEvidence: grounded.skillEvidence,
    }),
    [],
  );
});

test("a rewrite that copies the source's skills needs to justify none of them", () => {
  // The prompt no longer asks for an entry per skill: grounding for a skill
  // the source already names is decided here by matching the source text, and
  // an entry supplied for one is discarded. Since skillEvidence was about half
  // the model's entire output, that is most of the rewrite's latency spent on
  // sentences nothing reads.
  const grounded = reconcileGroundedSkills(fixtureResume, ["TypeScript"], []);

  assert.deepEqual(grounded.skills, ["TypeScript"]);
  // Downstream still receives a complete array — this layer writes it.
  assert.equal(grounded.skillEvidence.length, 1);
  assert.equal(grounded.skillEvidence[0].grounding, "direct");
  assert.ok(grounded.skillEvidence[0].rationale.length > 0);
  assert.deepEqual(
    validateGroundedOptimization(fixtureResume, {
      ...fixtureOptimization,
      skills: grounded.skills,
      skillEvidence: grounded.skillEvidence,
    }),
    [],
  );
});

test("an added skill with no justification is still refused", () => {
  // The other half of the rule: omitting entries is free for copied skills and
  // fatal for invented ones.
  const grounded = reconcileGroundedSkills(
    fixtureResume,
    ["TypeScript", "Distributed Systems"],
    [],
  );

  assert.ok(!grounded.skills.includes("Distributed Systems"));
});

test("role optimization keeps strongly evidenced indirect capabilities", () => {
  const grounded = reconcileGroundedSkills(
    fixtureResume,
    ["Platform Reliability", "PyTorch", "Unexplained Capability"],
    [
      {
        skill: "Platform Reliability",
        grounding: "indirect",
        skillType: "capability",
        evidence: ["b1"],
        rationale:
          "The source bullet demonstrates building a reliable platform.",
      },
      {
        skill: "PyTorch",
        grounding: "indirect",
        skillType: "tool",
        evidence: ["b1"],
        rationale: "A framework cannot be inferred from generic platform work.",
      },
      {
        skill: "Unexplained Capability",
        grounding: "indirect",
        skillType: "capability",
        evidence: ["missing-bullet"],
        rationale: "The cited bullet does not exist.",
      },
    ],
  );

  assert.deepEqual(grounded.skills, ["Platform Reliability", "TypeScript"]);
  assert.equal(grounded.skillEvidence[0].grounding, "indirect");
  assert.deepEqual(grounded.skillEvidence[0].evidence, ["b1"]);
  assert.deepEqual(
    validateGroundedOptimization(fixtureResume, {
      ...fixtureOptimization,
      skills: grounded.skills,
      skillEvidence: grounded.skillEvidence,
    }),
    [],
  );
});

test("grounding validator rejects indirect tools even when they cite a real bullet", () => {
  const issues = validateGroundedOptimization(fixtureResume, {
    ...fixtureOptimization,
    skills: ["PyTorch"],
    skillEvidence: [
      {
        skill: "PyTorch",
        grounding: "indirect",
        skillType: "tool",
        evidence: ["b1"],
        rationale: "Incorrectly inferred from unrelated engineering work.",
      },
    ],
  });

  assert.ok(issues.some((issue) => issue.includes('Skill "PyTorch"')));
});

test("locked optimized wording cannot be removed by regeneration or Fit", () => {
  const candidate = structuredClone(preservedOptimization);
  candidate.roles[0].bullets[1].text = "Changed locked wording.";
  assert.deepEqual(
    validateLockedOptimization({
      resume: preservedResume,
      candidate: preservedOptimization,
      baseline: preservedOptimization,
      lockedContentIds: ["b2"],
    }),
    [],
  );
  assert.ok(
    validateLockedOptimization({
      resume: preservedResume,
      candidate,
      baseline: preservedOptimization,
      lockedContentIds: ["b2"],
    }).some((issue) => issue.includes("b2")),
  );
});

test("locked wording is restored deterministically before validation", () => {
  const candidate = structuredClone(preservedOptimization);
  candidate.roles[0].bullets = candidate.roles[0].bullets.filter(
    (bullet) => bullet.id !== "b2",
  );
  const enforced = enforceLockedOptimization({
    resume: preservedResume,
    candidate,
    baseline: preservedOptimization,
    lockedContentIds: ["b2"],
  });

  assert.equal(
    enforced.roles[0].bullets.find((bullet) => bullet.id === "b2")?.text,
    preservedOptimization.roles[0].bullets.find((bullet) => bullet.id === "b2")?.text,
  );
  assert.deepEqual(
    validateLockedOptimization({
      resume: preservedResume,
      candidate: enforced,
      baseline: preservedOptimization,
      lockedContentIds: ["b2"],
    }),
    [],
  );
});

test("optimization caches are isolated by structure mode and model", () => {
  const job = {
    title: "Engineer",
    company: "",
    seniority: "",
    requiredKeywords: [],
    niceToHaveKeywords: [],
    responsibilities: [],
  };
  const base = {
    resume: preservedResume,
    job,
    modelId: "model-a",
    structureMode: "optimize",
  };
  assert.notEqual(
    createOptimizationCacheKey(base),
    createOptimizationCacheKey({ ...base, structureMode: "preserve" }),
  );
  assert.notEqual(
    createOptimizationCacheKey(base),
    createOptimizationCacheKey({ ...base, modelId: "model-b" }),
  );
});

test("clean single-column geometry is a confident answer", () => {
  // One item per line, well separated: the coordinate pass can decide this
  // without the visual model, which is what lets the slow check be skipped.
  const items = Array.from({ length: 40 }, (_, index) => ({
    str: `Cut p99 checkout latency by ${index}% in the pricing path`,
    width: 320,
    height: 10,
    transform: [10, 0, 0, 10, 72, 700 - index * 14],
  }));
  const page = analyzePdfPageLayout(1, 612, 792, items);
  assert.equal(page.columns, 1);
  assert.equal(page.columnsConfident, true);
  assert.equal(
    needsVisualColumnCheck({
      parser: "pdfjs-coordinates",
      pageCount: 1,
      maxColumns: 1,
      pages: [{ ...page, readingOrderText: undefined }],
      issues: [],
    }),
    false,
  );
});

test("illegible geometry still asks the visual model", () => {
  // One positioned item per character — too fragmented to trust.
  const items = "Cut p99 checkout latency by 43 percent in Go".split("").map(
    (character, index) => ({
      str: character,
      width: 5,
      height: 10,
      transform: [10, 0, 0, 10, 72 + index * 5, 700],
    }),
  );
  const page = analyzePdfPageLayout(1, 612, 792, items);
  assert.equal(page.columnsConfident, false);
  assert.equal(
    needsVisualColumnCheck({
      parser: "pdfjs-coordinates",
      pageCount: 1,
      maxColumns: 1,
      pages: [page],
      issues: [],
    }),
    true,
  );
});

test("a two-column document always goes to the visual model", () => {
  assert.equal(
    needsVisualColumnCheck({
      parser: "pdfjs-coordinates",
      pageCount: 1,
      maxColumns: 2,
      pages: [
        { page: 1, widthPt: 612, heightPt: 792, columns: 2, columnsConfident: true },
      ],
      issues: [],
    }),
    true,
  );
});

test("a resume parsed before confidence was recorded still verifies", () => {
  // Absent must read as "not confident", preserving the old behaviour.
  assert.equal(
    needsVisualColumnCheck({
      parser: "pdfjs-coordinates",
      pageCount: 1,
      maxColumns: 1,
      pages: [{ page: 1, widthPt: 612, heightPt: 792, columns: 1 }],
      issues: [],
    }),
    true,
  );
  assert.equal(needsVisualColumnCheck(null), true);
});
