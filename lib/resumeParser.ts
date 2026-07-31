// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type {
  Resume,
  ResumeAdditionalItem,
  ResumeAdditionalSection,
  ResumeAdditionalSectionKind,
  ResumeBullet,
  ResumeEducation,
  ResumeProject,
  ResumeRole,
  ResumeSectionRef,
  ResumeSkillGroup,
} from "./types";

const CORE_REFS = new Set<ResumeSectionRef>([
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function bullets(value: unknown): ResumeBullet[] {
  return array(value)
    .map((raw, index) => {
      const item = record(raw);
      return {
        id: text(item.id) || `b-${index + 1}`,
        text: text(item.text),
      };
    })
    .filter((item) => item.text);
}

function roles(value: unknown): ResumeRole[] {
  return array(value).map((raw, index) => {
    const item = record(raw);
    return {
      id: text(item.id) || `r-${index + 1}`,
      company: text(item.company),
      title: text(item.title),
      location: text(item.location),
      start: text(item.start),
      end: text(item.end),
      techStack: text(item.techStack),
      bullets: bullets(item.bullets),
    };
  });
}

function projects(value: unknown): ResumeProject[] {
  return array(value).map((raw, index) => {
    const item = record(raw);
    return {
      id: text(item.id) || `p-${index + 1}`,
      name: text(item.name),
      role: text(item.role),
      location: text(item.location),
      start: text(item.start),
      end: text(item.end),
      bullets: bullets(item.bullets),
    };
  });
}

function skillGroups(value: unknown): ResumeSkillGroup[] {
  return array(value)
    .map((raw) => {
      const item = record(raw);
      return {
        label: text(item.label),
        skills: array(item.skills).map(text).filter(Boolean),
      };
    })
    .filter((group) => group.label && group.skills.length > 0);
}

function education(value: unknown): ResumeEducation[] {
  return array(value).map((raw) => {
    const item = record(raw);
    return {
      school: text(item.school),
      degree: text(item.degree),
      year: text(item.year),
    };
  });
}

const ADDITIONAL_KINDS = new Set<ResumeAdditionalSectionKind>([
  "awards",
  "certifications",
  "publications",
  "languages",
  "volunteering",
  "custom",
]);

function additionalItems(value: unknown): ResumeAdditionalItem[] {
  return array(value).map((raw, index) => {
    const item = record(raw);
    return {
      id: text(item.id) || `ai-${index + 1}`,
      heading: text(item.heading),
      subheading: text(item.subheading),
      location: text(item.location),
      start: text(item.start),
      end: text(item.end),
      bullets: bullets(item.bullets),
    };
  });
}

function additionalSections(value: unknown): ResumeAdditionalSection[] {
  return array(value).map((raw, index) => {
    const item = record(raw);
    const kindValue = text(item.kind) as ResumeAdditionalSectionKind;
    return {
      id: text(item.id) || `extra-${index + 1}`,
      kind: ADDITIONAL_KINDS.has(kindValue) ? kindValue : "custom",
      title: text(item.title),
      items: additionalItems(item.items),
    };
  });
}

function sectionOrder(value: unknown): ResumeSectionRef[] {
  return array(value)
    .map(text)
    .filter(
      (ref): ref is ResumeSectionRef =>
        CORE_REFS.has(ref as ResumeSectionRef) ||
        ref.startsWith("additional:"),
    );
}

export function normalizeParsedResume(value: unknown): Resume {
  const input = record(value);
  const language = text(input.language);
  return {
    name: text(input.name),
    title: text(input.title),
    email: text(input.email),
    phone: text(input.phone),
    location: text(input.location),
    links: array(input.links).map(text).filter(Boolean),
    summary: text(input.summary),
    skills: array(input.skills).map(text).filter(Boolean),
    skillGroups: skillGroups(input.skillGroups),
    experience: roles(input.experience),
    projects: projects(input.projects),
    education: education(input.education),
    language: language === "en" ? "en" : undefined,
    sectionOrder: sectionOrder(input.sectionOrder),
    additionalSections: additionalSections(input.additionalSections),
  };
}

function normalizedKey(parts: string[]): string {
  return parts
    .join("|")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mergeBullets(target: ResumeBullet[], incoming: ResumeBullet[]) {
  const seen = new Set(target.map((bullet) => normalizedKey([bullet.text])));
  for (const bullet of incoming) {
    const key = normalizedKey([bullet.text]);
    if (!key || seen.has(key)) continue;
    target.push(bullet);
    seen.add(key);
  }
}

export function mergeParsedResumes(parts: Resume[]): Resume {
  const merged: Resume = {
    name: "",
    title: "",
    email: "",
    phone: "",
    location: "",
    links: [],
    summary: "",
    skills: [],
    skillGroups: [],
    experience: [],
    projects: [],
    education: [],
    additionalSections: [],
    sectionOrder: [],
  };

  const order: string[] = [];
  const pushOrder = (ref: string) => {
    if (!order.includes(ref)) order.push(ref);
  };

  for (const part of parts) {
    for (const key of [
      "name",
      "title",
      "email",
      "phone",
      "location",
      "summary",
    ] as const) {
      if (!merged[key] && part[key]) merged[key] = part[key];
    }
    if (!merged.language && part.language) merged.language = part.language;

    const linkKeys = new Set(
      merged.links!.map((link) => link.toLocaleLowerCase()),
    );
    for (const link of part.links ?? []) {
      const key = link.toLocaleLowerCase();
      if (!linkKeys.has(key)) {
        merged.links!.push(link);
        linkKeys.add(key);
      }
    }

    const skillKeys = new Set(
      merged.skills.map((skill) => skill.toLocaleLowerCase()),
    );
    for (const skill of part.skills) {
      const key = skill.toLocaleLowerCase();
      if (!skillKeys.has(key)) {
        merged.skills.push(skill);
        skillKeys.add(key);
      }
    }

    for (const group of part.skillGroups ?? []) {
      const groupKey = group.label.toLocaleLowerCase();
      let target = merged.skillGroups!.find(
        (candidate) => candidate.label.toLocaleLowerCase() === groupKey,
      );
      if (!target) {
        target = { label: group.label, skills: [] };
        merged.skillGroups!.push(target);
      }
      const groupSkillKeys = new Set(
        target.skills.map((skill) => skill.toLocaleLowerCase()),
      );
      for (const skill of group.skills) {
        const key = skill.toLocaleLowerCase();
        if (!groupSkillKeys.has(key)) {
          target.skills.push(skill);
          groupSkillKeys.add(key);
        }
      }
    }

    for (const role of part.experience) {
      const key = normalizedKey([
        role.company,
        role.title,
        role.start,
        role.end,
      ]);
      const existing = merged.experience.find(
        (candidate) =>
          normalizedKey([
            candidate.company,
            candidate.title,
            candidate.start,
            candidate.end,
          ]) === key,
      );
      if (existing && key) {
        mergeBullets(existing.bullets, role.bullets);
        if (!existing.techStack && role.techStack) {
          existing.techStack = role.techStack;
        }
      } else {
        merged.experience.push({ ...role, bullets: [...role.bullets] });
      }
    }

    for (const project of part.projects ?? []) {
      const key = normalizedKey([
        project.name,
        project.role,
        project.start,
        project.end,
      ]);
      const existing = merged.projects.find(
        (candidate) =>
          normalizedKey([
            candidate.name,
            candidate.role,
            candidate.start,
            candidate.end,
          ]) === key,
      );
      if (existing && key) mergeBullets(existing.bullets, project.bullets);
      else merged.projects.push({ ...project, bullets: [...project.bullets] });
    }

    for (const item of part.education) {
      const key = normalizedKey([item.school, item.degree, item.year]);
      if (
        !merged.education.some(
          (candidate) =>
            normalizedKey([
              candidate.school,
              candidate.degree,
              candidate.year,
            ]) === key,
        )
      ) {
        merged.education.push(item);
      }
    }

    for (const section of part.additionalSections ?? []) {
      const sectionKey = normalizedKey([section.kind, section.title]);
      let target = merged.additionalSections!.find(
        (candidate) =>
          normalizedKey([candidate.kind, candidate.title]) === sectionKey,
      );
      if (!target) {
        target = { ...section, items: [] };
        merged.additionalSections!.push(target);
      }
      for (const item of section.items) {
        const itemKey = normalizedKey([
          item.heading,
          item.subheading,
          item.start,
          item.end,
          ...item.bullets.map((bullet) => bullet.text),
        ]);
        if (
          !target.items.some(
            (candidate) =>
              normalizedKey([
                candidate.heading,
                candidate.subheading,
                candidate.start,
                candidate.end,
                ...candidate.bullets.map((bullet) => bullet.text),
              ]) === itemKey,
          )
        ) {
          target.items.push({ ...item, bullets: [...item.bullets] });
        }
      }
    }

    for (const ref of part.sectionOrder ?? []) {
      if (ref.startsWith("additional:")) {
        const sourceId = ref.slice("additional:".length);
        const source = part.additionalSections?.find(
          (section) => section.id === sourceId,
        );
        if (source) {
          const target = merged.additionalSections!.find(
            (section) =>
              normalizedKey([section.kind, section.title]) ===
              normalizedKey([source.kind, source.title]),
          );
          if (target) {
            pushOrder(
              `additional-key:${normalizedKey([target.kind, target.title])}`,
            );
          }
        }
      } else {
        pushOrder(ref);
      }
    }
  }

  // Cross-section dedupe: chunked parsing sometimes emits the same employment
  // roles both as experience entries and inside an additional section (e.g. a
  // source resume with a separate "Professional Experience" heading). Bullets
  // are parsed verbatim, so an additional item whose bullets all already
  // exist in experience/projects is a duplicate — experience wins.
  const deliveredBullets = new Set<string>();
  for (const role of merged.experience) {
    for (const bullet of role.bullets) {
      deliveredBullets.add(normalizedKey([bullet.text]));
    }
  }
  for (const project of merged.projects) {
    for (const bullet of project.bullets) {
      deliveredBullets.add(normalizedKey([bullet.text]));
    }
  }
  merged.additionalSections = merged.additionalSections!
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.bullets.length === 0 ||
          !item.bullets.every((bullet) =>
            deliveredBullets.has(normalizedKey([bullet.text])),
          ),
      ),
    }))
    .filter((section) => section.items.length > 0);

  // Stable IDs are assigned after merging so optimization/evidence references
  // do not depend on how the source text happened to be chunked.
  let bulletIndex = 1;
  merged.experience = merged.experience.map((role, roleIndex) => ({
    ...role,
    id: `r${roleIndex + 1}`,
    bullets: role.bullets.map((bullet) => ({
      ...bullet,
      id: `b${bulletIndex++}`,
    })),
  }));
  merged.projects = merged.projects.map((project, projectIndex) => ({
    ...project,
    id: `p${projectIndex + 1}`,
    bullets: project.bullets.map((bullet) => ({
      ...bullet,
      id: `b${bulletIndex++}`,
    })),
  }));
  merged.additionalSections = (merged.additionalSections ?? []).map(
    (section, sectionIndex) => ({
      ...section,
      id: `extra${sectionIndex + 1}`,
      items: section.items.map((item, itemIndex) => ({
        ...item,
        id: `extra${sectionIndex + 1}-item${itemIndex + 1}`,
        bullets: item.bullets.map((bullet) => ({
          ...bullet,
          id: `b${bulletIndex++}`,
        })),
      })),
    }),
  );

  const remappedOrder: ResumeSectionRef[] = [];
  for (const ref of order) {
    if (!ref.startsWith("additional-key:")) {
      const coreRef = ref as ResumeSectionRef;
      if (!remappedOrder.includes(coreRef)) remappedOrder.push(coreRef);
      continue;
    }
    const key = ref.slice("additional-key:".length);
    const section = merged.additionalSections.find(
      (candidate) =>
        normalizedKey([candidate.kind, candidate.title]) === key,
    );
    if (section) {
      const stableRef = `additional:${section.id}` as const;
      if (!remappedOrder.includes(stableRef)) remappedOrder.push(stableRef);
    }
  }
  for (const section of merged.additionalSections) {
    const stableRef = `additional:${section.id}` as const;
    if (!remappedOrder.includes(stableRef)) remappedOrder.push(stableRef);
  }
  merged.sectionOrder = remappedOrder;
  return merged;
}

/**
 * Split without discarding any input. Page/paragraph boundaries are preferred
 * so a heading and its content are less likely to land in different prompts.
 */
export function splitResumeText(
  source: string,
  maxChars = 10_000,
): string[] {
  const textValue = source.trim();
  if (!textValue) return [];
  if (textValue.length <= maxChars) return [textValue];

  const blocks = textValue
    .split(/(?:\f+|\n{2,})/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const block of blocks) {
    if (block.length > maxChars) {
      flush();
      for (let start = 0; start < block.length; start += maxChars) {
        chunks.push(block.slice(start, start + maxChars));
      }
      continue;
    }
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > maxChars) flush();
    current = current ? `${current}\n\n${block}` : block;
  }
  flush();
  return chunks;
}
