// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The canonical "what goes on the resume" resolution. Every PDF style must
// consume this document rather than deciding independently which content to
// show. That makes style a presentation choice only.
import type {
  Optimization,
  CoreResumeSection,
  Resume,
  ResumeAdditionalItem,
  ResumeAdditionalSection,
  ResumeLanguage,
  ResumeSectionRef,
  ResumeSkillGroup,
} from "@/lib/types";
// Relative with an explicit extension: this is a value import, and the "@/"
// alias only resolves under the bundler, not the node test runner.
import type { ResumeLink } from "../resumeLinks.ts";
import { normalizeResumeLinks } from "../resumeLinks.ts";

export type ResolvedBlock = {
  id: string;
  heading: string;
  subheading: string;
  location: string;
  start: string;
  end: string;
  bullets: string[];
  teams?: ResolvedTeamBlock[];
};

export type ResolvedTeamBlock = {
  id: string;
  heading: string;
  subheading: string;
  location: string;
  start: string;
  end: string;
  bullets: string[];
};

export type ResolvedExperienceGroup = {
  id: string;
  title: string;
  blocks: ResolvedBlock[];
};

export type ResolvedResumeDocument = {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  links: ResumeLink[];
  photo?: string;
  language: ResumeLanguage;
  summary: string;
  skills: string[];
  /** Source skill categories; when non-empty, render these instead of `skills`. */
  skillGroups: ResumeSkillGroup[];
  experience: ResolvedBlock[];
  /** Source headings that group work roles, e.g. "Earlier Experience". */
  experienceGroups: ResolvedExperienceGroup[];
  projects: ResolvedBlock[];
  education: Resume["education"];
  additionalSections: ResumeAdditionalSection[];
  sectionOrder: ResumeSectionRef[];
  sectionLabels: Partial<Record<CoreResumeSection, string>>;
};

const CORE_ORDER: ResumeSectionRef[] = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
];

const ADDITIONAL_KIND_BY_TITLE: Array<
  [RegExp, ResumeAdditionalSection["kind"]]
> = [
  [/award|honou?r|prize|scholarship/i, "awards"],
  [/certification|certificate|licen[cs]e/i, "certifications"],
  [/publication|paper|patent/i, "publications"],
  [/language|ielts|toefl|cet[- ]?\d/i, "languages"],
  [/volunteer|community|leadership|service|activit/i, "volunteering"],
];

const COMPACT_ADDITIONAL_TITLE =
  /course|coursework|curriculum|subjects?|skills?|technical|tech stack|technolog|tools?|agent\s*\/\s*ai|engineering|model adaptation|context\s*\/\s*retrieval/i;

/**
 * Short taxonomy-style values should flow across the available width. Treating
 * each parsed value as a resume entry wastes a full line and makes skills and
 * coursework look like a vertical word list.
 */
export function isCompactAdditionalSection(
  section: ResumeAdditionalSection,
): boolean {
  const compactKind = section.kind === "custom" || section.kind === "languages";
  if (!compactKind && !COMPACT_ADDITIONAL_TITLE.test(section.title)) {
    return false;
  }
  return (
    section.items.length > 0 &&
    section.items.every(
      (item) =>
        Boolean(item.heading || item.subheading) &&
        !item.location &&
        !item.start &&
        !item.end &&
        item.bullets.length === 0,
    )
  );
}

export function compactAdditionalItemLabel(
  item: ResumeAdditionalItem,
): string {
  return [item.heading, item.subheading].filter(Boolean).join(" · ");
}

function canonicalAdditionalKind(
  section: ResumeAdditionalSection,
): ResumeAdditionalSection["kind"] {
  if (section.kind !== "custom") return section.kind;
  return (
    ADDITIONAL_KIND_BY_TITLE.find(([pattern]) =>
      pattern.test(section.title),
    )?.[1] ?? "custom"
  );
}

export function supplementalEducationLabel(title: string): string | null {
  if (/course|coursework|curriculum|relevant subjects?/i.test(title)) {
    return "Relevant Coursework";
  }
  if (/entrance exam|exam score|test score/i.test(title)) {
    return "Graduate Entrance Exam";
  }
  return null;
}

export function isSupplementalSkillsSection(
  section: ResumeAdditionalSection,
): boolean {
  return (
    /skills?|technical|tech stack|technologies|agent\s*\/\s*ai|engineering tools?|model adaptation|context\s*\/\s*retrieval/i.test(
      section.title,
    ) &&
    section.items.every(
      (item) => !item.location && !item.start && !item.end,
    )
  );
}

