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
  bullets: ResumeBullet[];
};

export type ResumeEducation = {
  school: string;
  degree: string;
  year: string;
};

export type Resume = {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  skills: string[];
  experience: ResumeRole[];
  education: ResumeEducation[];
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
  overallAfter: number;
  categoriesBefore: AtsCategory[];
  categoriesAfter: AtsCategory[];
  missingKeywords: string[];
  presentKeywords: string[];
};

export type OptimizedBullet = {
  id: string;
  text: string;
  evidence: string[];
  matchedKeywords: string[];
  rationale: string;
};

export type OptimizedRole = {
  id: string;
  bullets: OptimizedBullet[];
};

export type Optimization = {
  summary: string;
  title: string;
  skills: string[];
  roles: OptimizedRole[];
};
