// Copyright (c) 2026 HowBe LLC. All rights reserved.

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
  /** Profile links from the header (LinkedIn, GitHub, portfolio) in display form. */
  links?: string[];
  photo?: string; // base64 data URI, extracted from the uploaded PDF/DOCX
  /** Optional for backwards compatibility with previously persisted resumes. */
  language?: ResumeLanguage;
  /** Reading order detected from the source resume. */
  sectionOrder?: ResumeSectionRef[];
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
};

export type ResumeLayout =
  | "single-column"
  | "sidebar-left"
  | "sidebar-right";

export type ResumeStyleProfile = {
  version: 1;
  layout: ResumeLayout;
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

export type Optimization = {
  summary: string;
  title: string;
  skills: string[];
  roles: OptimizedRole[];
  projects: OptimizedProject[];
};

export type PreviewBullet = {
  preview: OptimizedBullet;
  targetBulletId: string;
  targetBulletText: string;
};
