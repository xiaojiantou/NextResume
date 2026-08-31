// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { ResumeLink } from "./resumeLinks";

export type ResumeBullet = {
  id: string;
  text: string;
};

export type ResumeRole = {
  id: string;
  company: string;
  title: string;
  location: string;
  start: string;
  end: string;
  /** Verbatim tech-stack line from the source resume, e.g. "FastAPI, PostgreSQL, Redis". */
  techStack?: string;
  bullets: ResumeBullet[];
};

export type ResumeEducation = {
  school: string;
  degree: string;
  year: string;
};

/** A labeled skill category from the source resume, e.g. "Languages: Python, Go". */
export type ResumeSkillGroup = {
  label: string;
  skills: string[];
};

export type ResumeLanguage = "en";

export type ContentStructureMode = "optimize" | "preserve";

export type CoreResumeSection =
  | "summary"
  | "skills"
  | "experience"
  | "projects"
  | "education";

export type ResumeStructureConfidence = {
  level: "high" | "low";
  issues: string[];
  coverage?: number;
};

export type ResumeAdditionalSectionKind =
  | "awards"
  | "certifications"
  | "publications"
  | "languages"
  | "volunteering"
  | "custom";

export type ResumeAdditionalItem = {
  id: string;
  heading: string;
  subheading: string;
  location: string;
  start: string;
  end: string;
  bullets: ResumeBullet[];
};

export type ResumeAdditionalSection = {
  id: string;
  kind: ResumeAdditionalSectionKind;
  /** Original section heading, rendered verbatim when present. */
  title: string;
  items: ResumeAdditionalItem[];
};

export type ResumeSectionRef =
  | "summary"
  | "skills"
  | "experience"
  | "projects"
  | "education"
  | `additional:${string}`;

export type ResumeSourceLayout = {
  parser: "pdfjs-coordinates" | "linear-text" | "vision-image";
  pageCount: number;
  maxColumns: 1 | 2;
  pages: Array<{
    page: number;
    widthPt: number;
    heightPt: number;
    columns: 1 | 2;
    /**
     * Whether the coordinate pass could actually decide the column count.
     * Optional for resumes parsed before this was recorded; absent is read
     * as "not confident", which keeps the old always-verify behaviour.
     */
    columnsConfident?: boolean;
  }>;
  issues: string[];
};

export type ResumeVisualLayoutGuide = {
  pages: Array<{
    page: number;
    layout: "single-column" | "sidebar-left" | "sidebar-right" | "mixed";
    regions: Array<{
      name: string;
      headings: string[];
    }>;
  }>;
  readingOrder: string[];
  issues: string[];
};

export type ResumeStructureManifest = {
  version: 1;
  sourceFingerprint: string;
  parser: ResumeSourceLayout["parser"];
  pageCount: number;
  maxColumns: 1 | 2;
  coverage: number;
  confirmed: boolean;
  sectionOrder: ResumeSectionRef[];
  sections: Array<{
    ref: ResumeSectionRef;
    label: string;
    entryIds: string[];
    bulletIds: string[];
  }>;
};

export type ResumeProject = {
  id: string;
  name: string;
  role: string;
  location: string;
  start: string;
  end: string;
  bullets: ResumeBullet[];
};

export type Resume = {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  skills: string[];
  /**
   * The source resume's skill categories, preserved verbatim. Renderers
   * prefer this structure; the flat `skills` list feeds keyword analysis.
   */
  skillGroups?: ResumeSkillGroup[];
  experience: ResumeRole[];
  projects: ResumeProject[];
  education: ResumeEducation[];
  /**
   * Profile links from the header (LinkedIn, GitHub, portfolio). Each carries
   * the label the resume displays and, when recoverable, the target behind it
   * — a header often shows only "LinkedIn" while the URL lives in the source
   * file's annotation layer. Legacy resumes stored plain strings, so readers
   * normalize through normalizeResumeLinks rather than trusting the shape.
   */
  links?: ResumeLink[];
  photo?: string; // base64 data URI, extracted from the uploaded PDF/DOCX
  /** Optional for backwards compatibility with previously persisted resumes. */
  language?: ResumeLanguage;
  /** Reading order detected from the source resume. */
  sectionOrder?: ResumeSectionRef[];
  /** Verbatim headings detected for core sections. */
  sectionLabels?: Partial<Record<CoreResumeSection, string>>;
  /** Low confidence is surfaced as a non-blocking approximation warning. */
  structureConfidence?: ResumeStructureConfidence;
  /** Coordinate/vision summary used to assess complex source layouts. */
  sourceLayout?: ResumeSourceLayout;
  /** Immutable snapshot of the detected semantic structure. */
  structureManifest?: ResumeStructureManifest;
  /** Verbatim sections that do not fit the core resume schema. */
  additionalSections?: ResumeAdditionalSection[];
};