function supplementalSkillValues(
  section: ResumeAdditionalSection,
): string[] {
  return section.items.flatMap((item) =>
    [
      item.heading,
      item.subheading,
      ...item.bullets.map((bullet) => bullet.text),
    ].filter(Boolean),
  );
}

function dedupeTextValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.normalize("NFKC").toLocaleLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveRoleBullets(
  role: Resume["experience"][number],
  opt: Optimization["roles"][number] | undefined,
): {
  bySourceId: Map<string, string>;
  ordered: Array<{ sourceId: string; text: string }>;
  unmapped: string[];
} {
  const sourceIds = new Set(role.bullets.map((bullet) => bullet.id));
  if (!opt) {
    const ordered = role.bullets.map((bullet) => ({
      sourceId: bullet.id,
      text: bullet.text,
    }));
    return {
      bySourceId: new Map(
        ordered.map((bullet) => [bullet.sourceId, bullet.text]),
      ),
      ordered,
      unmapped: [],
    };
  }

  const bySourceId = new Map<string, string>();
  const usedOptimizedIndexes = new Set<number>();
  opt.bullets.forEach((bullet, index) => {
    const sourceId =
      (sourceIds.has(bullet.id) ? bullet.id : "") ||
      (bullet.evidence ?? []).find((id) => sourceIds.has(id)) ||
      role.bullets[index]?.id ||
      "";
    if (!sourceId || bySourceId.has(sourceId)) return;
    bySourceId.set(sourceId, bullet.text);
    usedOptimizedIndexes.add(index);
  });

  const ordered = role.bullets.flatMap((bullet) => {
    const text = bySourceId.get(bullet.id);
    return text ? [{ sourceId: bullet.id, text }] : [];
  });
  const unmapped = opt.bullets.flatMap((bullet, index) =>
    usedOptimizedIndexes.has(index) ? [] : [bullet.text],
  );
  return { bySourceId, ordered, unmapped };
}

