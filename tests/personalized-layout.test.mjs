// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Four ways the "Original-inspired" render drifted from the document it is
// supposed to reproduce. Each one is deterministic, so each one is pinned.

import assert from "node:assert/strict";
import test from "node:test";
import {
  profileForPageIndex,
  sanitizeResumeStyleProfile,
} from "../lib/resumeStyle.ts";
import { resolveResumeContent } from "../lib/pdf/shared.ts";

const PAGE = { widthPt: 595.32, heightPt: 841.92, orientation: "portrait" };
const source = { screenshots: ["data:image/jpeg;base64,AA=="], page: PAGE, pageCount: 1 };

// --- the invented "Contact" heading --------------------------------------

test("contact details next to the name stay in the header", () => {
  // The model is asked to leave these out of the region list, and routinely
  // does not. Rendered as a region section they become a "Contact" heading
  // and a section gap the source never had.
  const profile = sanitizeResumeStyleProfile(
    {
      headerPlacement: "full",
      layoutBlueprint: {
        headerPlacement: "full",
        primaryRegionId: "main",
        gutterPt: 0,
        regions: [
          {
            id: "main",
            role: "main",
            widthPercent: 100,
            surface: "page",
            sections: ["contact", "skills", "experience"],
          },
        ],
      },
    },
    source,
  );
  const main = profile.layoutBlueprint.regions.find(
    (region) => region.id === profile.layoutBlueprint.primaryRegionId,
  );
  assert.ok(!main.sections.includes("contact"));
  assert.ok(main.sections.includes("skills"));
});

test("a real contact rail is left where the model put it", () => {
  const profile = sanitizeResumeStyleProfile(
    {
      headerPlacement: "full",
      layoutBlueprint: {
        headerPlacement: "full",
        primaryRegionId: "main",
        gutterPt: 12,
        regions: [
          {
            id: "rail",
            role: "sidebar",
            widthPercent: 30,
            surface: "sidebar",
            sections: ["contact", "skills"],
          },
          {
            id: "main",
            role: "main",
            widthPercent: 70,
            surface: "page",
            sections: ["experience"],
          },
        ],
      },
    },
    source,
  );
  const rail = profile.layoutBlueprint.regions.find((r) => r.id === "rail");
  assert.ok(rail.sections.includes("contact"));
});

// --- the header repeated on page 2 ---------------------------------------

const oneSourcePage = {
  pageLayouts: [
    {
      page: 1,
      layout: "single-column",
      layoutBlueprint: {
        headerPlacement: "full",
        primaryRegionId: "main",
        gutterPt: 0,
        regions: [
          { id: "main", role: "main", widthPercent: 100, surface: "page", sections: ["experience"] },
        ],
      },
    },
  ],
};

test("an output page the source never had does not repeat the header", () => {
  assert.equal(
    profileForPageIndex(oneSourcePage, 0).layoutBlueprint.headerPlacement,
    "full",
  );
  assert.equal(
    profileForPageIndex(oneSourcePage, 1).layoutBlueprint.headerPlacement,
    "none",
  );
});

test("a page the model actually described keeps what it said", () => {
  const twoPages = {
    pageLayouts: [
      oneSourcePage.pageLayouts[0],
      { ...oneSourcePage.pageLayouts[0], page: 2 },
    ],
  };
  // The model saw page 2 and reported a header on it, so it is a real repeat.
  assert.equal(
    profileForPageIndex(twoPages, 1).layoutBlueprint.headerPlacement,
    "full",
  );
});

// --- skills losing their categories --------------------------------------

const RESUME = {
  name: "Jane Doe",
  title: "Staff Engineer",
  email: "",
  phone: "",
  location: "",
  summary: "",
  skills: ["Python", "Go", "AWS", "Docker"],
  skillGroups: [
    { label: "Languages", skills: ["Python", "Go"] },
    { label: "Cloud", skills: ["AWS", "Docker"] },
  ],
  experience: [
    {
      id: "r1",
      company: "Acme",
      title: "Staff Engineer",
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
  structureMode: "optimize",
  title: "Staff Engineer",
  summary: "",
  skills: ["Go", "AWS", "Python", "Docker", "gRPC"],
  roles: [{ id: "r1", bullets: [{ id: "b1", text: "Cut p99 checkout latency 43%" }] }],
  projects: [],
};

test("optimizing for a role keeps the source's skill categories", () => {
  // These labels used to be dropped whenever the mode was not "preserve",
  // turning a categorized list into an undifferentiated run of terms.
  const content = resolveResumeContent(RESUME, OPTIMIZATION, {});
  assert.deepEqual(
    content.skillGroups.map((group) => group.label),
    ["Languages", "Cloud", ""],
  );
});

test("skills are reordered inside their own category, never across", () => {
  const content = resolveResumeContent(RESUME, OPTIMIZATION, {});
  // "Go" outranks "Python" in the optimized list, so it leads its group.
  assert.deepEqual(content.skillGroups[0].skills, ["Go", "Python"]);
  assert.deepEqual(content.skillGroups[1].skills, ["AWS", "Docker"]);
});

test("a skill the rewrite added follows unlabeled rather than being filed", () => {
  const content = resolveResumeContent(RESUME, OPTIMIZATION, {});
  const trailing = content.skillGroups[content.skillGroups.length - 1];
  assert.equal(trailing.label, "");
  assert.deepEqual(trailing.skills, ["gRPC"]);
});

// The entry header's row count is not covered here: the markup lives in
// personalizedResume.ts, which is server-only and uses extensionless imports,
// so this runner cannot load it. That change is verified by export.