export type ResumePageSpec = {
  widthPt: number;
  heightPt: number;
  orientation: "portrait" | "landscape";
};

export type ResumeStyleSource = {
  screenshots: string[];
  page: ResumePageSpec;
  pageCount: number;
  /** Optional semantic layout hints captured during the original parse. */
  visualLayoutGuide?: ResumeVisualLayoutGuide | null;
  /** Deterministic PDF-coordinate fallback when vision is unavailable. */
  sourceLayout?: ResumeSourceLayout | null;
};

export type ResumeLayout =
  | "single-column"
  | "sidebar-left"
  | "sidebar-right"
  | "regional";

export type ResumeLayoutSection =
  | "contact"
  | "photo"
  | "summary"
  | "skills"
  | "experience"
  | "projects"
  | "education"
  | "additional";

export type ResumeLayoutRegion = {
  id: string;
  role: "main" | "sidebar" | "supporting";
  widthPercent: number;
  surface: "page" | "sidebar" | "subtle";
  sections: ResumeLayoutSection[];
};

export type ResumeLayoutBlueprint = {
  /** Header spans the page or begins the primary content region. */
  headerPlacement: "full" | "primary" | "none";
  primaryRegionId: string;
  gutterPt: number;
  /** Left-to-right, flow-based regions. Absolute positioning is forbidden. */
  regions: ResumeLayoutRegion[];
};

export type ResumePageLayout = {
  page: number;
  layout: ResumeLayout;
  layoutBlueprint: ResumeLayoutBlueprint;
};

export type ResumeStyleProfile = {
  version: 5;
  /** V2 renders every output page from an independent, bounded template. */
  pageLayouts: ResumePageLayout[];
  /** True when the safe deterministic approximation replaced vision output. */
  approximate?: boolean;
  layout: ResumeLayout;
  layoutBlueprint: ResumeLayoutBlueprint;
  /** Derived legacy fields retained for persisted v2 profiles and Fit calls. */
  sidebarWidthPercent: number;
  sidebarSections: Array<
    "contact" | "summary" | "skills" | "education" | "additional"
  >;
  fontFamily:
    | "Arial"
    | "Helvetica"
    | "Verdana"
    | "Georgia"
    | "Times New Roman";
  headingFontFamily:
    | "Arial"
    | "Helvetica"
    | "Verdana"
    | "Georgia"
    | "Times New Roman";
  colors: {
    text: string;
    muted: string;
    accent: string;
    background: string;
    sidebarBackground: string;
    sidebarText: string;
  };
  marginsPt: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  typography: {
    bodyPt: number;
    lineHeight: number;
    namePt: number;
    titlePt: number;
    sectionPt: number;
    metaPt: number;
  };
  spacing: {
    sectionPt: number;
    entryPt: number;
    bulletPt: number;
  };
  header: {
    alignment: "left" | "center";
    divider: boolean;
    photoPosition: "none" | "left" | "right";
    photoShape: "circle" | "square" | "rounded";
    photoSizePt: number;
  };
  sectionHeading: {
    uppercase: boolean;
    divider: boolean;
    filled: boolean;
    alignment: "left" | "center";
  };
  bulletMarker: "disc" | "dash" | "square";
  page: ResumePageSpec;
};

