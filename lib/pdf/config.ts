// Copyright (c) 2026 HowBe LLC. All rights reserved.

export type PdfStyle =
  | "personalized"
  | "classic"
  | "sidebar"
  | "minimal"
  | "academic"
  | "executive"
  | "tech"
  | "elegant";

export type FixedPdfStyle = Exclude<PdfStyle, "personalized">;
export type AtsCompatibility =
  | "optimized"
  | "compatible"
  | "source-dependent";
export type TargetPages = "auto" | number;

export type ResumePalette = {
  id: string;
  label: string;
  text: string;
  muted: string;
  accent: string;
  border: string;
  soft: string;
  background: string;
  sidebarBackground: string;
  sidebarText: string;
};

export type PdfStyleDefinition = {
  id: PdfStyle;
  label: string;
  blurb: string;
  ats: AtsCompatibility;
  palettes: readonly ResumePalette[];
};

const palette = (
  id: string,
  label: string,
  colors: Omit<ResumePalette, "id" | "label">,
): ResumePalette => ({ id, label, ...colors });

const COMMON = {
  text: "#18181b",
  muted: "#52525b",
  border: "#d4d4d8",
  background: "#ffffff",
  sidebarText: "#ffffff",
};

export const PDF_STYLE_DEFINITIONS: readonly PdfStyleDefinition[] = [
  {
    id: "personalized",
    label: "Original-inspired",
    blurb: "Rebuilds the uploaded resume's regions, hierarchy, and visual language",
    ats: "source-dependent",
    palettes: [],
  },
  {
    id: "classic",
    label: "Classic",
    blurb: "Traditional single column with a restrained serif voice",
    ats: "optimized",
    palettes: [
      palette("classic-ink", "Ink", {
        ...COMMON,
        accent: "#27272a",
        soft: "#f4f4f5",
        sidebarBackground: "#27272a",
      }),
      palette("classic-navy", "Navy", {
        ...COMMON,
        accent: "#1e3a5f",
        border: "#cbd5e1",
        soft: "#eef3f8",
        sidebarBackground: "#1e3a5f",
      }),
      palette("classic-burgundy", "Burgundy", {
        ...COMMON,
        accent: "#7f1d1d",
        border: "#e7c8c8",
        soft: "#fdf2f2",
        sidebarBackground: "#7f1d1d",
      }),
    ],
  },
  {
    id: "sidebar",
    label: "Sidebar",
    blurb: "Structured two-column layout for fast visual scanning",
    ats: "compatible",
    palettes: [
      palette("sidebar-navy", "Navy", {
        ...COMMON,
        accent: "#1e3a8a",
        border: "#bfdbfe",
        soft: "#eff6ff",
        sidebarBackground: "#1e3a8a",
      }),
      palette("sidebar-forest", "Forest", {
        ...COMMON,
        accent: "#2d4a2b",
        border: "#cbd5c0",
        soft: "#f3f6f0",
        sidebarBackground: "#2d4a2b",
      }),
      palette("sidebar-slate", "Slate", {
        ...COMMON,
        accent: "#334155",
        border: "#cbd5e1",
        soft: "#f1f5f9",
        sidebarBackground: "#334155",
      }),
    ],
  },
  {
    id: "minimal",
    label: "Minimal",
    blurb: "Quiet sans-serif layout with compact section markers",
    ats: "optimized",
    palettes: [
      palette("minimal-monochrome", "Monochrome", {
        ...COMMON,
        accent: "#3f3f46",
        soft: "#f4f4f5",
        sidebarBackground: "#3f3f46",
      }),
      palette("minimal-blue", "Blue", {
        ...COMMON,
        accent: "#2563eb",
        border: "#bfdbfe",
        soft: "#eff6ff",
        sidebarBackground: "#2563eb",
      }),
      palette("minimal-terracotta", "Terracotta", {
        ...COMMON,
        accent: "#9a4f3b",
        border: "#e7cfc8",
        soft: "#fbf3f0",
        sidebarBackground: "#9a4f3b",
      }),
    ],
  },
  {
    id: "academic",
    label: "Academic",
    blurb: "Publication-minded hierarchy with scholarly serif type",
    ats: "optimized",
    palettes: [
      palette("academic-black", "Black", {
        ...COMMON,
        accent: "#18181b",
        soft: "#f4f4f5",
        sidebarBackground: "#18181b",
      }),
      palette("academic-oxford", "Oxford Blue", {
        ...COMMON,
        accent: "#172554",
        border: "#c7d2fe",
        soft: "#eef2ff",
        sidebarBackground: "#172554",
      }),
      palette("academic-burgundy", "Burgundy", {
        ...COMMON,
        accent: "#701f36",
        border: "#e8c7d0",
        soft: "#fcf1f4",
        sidebarBackground: "#701f36",
      }),
    ],
  },
  {
    id: "executive",
    label: "Executive",
    blurb: "Authoritative hierarchy for senior leadership impact",
    ats: "optimized",
    palettes: [
      palette("executive-midnight", "Midnight", {
        ...COMMON,
        accent: "#0f2744",
        border: "#c4d1df",
        soft: "#eef3f8",
        sidebarBackground: "#0f2744",
      }),
      palette("executive-charcoal", "Charcoal", {
        ...COMMON,
        accent: "#36454f",
        border: "#cbd0d3",
        soft: "#f1f3f4",
        sidebarBackground: "#36454f",
      }),
      palette("executive-forest", "Forest", {
        ...COMMON,
        accent: "#244334",
        border: "#c5d6cb",
        soft: "#f0f5f2",
        sidebarBackground: "#244334",
      }),
    ],
  },
  {
    id: "tech",
    label: "Tech",
    blurb: "Precise, skills-forward layout with subtle mono details",
    ats: "optimized",
    palettes: [
      palette("tech-cobalt", "Cobalt", {
        ...COMMON,
        accent: "#1d4ed8",
        border: "#bfdbfe",
        soft: "#eff6ff",
        sidebarBackground: "#1d4ed8",
      }),
      palette("tech-teal", "Teal", {
        ...COMMON,
        accent: "#0f766e",
        border: "#99f6e4",
        soft: "#f0fdfa",
        sidebarBackground: "#0f766e",
      }),
      palette("tech-violet", "Violet", {
        ...COMMON,
        accent: "#6d28d9",
        border: "#ddd6fe",
        soft: "#f5f3ff",
        sidebarBackground: "#6d28d9",
      }),
    ],
  },
  {
    id: "elegant",
    label: "Elegant",
    blurb: "Refined editorial header with a restrained serif accent",
    ats: "optimized",
    palettes: [
      palette("elegant-wine", "Wine", {
        ...COMMON,
        accent: "#6f2942",
        border: "#e2c6d0",
        soft: "#faf1f4",
        sidebarBackground: "#6f2942",
      }),
      palette("elegant-emerald", "Emerald", {
        ...COMMON,
        accent: "#176b55",
        border: "#b8ddcf",
        soft: "#eff9f5",
        sidebarBackground: "#176b55",
      }),
      palette("elegant-warm-gray", "Warm Gray", {
        ...COMMON,
        text: "#292524",
        muted: "#57534e",
        accent: "#78716c",
        border: "#d6d3d1",
        soft: "#f5f5f4",
        sidebarBackground: "#57534e",
      }),
    ],
  },
] as const;

export function isPdfStyle(value: unknown): value is PdfStyle {
  return PDF_STYLE_DEFINITIONS.some((definition) => definition.id === value);
}

export function getPdfStyleDefinition(style: PdfStyle): PdfStyleDefinition {
  return (
    PDF_STYLE_DEFINITIONS.find((definition) => definition.id === style) ??
    PDF_STYLE_DEFINITIONS[1]
  );
}

export function getDefaultPaletteId(style: FixedPdfStyle): string {
  return getPdfStyleDefinition(style).palettes[0]?.id ?? "classic-ink";
}

export function getResumePalette(
  style: FixedPdfStyle,
  paletteId?: string | null,
): ResumePalette {
  const palettes = getPdfStyleDefinition(style).palettes;
  return (
    palettes.find((candidate) => candidate.id === paletteId) ??
    palettes[0] ??
    getPdfStyleDefinition("classic").palettes[0]
  );
}

export function normalizeTargetPages(value: unknown): TargetPages {
  if (value === "auto" || value === undefined || value === null) return "auto";
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) return "auto";
  return Math.min(10, Math.max(1, parsed));
}
