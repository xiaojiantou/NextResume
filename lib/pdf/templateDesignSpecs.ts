// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { FixedPdfStyle } from "./config";

export type TemplateDesignSpec = {
  style: FixedPdfStyle;
  audience: string;
  tone: string;
  typography: string;
  layout: string;
  hierarchy: string;
  signature: string;
  must: readonly string[];
  avoid: readonly string[];
};

// Internal design briefs for deterministic templates. These are development
// references, not runtime prompts: exports remain stable and do not call AI.
export const TEMPLATE_DESIGN_SPECS: readonly TemplateDesignSpec[] = [
  {
    style: "classic",
    audience: "General professional, finance, legal, and public sector",
    tone: "Conservative, dependable, concise",
    typography: "Times for document voice; Helvetica for metadata",
    layout: "Centered identity header over a single reading column",
    hierarchy: "Rules and uppercase labels separate conventional sections",
    signature: "A restrained double-weight header rule",
    must: ["Preserve standard headings", "Keep one canonical reading order"],
    avoid: ["Decorative icons", "Oversized color fields"],
  },
  {
    style: "sidebar",
    audience: "Candidates who value quick human scanning and visual identity",
    tone: "Structured, modern, confident",
    typography: "Helvetica throughout for compact clarity",
    layout: "Contact, skills, and education in a left rail; narrative on right",
    hierarchy: "High-contrast rail and quiet main-column headings",
    signature: "A full-height color rail",
    must: ["Keep all text selectable", "Label ATS compatibility honestly"],
    avoid: ["Skill meters", "Essential information represented by icons alone"],
  },
  {
    style: "minimal",
    audience: "Product, design, operations, and modern business roles",
    tone: "Quiet, precise, approachable",
    typography: "Helvetica with disciplined weight changes",
    layout: "Airy single column with compact filled section labels",
    hierarchy: "Small labels, generous rhythm, simple dashes",
    signature: "Compact section chips used only as navigation markers",
    must: ["Retain whitespace", "Use color only as emphasis"],
    avoid: ["Nested boxes", "Excessive pill decoration"],
  },
  {
    style: "academic",
    audience: "Research, teaching, scientific, and graduate applications",
    tone: "Scholarly, credible, publication-minded",
    typography: "Times family with Helvetica metadata",
    layout: "Single column with left-aligned identity and fine horizontal rules",
    hierarchy: "Institutional section labels and citation-like date treatment",
    signature: "A compact academic masthead",
    must: ["Support long sections", "Keep publication titles readable"],
    avoid: ["Marketing language", "Graphic ornaments"],
  },
  {
    style: "executive",
    audience: "Director, VP, C-suite, and senior leadership candidates",
    tone: "Authoritative, measured, outcome-oriented",
    typography: "Helvetica display with Times body for gravitas",
    layout: "Single column with a strong identity band and clear chronology",
    hierarchy: "Leadership summary first; roles carry strong company lines",
    signature: "A narrow vertical authority bar beside the name",
    must: ["Allow two-page resumes", "Prioritize quantified impact"],
    avoid: ["Tiny text", "Overly decorative executive clichés"],
  },
  {
    style: "tech",
    audience: "Software, data, infrastructure, and AI roles",
    tone: "Precise, current, systems-oriented",
    typography: "Helvetica body with Courier labels and dates",
    layout: "Single column with a skills-forward information band",
    hierarchy: "Technical vocabulary is scannable without skill bars",
    signature: "Monospaced metadata and bracket-like section rules",
    must: ["Keep keywords as text", "Preserve project detail"],
    avoid: ["Neon backgrounds", "Fake terminal decoration"],
  },
  {
    style: "elegant",
    audience: "Communications, consulting, brand, editorial, and client roles",
    tone: "Refined, warm, self-assured",
    typography: "Times display with Helvetica body and metadata",
    layout: "Editorial single column with an asymmetric header rule",
    hierarchy: "Serif identity, quiet sans-serif detail, deliberate whitespace",
    signature: "A fine offset rule that frames the identity block",
    must: ["Stay ATS-readable", "Use one restrained accent"],
    avoid: ["Fashion-magazine excess", "Low-contrast body copy"],
  },
] as const;
