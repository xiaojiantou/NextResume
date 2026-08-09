// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type {
  ResumeLayoutBlueprint,
  ResumeLayout,
  ResumePageLayout,
  ResumeLayoutRegion,
  ResumeLayoutSection,
  ResumePageSpec,
  ResumeStyleProfile,
  ResumeStyleSource,
} from "./types";

const FONT_FAMILIES = new Set<ResumeStyleProfile["fontFamily"]>([
  "Arial",
  "Helvetica",
  "Verdana",
  "Georgia",
  "Times New Roman",
]);

const SIDEBAR_SECTIONS = new Set<
  ResumeStyleProfile["sidebarSections"][number]
>(["contact", "summary", "skills", "education", "additional"]);

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const RESUME_STYLE_PROFILE_VERSION = 5;
const LAYOUT_SECTIONS = new Set<ResumeLayoutSection>([
  "contact",
  "photo",
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
  "additional",
]);
const BODY_LAYOUT_SECTIONS: ResumeLayoutSection[] = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
  "additional",
];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function numberIn(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value)
    ? value.toLowerCase()
    : fallback;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function regionId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return normalized || fallback;
}

function legacyBlueprint({
  layout,
  sidebarWidthPercent,
  sidebarSections,
}: {
  layout: "single-column" | "sidebar-left" | "sidebar-right";
  sidebarWidthPercent: number;
  sidebarSections: ResumeStyleProfile["sidebarSections"];
}): ResumeLayoutBlueprint {
  if (layout === "single-column") {
    return {
      headerPlacement: "full",
      primaryRegionId: "main",
      gutterPt: 0,
      regions: [
        {
          id: "main",
          role: "main",
          widthPercent: 100,
          surface: "page",
          sections: [...BODY_LAYOUT_SECTIONS],
        },
      ],
    };
  }
  const railSections: ResumeLayoutSection[] = sidebarSections.filter(
    (section) => LAYOUT_SECTIONS.has(section),
  );
  const mainSections = BODY_LAYOUT_SECTIONS.filter(
    (section) => !railSections.includes(section),
  );
  const rail: ResumeLayoutRegion = {
    id: "sidebar",
    role: "sidebar",
    widthPercent: sidebarWidthPercent,
    surface: "sidebar",
    sections: railSections,
  };
  const main: ResumeLayoutRegion = {
    id: "main",
    role: "main",
    widthPercent: 100 - sidebarWidthPercent,
    surface: "page",
    sections: mainSections,
  };
  return {
    headerPlacement: "primary",
    primaryRegionId: "main",
    gutterPt: 0,
    regions: layout === "sidebar-left" ? [rail, main] : [main, rail],
  };
}

function normalizeRegionWidths(
  regions: ResumeLayoutRegion[],
  primaryRegionId: string,
): ResumeLayoutRegion[] {
  if (regions.length === 1) return [{ ...regions[0], widthPercent: 100 }];
  const weights = regions.map((region) => Math.max(12, region.widthPercent));
  let percentages = weights.map(
    (weight) => (weight / weights.reduce((sum, item) => sum + item, 0)) * 100,
  );
  const primaryIndex = regions.findIndex(
    (region) => region.id === primaryRegionId,
  );
  if (primaryIndex >= 0 && percentages[primaryIndex] < 42) {
    const remaining = 58;
    const otherTotal = percentages.reduce(
      (sum, value, index) => sum + (index === primaryIndex ? 0 : value),
      0,
    );
    percentages = percentages.map((value, index) =>
      index === primaryIndex
        ? 42
        : otherTotal
          ? (value / otherTotal) * remaining
          : remaining / (regions.length - 1),
    );
  }
  const rounded = percentages.map((value) => Math.round(value * 10) / 10);
  rounded[rounded.length - 1] =
    Math.round((100 - rounded.slice(0, -1).reduce((sum, value) => sum + value, 0)) * 10) / 10;
  return regions.map((region, index) => ({
    ...region,
    widthPercent: rounded[index],
  }));
}