export type JobAnalysis = {
  title: string;
  company: string;
  seniority: string;
  requiredKeywords: string[];
  niceToHaveKeywords: string[];
  responsibilities: string[];
};

export type AtsCategory = {
  label: string;
  score: number;
  detail: string;
};

export type AtsReport = {
  overallBefore: number;
  /** Model projection made BEFORE optimization runs. Display as "projected". */
  overallAfter: number;
  categoriesBefore: AtsCategory[];
  categoriesAfter: AtsCategory[];
  missingKeywords: string[];
  presentKeywords: string[];
  /** Real score measured by re-running analysis on the optimized resume. */
  measuredAfter?: number;
  measuredCategories?: AtsCategory[];
  /**
   * Keywords repeated often enough to read as manipulation. Surfaced to the
   * user because Workday's 2026 filter flags unnatural density.
   */
  stuffingWarnings?: string[];
};

export type FitVerdict = "strong" | "good" | "stretch" | "weak";

/**
 * The qualitative counterpart to AtsReport: what this employer is actually
 * hiring for beneath the JD's wording, and the story this resume should tell
 * for it. Written by a model; anchored to real resume lines by prompt contract.
 */
export type FitBrief = {
  verdict: FitVerdict;
  /** One-sentence conclusion, stated first — never a hedge. */
  headline: string;
  /** What the employer really needs, read between the JD's lines. */
  whatTheyWant: string;
  /** The role's real workflow as 3-6 short steps, e.g. "define the problem with the customer". */
  workflow: string[];
  /** The narrative the tailored resume should lead with. */
  yourStory: string;
  strengths: Array<{ point: string; evidence: string }>;
  gaps: Array<{ point: string; mitigation: string }>;
};

export type BulletSuggestion = "keep" | "trim" | "cut";

export type OptimizedBullet = {
  id: string;
  text: string;
  evidence: string[];
  matchedKeywords: string[];
  rationale: string;
  /** 0-100 relevance of this bullet to the target job description. */
  relevance?: number;
  /** Model's recommendation; the user decides — nothing is dropped silently. */
  suggestion?: BulletSuggestion;
};

export type OptimizedRole = {
  id: string;
  bullets: OptimizedBullet[];
};

export type OptimizedProject = {
  id: string;
  bullets: OptimizedBullet[];
};

export type OptimizedAdditionalItem = {
  id: string;
  bullets: OptimizedBullet[];
};

export type OptimizedAdditionalSection = {
  id: string;
  items: OptimizedAdditionalItem[];
};

export type SkillGrounding = "direct" | "indirect";

export type SkillEvidenceType =
  | "tool"
  | "capability"
  | "domain"
  | "soft"
  | "credential"
  | "language";

export type SkillEvidence = {
  skill: string;
  grounding: SkillGrounding;
  skillType: SkillEvidenceType;
  evidence: string[];
  rationale: string;
};

export type StructureIntegrity = {
  valid: boolean;
  sectionsPreserved: number;
  totalSections: number;
  entriesPreserved: number;
  totalEntries: number;
  bulletsPreserved: number;
  totalBullets: number;
  factualFieldsChanged: number;
  issues: string[];
};

export type Optimization = {
  summary: string;
  title: string;
  skills: string[];
  skillEvidence?: SkillEvidence[];
  roles: OptimizedRole[];
  projects: OptimizedProject[];
  additionalSections?: OptimizedAdditionalSection[];
  /** Section order selected for the optimized document. */
  sectionOrder?: ResumeSectionRef[];
  /** Optimized core headings. Preserve mode copies the source headings here. */
  sectionLabels?: Partial<Record<CoreResumeSection, string>>;
  structureMode?: ContentStructureMode;
  structureIntegrity?: StructureIntegrity;
  atsScore?: number;
};

export type OptimizationVariant = {
  cacheKey: string;
  structureMode: ContentStructureMode;
  modelId: string;
  optimization: Optimization;
  createdAt: string;
  lastUsedAt: string;
};

export type PreviewBullet = {
  preview: OptimizedBullet;
  targetBulletId: string;
  targetBulletText: string;
};
