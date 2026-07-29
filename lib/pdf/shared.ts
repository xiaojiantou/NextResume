// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The canonical "what goes on the resume" resolution. Every PDF style must
// consume this document rather than deciding independently which content to
// show. That makes style a presentation choice only.
import type {
  Optimization,
  Resume,
  ResumeAdditionalSection,
  ResumeLanguage,
  ResumeSectionRef,
} from "@/lib/types";

export type ResolvedBlock = {
  id: string;
  heading: string;
  subheading: string;
  location: string;
  start: string;
  end: string;
  bullets: string[];
};

export type ResolvedResumeDocument = {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  photo?: string;
  language: ResumeLanguage;
  summary: string;
  skills: string[];
  experience: ResolvedBlock[];
  projects: ResolvedBlock[];
  education: Resume["education"];
  additionalSections: ResumeAdditionalSection[];
  sectionOrder: ResumeSectionRef[];
};

const CORE_ORDER: ResumeSectionRef[] = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
];

export function detectResumeLanguage(_resume: Resume): ResumeLanguage {
  return "en";
}

export function getResumeSectionLabels(_language: ResumeLanguage) {
  return {
    summary: "Summary",
    skills: "Skills",
    experience: "Experience",
    projects: "Projects",
    education: "Education",
    awards: "Awards",
    certifications: "Certifications",
    publications: "Publications",
    languages: "Languages",
    volunteering: "Volunteering",
    custom: "Additional Information",
  };
}

function sectionHasContent(
  ref: ResumeSectionRef,
  content: Pick<
    ResolvedResumeDocument,
    | "summary"
    | "skills"
    | "experience"
    | "projects"
    | "education"
    | "additionalSections"
  >,
): boolean {
  if (ref === "summary") return Boolean(content.summary);
  if (ref === "skills") return content.skills.length > 0;
  if (ref === "experience") return content.experience.length > 0;
  if (ref === "projects") return content.projects.length > 0;
  if (ref === "education") return content.education.length > 0;
  if (ref.startsWith("additional:")) {
    const id = ref.slice("additional:".length);
    return Boolean(
      content.additionalSections.find(
        (section) => section.id === id && section.items.length > 0,
      ),
    );
  }
  return false;
}

function resolveSectionOrder(
  resume: Resume,
  content: Pick<
    ResolvedResumeDocument,
    | "summary"
    | "skills"
    | "experience"
    | "projects"
    | "education"
    | "additionalSections"
  >,
): ResumeSectionRef[] {
  const additionalRefs = content.additionalSections.map(
    (section) => `additional:${section.id}` as const,
  );
  const sourceOrder = (resume.sectionOrder ?? []).filter((ref) =>
    sectionHasContent(ref, content),
  );
  const seen = new Set<ResumeSectionRef>();
  const deduped = sourceOrder.filter((ref) => {
    if (seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });

  // Sections introduced by optimization but absent from the source resume
  // belong immediately after the header. Preserve the remaining source order.
  const introduced = (["summary", "skills"] as ResumeSectionRef[]).filter(
    (ref) => sectionHasContent(ref, content) && !seen.has(ref),
  );
  for (const ref of introduced) seen.add(ref);
  const missing = [...CORE_ORDER, ...additionalRefs].filter(
    (ref) => sectionHasContent(ref, content) && !seen.has(ref),
  );
  return [...introduced, ...deduped, ...missing];
}

export function resolveResumeContent(
  resume: Resume,
  optimization: Optimization | null,
): ResolvedResumeDocument {
  const summary = optimization?.summary || resume.summary;
  const title = optimization?.title || resume.title;
  const skills =
    optimization?.skills && optimization.skills.length > 0
      ? optimization.skills
      : resume.skills;

  const experience: ResolvedBlock[] = resume.experience.map((role) => {
    const opt = optimization?.roles.find((r) => r.id === role.id);
    const bullets = opt?.bullets.length
      ? opt.bullets.map((b) => b.text)
      : role.bullets.map((b) => b.text);
    return {
      id: role.id,
      heading: role.company,
      subheading: role.title,
      location: role.location,
      start: role.start,
      end: role.end,
      bullets,
    };
  });

  const projects: ResolvedBlock[] = (resume.projects ?? []).map(
    (project) => {
      const opt = optimization?.projects?.find((p) => p.id === project.id);
      const bullets = opt?.bullets.length
        ? opt.bullets.map((b) => b.text)
        : project.bullets.map((b) => b.text);
      return {
        id: project.id,
        heading: project.name,
        subheading: project.role,
        location: project.location,
        start: project.start,
        end: project.end,
        bullets,
      };
    },
  );

  const base = {
    summary,
    skills,
    experience,
    projects,
    education: resume.education ?? [],
    additionalSections: resume.additionalSections ?? [],
  };

  return {
    name: resume.name,
    title,
    email: resume.email,
    phone: resume.phone,
    location: resume.location,
    photo: resume.photo,
    language: detectResumeLanguage(resume),
    ...base,
    sectionOrder: resolveSectionOrder(resume, base),
  };
}