function compactAdditionalItemText(
  item: ResumeAdditionalSection["items"][number],
): string {
  return [
    item.heading,
    item.subheading,
    item.location,
    [item.start, item.end].filter(Boolean).join(" — "),
    ...item.bullets.map((bullet) => bullet.text),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function detectResumeLanguage(_resume: Resume): ResumeLanguage {
  return "en";
}

export function getResumeSectionLabels(
  _language: ResumeLanguage,
  original?: Partial<Record<CoreResumeSection, string>>,
) {
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
    ...original,
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
  preferredOrder: ResumeSectionRef[] | undefined,
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
  const sourceOrder = (preferredOrder ?? []).filter((ref) =>
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

function normalizedHeading(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function resolveExperienceGroups(
  groups: Resume["experienceGroups"],
  blocks: ResolvedBlock[],
  displayedExperienceLabel: string,
): ResolvedExperienceGroup[] {
  if (!groups?.length || blocks.length === 0) return [];
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const groupedRoleIds = new Set<string>();
  const resolvedGroups = groups
    .map((group) => {
      const groupBlocks = group.roleIds
        .map((id) => blockById.get(id))
        .filter((block): block is ResolvedBlock => Boolean(block));
      groupBlocks.forEach((block) => groupedRoleIds.add(block.id));
      return {
        id: group.id,
        title: group.title,
        blocks: groupBlocks,
      };
    })
    .filter((group) => group.blocks.length > 0);
  const ungrouped = blocks.filter((block) => !groupedRoleIds.has(block.id));
  if (ungrouped.length > 0) {
    resolvedGroups.push({
      id: "experience-ungrouped",
      title: "",
      blocks: ungrouped,
    });
  }
  const displayLabel = normalizedHeading(displayedExperienceLabel);
  return resolvedGroups.map((group, index) => ({
    ...group,
    title:
      index === 0 && normalizedHeading(group.title) === displayLabel
        ? ""
        : group.title,
  }));
}

export type ResolveResumeOptions = {
  /**
   * When false, drop the AI-generated summary. Only affects the optimized
   * summary — used so users whose source resume had no summary section can
   * keep it that way.
   */
  includeSummary?: boolean;
};

export function resolveResumeContent(
  resume: Resume,
  optimization: Optimization | null,
  options?: ResolveResumeOptions,
): ResolvedResumeDocument {
  const summary =
    options?.includeSummary === false
      ? resume.summary
      : optimization
        ? optimization.summary
        : resume.summary;
  // Exact-page variants may intentionally clear the title or skills list.
  // Presence of an optimization object is the signal to use its values; an
  // empty string/array is not a missing value.
  const title = optimization ? optimization.title : resume.title;
  const skills = optimization ? optimization.skills : resume.skills;

  const experience: ResolvedBlock[] = resume.experience.map((role) => {
    const opt = optimization?.roles.find((r) => r.id === role.id);
    const resolvedBullets = resolveRoleBullets(role, opt);
    const teamBulletIds = new Set(
      (role.teams ?? []).flatMap((team) => team.bulletIds),
    );
    // An explicit empty optimized bullet list is meaningful during exact-page
    // fitting: it keeps the role metadata while omitting lower-priority detail.
    // Only fall back to source bullets when the optimization has no owner at
    // all. Treating [] as missing silently restored removed copy in the PDF.
    const bullets = [
      ...resolvedBullets.ordered
        .filter((bullet) => !teamBulletIds.has(bullet.sourceId))
        .map((bullet) => bullet.text),
      ...resolvedBullets.unmapped,
    ];
    const teams = (role.teams ?? [])
      .map((team) => ({
        id: team.id,
        heading: team.name,
        subheading: team.title,
        location: team.location,
        start: team.start,
        end: team.end,
        bullets: team.bulletIds
          .map((id) => resolvedBullets.bySourceId.get(id))
          .filter((text): text is string => Boolean(text)),
      }))
      .filter((team) => team.bullets.length > 0);
    // The source tech-stack line carries real keyword weight — keep it on the
    // title line the way the original resume printed it.
    const subheading = role.techStack
      ? `${role.title} | ${role.techStack}`
      : role.title;
    return {
      id: role.id,
      heading: role.company,
      subheading,
      location: role.location,
      start: role.start,
      end: role.end,
      bullets,
      ...(teams.length > 0 ? { teams } : {}),
    };
  });

  const projects: ResolvedBlock[] = (resume.projects ?? []).map(
    (project) => {
      const opt = optimization?.projects?.find((p) => p.id === project.id);
      const bullets = opt
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

  const resolvedAdditionalSections = (resume.additionalSections ?? []).map(
    (section) => {
      const optimizedSection = optimization?.additionalSections?.find(
        (candidate) => candidate.id === section.id,
      );
      return {
        ...section,
        items: section.items.map((item) => {
          const optimizedItem = optimizedSection?.items.find(
            (candidate) => candidate.id === item.id,
          );
          return {
            ...item,
            bullets: optimizedItem
              ? optimizedItem.bullets.map((bullet) => ({
                  id: bullet.id,
                  text: bullet.text,
                }))
              : item.bullets,
          };
        }),
      };
    },
  );

  // Role optimization uses the application's semantic schema, not arbitrary
  // source-PDF heading names. Preserve every entry, but group source extras
  // into conventional ATS-friendly sections. Keep-original bypasses this and
  // continues to render source headings/order verbatim.
  const additionalRefMap = new Map<string, ResumeSectionRef | null>();
  const supplementalEducation: Resume["education"] = [];
  const supplementalSkills: string[] = [];
  const additionalSections =
    optimization && optimization.structureMode !== "preserve"
      ? (() => {
          const labels = getResumeSectionLabels(detectResumeLanguage(resume));
          const grouped = new Map<
            ResumeAdditionalSection["kind"],
            ResumeAdditionalSection
          >();
          for (const section of resolvedAdditionalSections) {
            if (isSupplementalSkillsSection(section)) {
              const values = supplementalSkillValues(section);
              if (values.length) {
                supplementalSkills.push(...values);
                additionalRefMap.set(section.id, "skills");
                continue;
              }
            }
            const educationLabel = supplementalEducationLabel(section.title);
            if (educationLabel) {
              const detail = section.items
                .map(compactAdditionalItemText)
                .filter(Boolean)
                .join(" · ");
              if (detail) {
                supplementalEducation.push({
                  school: educationLabel,
                  degree: detail,
                  year: "",
                });
              }
              additionalRefMap.set(section.id, "education");
              continue;
            }
            const kind = canonicalAdditionalKind(section);
            if (kind === "custom") {
              // Optimize-for-role has a closed system schema. Unknown source
              // extras remain available in the verified source document, but
              // do not create an ambiguous Additional Information section.
              additionalRefMap.set(section.id, null);
              continue;
            }
            const existing = grouped.get(kind);
            const canonicalId = existing?.id ?? section.id;
            additionalRefMap.set(
              section.id,
              `additional:${canonicalId}`,
            );
            if (existing) {
              existing.items.push(...section.items);
              continue;
            }
            grouped.set(kind, {
              ...section,
              kind,
              title: labels[kind],
              items: [...section.items],
            });
          }
          return [...grouped.values()];
        })()
      : resolvedAdditionalSections;

  const preferredSectionOrder = (
    optimization?.sectionOrder ?? resume.sectionOrder
  )?.flatMap((ref) => {
    if (!ref.startsWith("additional:") || additionalRefMap.size === 0) {
      return [ref];
    }
    const sourceId = ref.slice("additional:".length);
    if (!additionalRefMap.has(sourceId)) {
      return [`additional:${sourceId}` as ResumeSectionRef];
    }
    const mapped = additionalRefMap.get(sourceId);
    return mapped ? [mapped] : [];
  });

  const baseEducation = [...(resume.education ?? [])];
  if (supplementalEducation.length > 0) {
    const compactEducationDetails = supplementalEducation
      .map((item) =>
        [item.school, item.degree].filter(Boolean).join(": "),
      )
      .filter(Boolean)
      .join(" · ");
    if (baseEducation.length > 0 && compactEducationDetails) {
      baseEducation[0] = {
        ...baseEducation[0],
        degree: [baseEducation[0].degree, compactEducationDetails]
          .filter(Boolean)
          .join(" · "),
      };
    } else if (compactEducationDetails) {
      baseEducation.push({
        school: "Education details",
        degree: compactEducationDetails,
        year: "",
      });
    }
  }

  const resolvedSkills = dedupeTextValues([
    ...skills,
    ...supplementalSkills,
  ]);
  const resolvedSkillKeys = new Set(
    resolvedSkills.map((skill) =>
      skill.normalize("NFKC").toLocaleLowerCase().trim(),
    ),
  );
  const skillKey = (skill: string) =>
    skill.normalize("NFKC").toLocaleLowerCase().trim();
  // The source's own categories — "Languages:", "Backend:" — are content, not
  // decoration: they are how a reader finds the one skill they came looking
  // for. Optimizing for a role used to drop them and emit an undifferentiated
  // run of forty terms. Keep the labels, reorder inside each one by the
  // optimized ranking, and let anything the rewrite added follow unlabeled
  // rather than be filed under a category that never claimed it.
  const skillRank = new Map(
    resolvedSkills.map((skill, index) => [skillKey(skill), index]),
  );
  const sourceGroups = (resume.skillGroups ?? [])
    .map((group) => ({
      ...group,
      skills: group.skills
        .filter((skill) => resolvedSkillKeys.has(skillKey(skill)))
        .sort(
          (left, right) =>
            (skillRank.get(skillKey(left)) ?? Number.MAX_SAFE_INTEGER) -
            (skillRank.get(skillKey(right)) ?? Number.MAX_SAFE_INTEGER),
        ),
    }))
    .filter((group) => group.skills.length > 0);
  const claimed = new Set(
    sourceGroups.flatMap((group) => group.skills.map(skillKey)),
  );
  const unclaimedSkills = resolvedSkills.filter(
    (skill) => !claimed.has(skillKey(skill)),
  );
  const skillGroups =
    sourceGroups.length === 0
      ? []
      : unclaimedSkills.length > 0
        ? [...sourceGroups, { label: "", skills: unclaimedSkills }]
        : sourceGroups;
  const sectionLabels = optimization?.sectionLabels ?? resume.sectionLabels ?? {};
  const experienceGroups = resolveExperienceGroups(
    resume.experienceGroups,
    experience,
    sectionLabels.experience ?? "Experience",
  );

  const base = {
    summary,
    skills: resolvedSkills,
    skillGroups,
    experience,
    experienceGroups,
    projects,
    education: baseEducation,
    // Chunked parsing can leave a section heading whose content landed in a
    // different chunk. An empty section renders nothing, so it must not
    // reach the integrity manifest (or any template) as an expectation.
    additionalSections: additionalSections.filter(
      (section) => section.items.length > 0,
    ),
  };

  return {
    name: resume.name,
    title,
    email: resume.email,
    phone: resume.phone,
    location: resume.location,
    links: normalizeResumeLinks(resume.links),
    photo: resume.photo,
    language: detectResumeLanguage(resume),
    ...base,
    sectionLabels,
    sectionOrder: resolveSectionOrder(
      preferredSectionOrder,
      base,
    ),
  };
}