function sanitizeLayoutBlueprint(
  value: unknown,
  fallback: ResumeLayoutBlueprint,
): ResumeLayoutBlueprint {
  const input = object(value);
  const sourceRegions = Array.isArray(input.regions)
    ? input.regions.slice(0, 3)
    : [];
  const usedIds = new Set<string>();
  const claimedSections = new Set<ResumeLayoutSection>();
  const regions: ResumeLayoutRegion[] = sourceRegions.flatMap(
    (rawRegion, index) => {
      const region = object(rawRegion);
      let id = regionId(region.id, `region-${index + 1}`);
      if (usedIds.has(id)) id = `${id}-${index + 1}`;
      usedIds.add(id);
      const sections: ResumeLayoutSection[] = [];
      if (Array.isArray(region.sections)) {
        for (const section of region.sections) {
          if (
            typeof section === "string" &&
            LAYOUT_SECTIONS.has(section as ResumeLayoutSection) &&
            !claimedSections.has(section as ResumeLayoutSection)
          ) {
            const safe = section as ResumeLayoutSection;
            sections.push(safe);
            claimedSections.add(safe);
          }
        }
      }
      return [
        {
          id,
          role: oneOf(
            region.role,
            ["main", "sidebar", "supporting"] as const,
            index === 0 ? "main" : "supporting",
          ),
          widthPercent: numberIn(region.widthPercent, index === 0 ? 64 : 36, 12, 88),
          surface: oneOf(
            region.surface,
            ["page", "sidebar", "subtle"] as const,
            index === 0 ? "page" : "subtle",
          ),
          sections,
        } satisfies ResumeLayoutRegion,
      ];
    },
  );
  if (!regions.length) return fallback;

  let primary = regions.find((region) => region.role === "main");
  const requestedPrimary = regionId(input.primaryRegionId, "");
  if (requestedPrimary) {
    primary = regions.find((region) => region.id === requestedPrimary) ?? primary;
  }
  primary ??= regions[0];
  const primaryRegionId = primary.id;
  const normalizedRoles = regions.map((region) => ({
    ...region,
    role:
      region.id === primaryRegionId
        ? ("main" as const)
        : region.role === "main"
          ? ("supporting" as const)
          : region.role,
    surface:
      region.id === primaryRegionId && region.surface === "sidebar"
        ? ("page" as const)
        : region.surface,
  }));
  const unclaimed = BODY_LAYOUT_SECTIONS.filter(
    (section) => !claimedSections.has(section),
  );
  const withFallbackSections = normalizedRoles.map((region) =>
    region.id === primaryRegionId
      ? { ...region, sections: [...region.sections, ...unclaimed] }
      : region,
  );
  return {
    headerPlacement: oneOf(
      input.headerPlacement,
      ["full", "primary", "none"] as const,
      fallback.headerPlacement,
    ),
    primaryRegionId,
    gutterPt: numberIn(input.gutterPt, fallback.gutterPt, 0, 24),
    regions: normalizeRegionWidths(withFallbackSections, primaryRegionId),
  };
}

function layoutForBlueprint(
  blueprint: ResumeLayoutBlueprint,
): ResumeLayout {
  const primaryIndex = blueprint.regions.findIndex(
    (region) => region.id === blueprint.primaryRegionId,
  );
  return blueprint.regions.length === 1
    ? "single-column"
    : blueprint.regions.length === 2 && primaryIndex === 0
      ? "sidebar-right"
      : blueprint.regions.length === 2 && primaryIndex === 1
        ? "sidebar-left"
        : "regional";
}

function sanitizePageLayouts({
  value,
  pageCount,
  fallback,
}: {
  value: unknown;
  pageCount: number;
  fallback: ResumeLayoutBlueprint;
}): ResumePageLayout[] {
  const source = Array.isArray(value) ? value.slice(0, 10) : [];
  const parsed = source.map((raw, index) => {
    const page = object(raw);
    const layoutBlueprint = sanitizeLayoutBlueprint(
      page.layoutBlueprint ?? page,
      fallback,
    );
    return {
      page: index + 1,
      layout: layoutForBlueprint(layoutBlueprint),
      layoutBlueprint,
    } satisfies ResumePageLayout;
  });
  const targetCount = Math.max(1, Math.min(10, pageCount || parsed.length || 1));
  if (!parsed.length) {
    parsed.push({
      page: 1,
      layout: layoutForBlueprint(fallback),
      layoutBlueprint: fallback,
    });
  }
  while (parsed.length < targetCount) {
    const previous = parsed[parsed.length - 1];
    parsed.push({
      ...previous,
      page: parsed.length + 1,
      layoutBlueprint: {
        ...previous.layoutBlueprint,
        regions: previous.layoutBlueprint.regions.map((region) => ({
          ...region,
          sections: [...region.sections],
        })),
      },
    });
  }
  return parsed;
}

