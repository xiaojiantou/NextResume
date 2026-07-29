// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type {
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

export function defaultResumeStyleProfile(
  page: ResumePageSpec,
): ResumeStyleProfile {
  return {
    version: 1,
    layout: "single-column",
    sidebarWidthPercent: 32,
    sidebarSections: ["contact", "skills"],
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
      bodyPt: 9.5,
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

  return {
    version: 1,
    layout: oneOf(
      input.layout,
      ["single-column", "sidebar-left", "sidebar-right"] as const,
      fallback.layout,
    ),
    sidebarWidthPercent: numberIn(
      input.sidebarWidthPercent,
      fallback.sidebarWidthPercent,
      24,
      40,
    ),
    sidebarSections: [...new Set(sidebarSections)],
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
      top: numberIn(margins.top, fallback.marginsPt.top, 20, 64),
      right: numberIn(margins.right, fallback.marginsPt.right, 20, 64),
      bottom: numberIn(margins.bottom, fallback.marginsPt.bottom, 20, 64),
      left: numberIn(margins.left, fallback.marginsPt.left, 20, 64),
    },
    typography: {
      bodyPt: numberIn(
        typography.bodyPt,
        fallback.typography.bodyPt,
        8.5,
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