export function defaultResumeStyleProfile(
  page: ResumePageSpec,
): ResumeStyleProfile {
  return {
    version: RESUME_STYLE_PROFILE_VERSION,
    pageLayouts: [
      {
        page: 1,
        layout: "single-column",
        layoutBlueprint: legacyBlueprint({
          layout: "single-column",
          sidebarWidthPercent: 32,
          sidebarSections: [],
        }),
      },
    ],
    layout: "single-column",
    layoutBlueprint: legacyBlueprint({
      layout: "single-column",
      sidebarWidthPercent: 32,
      sidebarSections: [],
    }),
    sidebarWidthPercent: 32,
    sidebarSections: [],
    fontFamily: "Arial",
    headingFontFamily: "Arial",
    colors: {
      text: "#18181b",
      muted: "#52525b",
      accent: "#27272a",
      background: "#ffffff",
      sidebarBackground: "#27272a",
      sidebarText: "#ffffff",
    },
    marginsPt: { top: 38, right: 44, bottom: 38, left: 44 },
    typography: {
      bodyPt: 10,
      lineHeight: 1.42,
      namePt: 23,
      titlePt: 11,
      sectionPt: 9,
      metaPt: 8.5,
    },
    spacing: { sectionPt: 14, entryPt: 9, bulletPt: 3.5 },
    header: {
      alignment: "center",
      divider: true,
      photoPosition: "none",
      photoShape: "circle",
      photoSizePt: 60,
    },
    sectionHeading: {
      uppercase: true,
      divider: true,
      filled: false,
      alignment: "left",
    },
    bulletMarker: "disc",
    page,
  };
}

/**
 * When the visual model is temporarily unavailable, keep geometry inferred
 * from the uploaded document instead of silently degrading to one column.
 */
export function approximateResumeStyleProfile(
  source: ResumeStyleSource,
): ResumeStyleProfile {
  const fallback = defaultResumeStyleProfile(source.page);
  const visualPages = source.visualLayoutGuide?.pages ?? [];
  const visuallyDetectedSidebar = visualPages.find((page) =>
    ["sidebar-left", "sidebar-right", "mixed"].includes(page.layout),
  )?.layout;
  const documentLayout: "single-column" | "sidebar-left" | "sidebar-right" =
    visuallyDetectedSidebar === "sidebar-right"
      ? "sidebar-right"
      : visuallyDetectedSidebar || source.sourceLayout?.maxColumns === 2
        ? "sidebar-left"
        : "single-column";
  const pageLayouts = Array.from(
    { length: Math.max(1, Math.min(10, source.pageCount)) },
    (_, index) => {
      const visual = visualPages.find(
        (page) => page.page === index + 1,
      )?.layout;
      const pageLayout: typeof documentLayout =
        visual === "sidebar-right"
          ? "sidebar-right"
          : visual === "sidebar-left" || visual === "mixed"
            ? "sidebar-left"
            : documentLayout;
      let layoutBlueprint: ResumeLayoutBlueprint;
      if (pageLayout === "single-column") {
        layoutBlueprint = {
          headerPlacement: index === 0 ? "full" : "none",
          primaryRegionId: "main",
          gutterPt: 0,
          regions: [
            {
              id: "main",
              role: "main",
              widthPercent: 100,
              surface: "page",
              sections: [...BODY_LAYOUT_SECTIONS],
            },
          ],
        };
      } else {
        const rail: ResumeLayoutRegion = {
          id: "sidebar",
          role: "sidebar",
          widthPercent: 28,
          surface: "subtle",
          sections: ["skills", "additional"],
        };
        const main: ResumeLayoutRegion = {
          id: "main",
          role: "main",
          widthPercent: 72,
          surface: "page",
          sections: ["summary", "experience", "projects", "education"],
        };
        layoutBlueprint = {
          headerPlacement: index === 0 ? "full" : "none",
          primaryRegionId: "main",
          gutterPt: 0,
          regions:
            pageLayout === "sidebar-right" ? [main, rail] : [rail, main],
        };
      }
      return { page: index + 1, layoutBlueprint };
    },
  );

  return sanitizeResumeStyleProfile(
    {
      ...fallback,
      approximate: true,
      pageLayouts,
      layoutBlueprint: pageLayouts[0].layoutBlueprint,
      header: { ...fallback.header, alignment: "left" },
    },
    source,
  );
}

/**
 * Vision output is untrusted. Clamp it to a deliberately small design
 * vocabulary so it can influence appearance without hiding or restructuring
 * resume content.
 */
export function sanitizeResumeStyleProfile(
  value: unknown,
  source: ResumeStyleSource,
): ResumeStyleProfile {
  const measuredWidth = numberIn(source.page.widthPt, 612, 360, 1224);
  const measuredHeight = numberIn(source.page.heightPt, 792, 360, 1224);
  const measuredPage: ResumePageSpec = {
    widthPt: measuredWidth,
    heightPt: measuredHeight,
    orientation:
      measuredWidth > measuredHeight ? "landscape" : "portrait",
  };
  const fallback = defaultResumeStyleProfile(measuredPage);
  const input = object(value);
  const colors = object(input.colors);
  const margins = object(input.marginsPt);
  const typography = object(input.typography);
  const spacing = object(input.spacing);
  const header = object(input.header);
  const sectionHeading = object(input.sectionHeading);

  const fontFamily = oneOf(
    input.fontFamily,
    [...FONT_FAMILIES],
    fallback.fontFamily,
  );
  const headingFontFamily = oneOf(
    input.headingFontFamily,
    [...FONT_FAMILIES],
    fallback.headingFontFamily,
  );
  const sidebarSections = Array.isArray(input.sidebarSections)
    ? input.sidebarSections.filter(
        (
          item,
        ): item is ResumeStyleProfile["sidebarSections"][number] =>
          typeof item === "string" &&
          SIDEBAR_SECTIONS.has(
            item as ResumeStyleProfile["sidebarSections"][number],
          ),
      )
    : fallback.sidebarSections;
  const requestedLayout = oneOf(
    input.layout,
    ["single-column", "sidebar-left", "sidebar-right"] as const,
    "single-column",
  );
  // A portrait/contact rail confined to the page header is not a document
  // sidebar. Require at least one body section to occupy that column before
  // narrowing the main resume content.
  const hasSidebarBodySection = sidebarSections.some(
    (section) => section !== "contact",
  );
  const legacyLayout =
    requestedLayout !== "single-column" && !hasSidebarBodySection
      ? "single-column"
      : requestedLayout;
  const requestedSidebarWidth = numberIn(
    input.sidebarWidthPercent,
    fallback.sidebarWidthPercent,
    20,
    44,
  );
  const legacy = legacyBlueprint({
    layout: legacyLayout,
    sidebarWidthPercent: requestedSidebarWidth,
    sidebarSections:
      legacyLayout === "single-column" ? [] : [...new Set(sidebarSections)],
  });
  const layoutBlueprint = sanitizeLayoutBlueprint(
    input.layoutBlueprint,
    legacy,
  );
  const pageLayouts = sanitizePageLayouts({
    value: input.pageLayouts,
    pageCount: source.pageCount,
    fallback: layoutBlueprint,
  });
  const firstPageBlueprint = pageLayouts[0]?.layoutBlueprint ?? layoutBlueprint;
  const layout = layoutForBlueprint(firstPageBlueprint);
  const derivedRail = firstPageBlueprint.regions.find(
    (region) => region.id !== firstPageBlueprint.primaryRegionId,
  );
  const derivedSidebarSections = (derivedRail?.sections ?? []).filter(
    (
      section,
    ): section is ResumeStyleProfile["sidebarSections"][number] =>
      SIDEBAR_SECTIONS.has(
        section as ResumeStyleProfile["sidebarSections"][number],
      ),
  );

  return {
    version: RESUME_STYLE_PROFILE_VERSION,
    pageLayouts,
    approximate: bool(input.approximate, false),
    layout,
    layoutBlueprint: firstPageBlueprint,
    sidebarWidthPercent:
      derivedRail?.widthPercent ?? fallback.sidebarWidthPercent,
    sidebarSections:
      layout === "single-column" ? [] : [...new Set(derivedSidebarSections)],
    fontFamily,
    headingFontFamily,
    colors: {
      text: color(colors.text, fallback.colors.text),
      muted: color(colors.muted, fallback.colors.muted),
      accent: color(colors.accent, fallback.colors.accent),
      background: color(colors.background, fallback.colors.background),
      sidebarBackground: color(
        colors.sidebarBackground,
        fallback.colors.sidebarBackground,
      ),
      sidebarText: color(colors.sidebarText, fallback.colors.sidebarText),
    },
    marginsPt: {
      top: numberIn(margins.top, fallback.marginsPt.top, 36, 64),
      right: numberIn(margins.right, fallback.marginsPt.right, 36, 64),
      bottom: numberIn(margins.bottom, fallback.marginsPt.bottom, 36, 64),
      left: numberIn(margins.left, fallback.marginsPt.left, 36, 64),
    },
    typography: {
      bodyPt: numberIn(
        typography.bodyPt,
        fallback.typography.bodyPt,
        10,
        12,
      ),
      lineHeight: numberIn(
        typography.lineHeight,
        fallback.typography.lineHeight,
        1.25,
        1.65,
      ),
      namePt: numberIn(
        typography.namePt,
        fallback.typography.namePt,
        18,
        32,
      ),
      titlePt: numberIn(
        typography.titlePt,
        fallback.typography.titlePt,
        9,
        15,
      ),
      sectionPt: numberIn(
        typography.sectionPt,
        fallback.typography.sectionPt,
        8,
        13,
      ),
      metaPt: numberIn(
        typography.metaPt,
        fallback.typography.metaPt,
        7.5,
        10.5,
      ),
    },
    spacing: {
      sectionPt: numberIn(
        spacing.sectionPt,
        fallback.spacing.sectionPt,
        7,
        24,
      ),
      entryPt: numberIn(
        spacing.entryPt,
        fallback.spacing.entryPt,
        4,
        16,
      ),
      bulletPt: numberIn(
        spacing.bulletPt,
        fallback.spacing.bulletPt,
        1.5,
        7,
      ),
    },
    header: {
      alignment: oneOf(
        header.alignment,
        ["left", "center"] as const,
        fallback.header.alignment,
      ),
      divider: bool(header.divider, fallback.header.divider),
      photoPosition: oneOf(
        header.photoPosition,
        ["none", "left", "right"] as const,
        fallback.header.photoPosition,
      ),
      photoShape: oneOf(
        header.photoShape,
        ["circle", "square", "rounded"] as const,
        fallback.header.photoShape,
      ),
      photoSizePt: numberIn(
        header.photoSizePt,
        fallback.header.photoSizePt,
        44,
        92,
      ),
    },
    sectionHeading: {
      uppercase: bool(
        sectionHeading.uppercase,
        fallback.sectionHeading.uppercase,
      ),
      divider: bool(
        sectionHeading.divider,
        fallback.sectionHeading.divider,
      ),
      filled: bool(sectionHeading.filled, fallback.sectionHeading.filled),
      alignment: oneOf(
        sectionHeading.alignment,
        ["left", "center"] as const,
        fallback.sectionHeading.alignment,
      ),
    },
    bulletMarker: oneOf(
      input.bulletMarker,
      ["disc", "dash", "square"] as const,
      fallback.bulletMarker,
    ),
    // Page geometry is measured from the uploaded file, never trusted to AI.
    page: measuredPage,
  };
}

export function isCurrentResumeStyleProfile(
  value: unknown,
): value is ResumeStyleProfile {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { version?: unknown }).version ===
      RESUME_STYLE_PROFILE_VERSION
  );
}
