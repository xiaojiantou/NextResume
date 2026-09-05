// Copyright (c) 2026 HowBe LLC. All rights reserved.

import {
  mergeResumeLinks,
  normalizeResumeLinks,
} from "./resumeLinks.ts";
import type {
  Resume,
  ResumeAdditionalItem,
  ResumeAdditionalSection,
  ResumeAdditionalSectionKind,
  ResumeBullet,
  CoreResumeSection,
  ResumeEducation,
  ResumeExperienceGroup,
  ResumeProject,
  ResumeRole,
  ResumeSectionRef,
  ResumeSkillGroup,
  ResumeSourceLayout,
  ResumeStructureManifest,
  ResumeTeam,
  ResumeVisualLayoutGuide,
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

function locationText(value: unknown): string {
  const location = text(value);
  if (!location) return "";
  if (location.length > 72) return "";
  if (/[:;•|]/.test(location)) return "";
  if ((location.match(/·/g) ?? []).length > 0) return "";
  if (/\b(?:LLC|Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|GmbH)\b/i.test(location)) {
    return "";
  }
  if (
    /\b(?:founder|ceo|cto|engineer|manager|director|product|platform|powered|compliance|resume|tailoring|optimization)\b/i.test(
      location,
    )
  ) {
    return "";
  }
  return location;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function bullets(value: unknown, fallbackPrefix = "b"): ResumeBullet[] {
  return array(value)
    .map((raw, index) => {
      const item = record(raw);
      return {
        id: text(item.id) || `${fallbackPrefix}-${index + 1}`,
        text: text(item.text),
      };
    })
    .filter((item) => item.text);
}

type ParsedRoleTeam = ResumeTeam & { bullets: ResumeBullet[] };

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function roleTeams(value: unknown): ParsedRoleTeam[] {
  return array(value)
    .map((raw, index) => {
      const item = record(raw);
      const teamBullets = bullets(item.bullets, `team-${index + 1}-bullet`);
      return {
        id: text(item.id) || `team-${index + 1}`,
        name: text(item.name) || text(item.team) || text(item.heading),
        title: text(item.title),
        location: locationText(item.location),
        start: text(item.start),
        end: text(item.end),
        bulletIds: uniqueText([
          ...array(item.bulletIds).map(text),
          ...teamBullets.map((bullet) => bullet.id),
        ]),
        bullets: teamBullets,
      };
    })
    .filter(
      (team) =>
        team.name ||
        team.title ||
        team.location ||
        team.start ||
        team.end ||
        team.bulletIds.length > 0,
    );
}

const MONTH_PATTERN =
  "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const DATE_PATTERN = `(?:(?:${MONTH_PATTERN}\\s+)?\\d{4}|\\d{1,2}/\\d{4})`;
const TRAILING_DATE_RANGE = new RegExp(
  `[\\s(|,]*(${DATE_PATTERN})\\s*(?:-|–|—|to)\\s*(${DATE_PATTERN}|Present|Current|Now|Ongoing)\\)?\\s*$`,
  "i",
);
const SUB_BULLET_MARKER = /^\s*[-–—•·▪◦*]\s+/u;

/**
 * A model sometimes flattens a nested entry inside a company — a project or
 * product with its own date range followed by dash-prefixed sub-bullets —
 * into the role's achievement list. Rebuild those entries as teams so the
 * heading line is never rendered as an achievement.
 */
function recoverInlineTeams(
  directBullets: ResumeBullet[],
  idPrefix: string,
): { bullets: ResumeBullet[]; teams: ParsedRoleTeam[] } {
  const isHeading = (bullet: ResumeBullet, next: ResumeBullet | undefined) => {
    if (SUB_BULLET_MARKER.test(bullet.text)) return false;
    const match = bullet.text.match(TRAILING_DATE_RANGE);
    if (!match || match.index === undefined || match.index === 0) return false;
    return (
      bullet.text.includes(":") ||
      (next !== undefined && SUB_BULLET_MARKER.test(next.text))
    );
  };
  if (!directBullets.some((bullet, i) => isHeading(bullet, directBullets[i + 1]))) {
    return { bullets: directBullets, teams: [] };
  }

  const bullets: ResumeBullet[] = [];
  const teams: ParsedRoleTeam[] = [];
  let current: ParsedRoleTeam | null = null;
  directBullets.forEach((bullet, i) => {
    if (isHeading(bullet, directBullets[i + 1])) {
      const match = bullet.text.match(TRAILING_DATE_RANGE)!;
      const heading = bullet.text.slice(0, match.index).replace(/[\s|,(–—-]+$/u, "").trim();
      const colon = heading.indexOf(":");
      const name = colon > 0 ? heading.slice(0, colon).trim() : heading;
      const title = colon > 0 ? heading.slice(colon + 1).trim() : "";
      current = {
        id: `${idPrefix}-inline-team-${teams.length + 1}`,
        name,
        title,
        location: "",
        start: match[1].trim(),
        end: match[2].trim(),
        bulletIds: [],
        bullets: [],
      };
      teams.push(current);
      return;
    }
    const cleaned = current
      ? { ...bullet, text: bullet.text.replace(SUB_BULLET_MARKER, "").trim() }
      : bullet;
    if (!cleaned.text) return;
    bullets.push(cleaned);
    if (current) {
      current.bulletIds.push(cleaned.id);
      current.bullets.push(cleaned);
    }
  });
  return { bullets, teams: teams.filter((team) => team.bulletIds.length > 0) };
}

function roles(value: unknown): ResumeRole[] {
  return array(value).map((raw, index) => {
    const item = record(raw);
    const recovered = recoverInlineTeams(
      bullets(item.bullets, `role-${index + 1}-bullet`),
      `role-${index + 1}`,
    );
    const directBullets = recovered.bullets;
    const parsedTeams = [...recovered.teams, ...roleTeams(item.teams)];
    const allBullets = [...directBullets];
    const seenBulletIds = new Set(allBullets.map((bullet) => bullet.id));
    for (const team of parsedTeams) {
      for (const bullet of team.bullets) {
        if (seenBulletIds.has(bullet.id)) continue;
        allBullets.push(bullet);
        seenBulletIds.add(bullet.id);
      }
    }
    const teams = parsedTeams
      .map(({ bullets: _bullets, ...team }) => ({
        ...team,
        bulletIds: team.bulletIds.filter((id) => seenBulletIds.has(id)),
      }))
      .filter(
        (team) =>
          team.name ||
          team.title ||
          team.location ||
          team.start ||
          team.end ||
          team.bulletIds.length > 0,
      );
    return {
      id: text(item.id) || `r-${index + 1}`,
      company: text(item.company),
      title: text(item.title),
      location: locationText(item.location),
      start: text(item.start),
      end: text(item.end),
      techStack: text(item.techStack),
      bullets: allBullets,
      ...(teams.length > 0 ? { teams } : {}),
    };
  });
}

function experienceGroups(value: unknown): ResumeExperienceGroup[] {
  return array(value)
    .map((raw, index) => {
      const item = record(raw);
      return {
        id: text(item.id) || `experience-group-${index + 1}`,
        title: text(item.title) || text(item.heading) || text(item.label),
        roleIds: uniqueText(array(item.roleIds).map(text)),
      };
    })
    .filter((group) => group.title && group.roleIds.length > 0);
}

const EXPERIENCE_HEADING = new RegExp(
  "^(?:[A-Za-z&/,-]+\\s+){0,3}(?:experience|employment|internships?|history)\\s*:?$",
  "i",
);

const normalizedText = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();

/**
 * The model is asked to report multiple employment headings ("Professional
 * Experience" followed by "Earlier Experience") as experienceGroups, but it
 * often flattens them into one list. The headings are still visible in the
 * source text, so locate them there and file each role under the last heading
 * that precedes its company name. Only replaces what the model returned when
 * the text shows more headings than the model did.
 */
export function recoverExperienceGroupsFromText(
  resume: Resume,
  sourceText: string,
): Resume {
  const lines = sourceText.split(/\r?\n/u);
  const headings: Array<{ title: string; position: number }> = [];
  let offset = 0;
  const normalizedLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalizedLine = normalizedText(line);
    normalizedLines.push(normalizedLine);
    if (
      line.length > 0 &&
      line.length <= 48 &&
      !/\d/.test(line) &&
      !/^[-–—•·▪◦*]/.test(line) &&
      EXPERIENCE_HEADING.test(line)
    ) {
      headings.push({ title: line.replace(/:$/, "").trim(), position: offset });
    }
    offset += normalizedLine.length + 1;
  }
  if (headings.length < 2) return resume;

  const haystack = normalizedLines.join("\n");
  let cursor = 0;
  const positions = resume.experience.map((role) => {
    for (const needle of [role.company, role.title].map(normalizedText)) {
      if (needle.length < 3) continue;
      const found = haystack.indexOf(needle, cursor);
      const index = found >= 0 ? found : haystack.indexOf(needle);
      if (index >= 0) {
        cursor = Math.max(cursor, index);
        return index;
      }
    }
    return -1;
  });

  const fallbackTitle = resume.sectionLabels?.experience ?? "Experience";
  const buckets: Array<{ title: string; roleIds: string[] }> = [];
  let previous: { title: string; roleIds: string[] } | null = null;
  resume.experience.forEach((role, index) => {
    const position = positions[index];
    let title: string;
    if (position < 0) {
      title = previous?.title ?? fallbackTitle;
    } else {
      const heading = [...headings]
        .reverse()
        .find((candidate) => candidate.position < position);
      title = heading?.title ?? fallbackTitle;
    }
    if (previous && normalizedText(previous.title) === normalizedText(title)) {
      previous.roleIds.push(role.id);
    } else {
      previous = { title, roleIds: [role.id] };
      buckets.push(previous);
    }
  });
  if (buckets.length < 2 || buckets.length <= (resume.experienceGroups?.length ?? 0)) {
    return resume;
  }
  return {
    ...resume,
    experienceGroups: buckets.map((bucket, index) => ({
      id: `eg${index + 1}`,
      title: bucket.title,
      roleIds: bucket.roleIds,
    })),
  };
}

function projects(value: unknown): ResumeProject[] {
  return array(value).map((raw, index) => {
    const item = record(raw);
    return {
      id: text(item.id) || `p-${index + 1}`,
      name: text(item.name),
      role: text(item.role),
      location: locationText(item.location),
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
      location: locationText(item.location),
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

function sectionLabels(
  value: unknown,
): Partial<Record<CoreResumeSection, string>> {
  const input = record(value);
  const labels: Partial<Record<CoreResumeSection, string>> = {};
  for (const ref of CORE_REFS) {
    const key = ref as CoreResumeSection;
    const label = text(input[key]);
    if (label) labels[key] = label;
  }
  return labels;
}

export function normalizeParsedResume(value: unknown): Resume {
  const input = record(value);
  const language = text(input.language);
  return {
    name: text(input.name),
    title: text(input.title),
    email: text(input.email),
    phone: text(input.phone),
    location: locationText(input.location),
    links: normalizeResumeLinks(input.links),
    summary: text(input.summary),
    skills: array(input.skills).map(text).filter(Boolean),
    skillGroups: skillGroups(input.skillGroups),
    experience: roles(input.experience),
    experienceGroups: experienceGroups(input.experienceGroups),
    projects: projects(input.projects),
    education: education(input.education),
    language: language === "en" ? "en" : undefined,
    sectionOrder: sectionOrder(input.sectionOrder),
    sectionLabels: sectionLabels(input.sectionLabels),
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

function mergeBullets(
  target: ResumeBullet[],
  incoming: ResumeBullet[],
): Map<string, string> {
  const seen = new Map(
    target.map((bullet) => [normalizedKey([bullet.text]), bullet.id]),
  );
  const idMap = new Map<string, string>();
  for (const bullet of incoming) {
    const key = normalizedKey([bullet.text]);
    if (!key) continue;
    const existingId = seen.get(key);
    if (existingId) {
      idMap.set(bullet.id, existingId);
      continue;
    }
    target.push(bullet);
    seen.set(key, bullet.id);
    idMap.set(bullet.id, bullet.id);
  }
  return idMap;
}

function cloneRoleTeams(role: ResumeRole): ResumeTeam[] {
  return (role.teams ?? []).map((team) => ({
    ...team,
    bulletIds: [...team.bulletIds],
  }));
}

function mergeRoleTeams(
  target: ResumeRole,
  incoming: ResumeRole,
  bulletIdMap: Map<string, string>,
) {
  const knownBulletIds = new Set(target.bullets.map((bullet) => bullet.id));
  const remapBulletIds = (ids: string[]) =>
    uniqueText(ids.map((id) => bulletIdMap.get(id) ?? id)).filter((id) =>
      knownBulletIds.has(id),
    );

  for (const team of incoming.teams ?? []) {
    const key = normalizedKey([
      team.name,
      team.title,
      team.location,
      team.start,
      team.end,
    ]);
    const nextBulletIds = remapBulletIds(team.bulletIds);
    const existing = (target.teams ?? []).find(
      (candidate) =>
        normalizedKey([
          candidate.name,
          candidate.title,
          candidate.location,
          candidate.start,
          candidate.end,
        ]) === key,
    );
    if (existing && key) {
      existing.bulletIds = uniqueText([
        ...existing.bulletIds,
        ...nextBulletIds,
      ]);
      continue;
    }
    target.teams = [
      ...(target.teams ?? []),
      {
        ...team,
        bulletIds: nextBulletIds,
      },
    ];
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
    experienceGroups: [],
    projects: [],
    education: [],
    additionalSections: [],
    sectionOrder: [],
    sectionLabels: {},
  };

  const order: string[] = [];
  const pushOrder = (ref: string) => {
    if (!order.includes(ref)) order.push(ref);
  };
  const pendingExperienceGroups: Array<{
    title: string;
    roles: ResumeRole[];
  }> = [];
  const pushExperienceGroup = (title: string, roles: ResumeRole[]) => {
    const cleanTitle = title.trim();
    const uniqueRoles = roles.filter(
      (role, index) => roles.indexOf(role) === index,
    );
    if (!cleanTitle || uniqueRoles.length === 0) return;
    const last = pendingExperienceGroups[pendingExperienceGroups.length - 1];
    if (last && normalizedKey([last.title]) === normalizedKey([cleanTitle])) {
      for (const role of uniqueRoles) {
        if (!last.roles.includes(role)) last.roles.push(role);
      }
      return;
    }
    pendingExperienceGroups.push({ title: cleanTitle, roles: uniqueRoles });
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
    for (const [ref, label] of Object.entries(part.sectionLabels ?? {})) {
      const key = ref as CoreResumeSection;
      if (!merged.sectionLabels?.[key] && label) {
        merged.sectionLabels = { ...merged.sectionLabels, [key]: label };
      }
    }

    // A later chunk may carry the target for a label an earlier chunk saw
    // without one, so merging is by link identity rather than by string.
    merged.links = mergeResumeLinks(merged.links ?? [], part.links ?? []);

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

    const partRolesById = new Map<string, ResumeRole>();
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
        const bulletIdMap = mergeBullets(existing.bullets, role.bullets);
        mergeRoleTeams(existing, role, bulletIdMap);
        if (!existing.techStack && role.techStack) {
          existing.techStack = role.techStack;
        }
        partRolesById.set(role.id, existing);
      } else {
        const inserted = {
          ...role,
          bullets: [...role.bullets],
          ...(role.teams?.length ? { teams: cloneRoleTeams(role) } : {}),
        };
        merged.experience.push(inserted);
        partRolesById.set(role.id, inserted);
      }
    }
    const explicitGroups = part.experienceGroups ?? [];
    const groupedSourceRoleIds = new Set<string>();
    for (const group of explicitGroups) {
      const groupRoles = group.roleIds
        .map((id) => {
          groupedSourceRoleIds.add(id);
          return partRolesById.get(id);
        })
        .filter((role): role is ResumeRole => Boolean(role));
      pushExperienceGroup(group.title, groupRoles);
    }
    const ungroupedPartRoles = part.experience
      .filter((role) => !groupedSourceRoleIds.has(role.id))
      .map((role) => partRolesById.get(role.id))
      .filter((role): role is ResumeRole => Boolean(role));
    if (ungroupedPartRoles.length > 0) {
      pushExperienceGroup(part.sectionLabels?.experience ?? "", ungroupedPartRoles);
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
  const roleRefToStableId = new Map<ResumeRole, string>();
  merged.experience = merged.experience.map((role, roleIndex) => {
    const roleId = `r${roleIndex + 1}`;
    roleRefToStableId.set(role, roleId);
    const bulletIdMap = new Map<string, string>();
    const bullets = role.bullets.map((bullet) => {
      const id = `b${bulletIndex++}`;
      bulletIdMap.set(bullet.id, id);
      return { ...bullet, id };
    });
    const teams = (role.teams ?? [])
      .map((team, teamIndex) => ({
        ...team,
        id: `${roleId}-team${teamIndex + 1}`,
        bulletIds: uniqueText(
          team.bulletIds
            .map((id) => bulletIdMap.get(id))
            .filter((id): id is string => Boolean(id)),
        ),
      }))
      .filter(
        (team) =>
          team.name ||
          team.title ||
          team.location ||
          team.start ||
          team.end ||
          team.bulletIds.length > 0,
      );
    const { teams: _teams, ...roleRest } = role;
    return {
      ...roleRest,
      id: roleId,
      bullets,
      ...(teams.length > 0 ? { teams } : {}),
    };
  });
  const stableExperienceGroups = pendingExperienceGroups
    .map((group, sourceIndex) => ({
      title: group.title,
      sourceIndex,
      roleIds: uniqueText(
        group.roles
          .map((role) => roleRefToStableId.get(role))
          .filter((id): id is string => Boolean(id)),
      ),
    }))
    .filter((group) => group.title && group.roleIds.length > 0);
  const experienceGroupByRoleId = new Map<
    string,
    { title: string; sourceIndex: number }
  >();
  for (const group of stableExperienceGroups) {
    for (const roleId of group.roleIds) {
      if (!experienceGroupByRoleId.has(roleId)) {
        experienceGroupByRoleId.set(roleId, {
          title: group.title,
          sourceIndex: group.sourceIndex,
        });
      }
    }
  }
  const draftExperienceGroups: Array<
    ResumeExperienceGroup & { sourceKey: string }
  > = [];
  for (const role of merged.experience) {
    const sourceGroup = experienceGroupByRoleId.get(role.id);
    const title = sourceGroup?.title ?? "";
    const sourceKey = sourceGroup
      ? `source:${sourceGroup.sourceIndex}`
      : `implicit:${title}`;
    const last = draftExperienceGroups[draftExperienceGroups.length - 1];
    if (last?.sourceKey === sourceKey) {
      last.roleIds.push(role.id);
      continue;
    }
    draftExperienceGroups.push({
      id: "",
      title,
      roleIds: [role.id],
      sourceKey,
    });
  }
  const sectionExperienceLabel = merged.sectionLabels?.experience ?? "";
  const keepsUsefulExperienceGroups =
    draftExperienceGroups.length > 1 ||
    draftExperienceGroups.some(
      (group) =>
        group.title &&
        normalizedKey([group.title]) !== normalizedKey([sectionExperienceLabel]),
    );
  merged.experienceGroups = keepsUsefulExperienceGroups
    ? draftExperienceGroups.map(({ sourceKey: _sourceKey, ...group }, index) => ({
        ...group,
        id: `eg${index + 1}`,
      }))
    : [];
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
  const expectedCore: CoreResumeSection[] = [
    ...(merged.summary ? (["summary"] as const) : []),
    ...(merged.skills.length ? (["skills"] as const) : []),
    ...(merged.experience.length ? (["experience"] as const) : []),
    ...(merged.projects.length ? (["projects"] as const) : []),
    ...(merged.education.length ? (["education"] as const) : []),
  ];
  const structureIssues: string[] = [];
  for (const ref of expectedCore) {
    if (!merged.sectionLabels?.[ref]) {
      structureIssues.push(`Could not confidently detect the original ${ref} heading.`);
    }
    if (!merged.sectionOrder.includes(ref)) {
      structureIssues.push(`Could not confidently place the ${ref} section in reading order.`);
      merged.sectionOrder.push(ref);
    }
  }
  merged.structureConfidence = {
    level: structureIssues.length > 0 ? "low" : "high",
    issues: structureIssues,
  };
  return merged;
}

function manifestHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function coverageTokens(value: string): Set<string> {
  const ignored = new Set(["page", "header", "left", "right", "column"]);
  return new Set(
    (value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}+.@/-]*/gu) ?? [])
      .filter((token) => token.length > 1 && !ignored.has(token)),
  );
}

function detectedOrder(resume: Resume): ResumeSectionRef[] {
  if (resume.sectionOrder?.length) return resume.sectionOrder;
  return [
    ...(resume.summary ? (["summary"] as ResumeSectionRef[]) : []),
    ...(resume.skills.length ? (["skills"] as ResumeSectionRef[]) : []),
    ...(resume.experience.length ? (["experience"] as ResumeSectionRef[]) : []),
    ...(resume.projects?.length ? (["projects"] as ResumeSectionRef[]) : []),
    ...(resume.education.length ? (["education"] as ResumeSectionRef[]) : []),
    ...(resume.additionalSections ?? []).map(
      (section) => `additional:${section.id}` as ResumeSectionRef,
    ),
  ];
}

function manifestSection(
  resume: Resume,
  ref: ResumeSectionRef,
): ResumeStructureManifest["sections"][number] {
  if (ref === "summary") {
    return {
      ref,
      label: resume.sectionLabels?.summary ?? "Summary",
      entryIds: ["summary"],
      bulletIds: [],
    };
  }
  if (ref === "skills") {
    return {
      ref,
      label: resume.sectionLabels?.skills ?? "Skills",
      entryIds: resume.skills.map((_, index) => `skill:${index + 1}`),
      bulletIds: [],
    };
  }
  if (ref === "experience") {
    return {
      ref,
      label: resume.sectionLabels?.experience ?? "Experience",
      entryIds: [
        ...(resume.experienceGroups ?? []).map((group) => group.id),
        ...resume.experience.flatMap((role) => [
          role.id,
          ...(role.teams ?? []).map((team) => team.id),
        ]),
      ],
      bulletIds: resume.experience.flatMap((role) =>
        role.bullets.map((bullet) => bullet.id),
      ),
    };
  }
  if (ref === "projects") {
    return {
      ref,
      label: resume.sectionLabels?.projects ?? "Projects",
      entryIds: (resume.projects ?? []).map((project) => project.id),
      bulletIds: (resume.projects ?? []).flatMap((project) =>
        project.bullets.map((bullet) => bullet.id),
      ),
    };
  }
  if (ref === "education") {
    return {
      ref,
      label: resume.sectionLabels?.education ?? "Education",
      entryIds: resume.education.map((_, index) => `education:${index + 1}`),
      bulletIds: [],
    };
  }
  const id = ref.slice("additional:".length);
  const section = (resume.additionalSections ?? []).find(
    (candidate) => candidate.id === id,
  );
  return {
    ref,
    label: section?.title ?? "Additional section",
    entryIds: section?.items.map((item) => item.id) ?? [],
    bulletIds:
      section?.items.flatMap((item) =>
        item.bullets.map((bullet) => bullet.id),
      ) ?? [],
  };
}

export function attachResumeStructureMetadata({
  resume,
  sourceText,
  layout,
  visualGuide,
}: {
  resume: Resume;
  sourceText: string;
  layout?: ResumeSourceLayout;
  visualGuide?: ResumeVisualLayoutGuide | null;
}): Resume {
  const sourceTokens = coverageTokens(sourceText);
  const parsedTokens = coverageTokens(JSON.stringify(resume));
  const matched = [...sourceTokens].filter((token) => parsedTokens.has(token));
  const coverage = sourceTokens.size
    ? Math.round((matched.length / sourceTokens.size) * 1000) / 1000
    : 0;
  const sectionOrder = detectedOrder(resume);
  const layoutValue: ResumeSourceLayout = layout ?? {
    parser: "linear-text",
    pageCount: 1,
    maxColumns: 1,
    pages: [],
    issues: [],
  };
  const issues = [
    ...(resume.structureConfidence?.issues ?? []),
    ...layoutValue.issues,
    ...(visualGuide?.issues ?? []),
    ...(coverage < 0.72
      ? [
          `Only ${Math.round(coverage * 100)}% of unique source tokens were mapped into structured fields.`,
        ]
      : []),
  ];
  const uniqueIssues = [...new Set(issues)];
  return {
    ...resume,
    sectionOrder,
    sourceLayout: {
      ...layoutValue,
      issues: [...new Set([...layoutValue.issues, ...(visualGuide?.issues ?? [])])],
    },
    structureConfidence: {
      level: uniqueIssues.length > 0 ? "low" : "high",
      issues: uniqueIssues,
      coverage,
    },
    structureManifest: {
      version: 1,
      sourceFingerprint: manifestHash(sourceText.normalize("NFKC")),
      parser: layoutValue.parser,
      pageCount: layoutValue.pageCount,
      maxColumns: layoutValue.maxColumns,
      coverage,
      confirmed: uniqueIssues.length === 0,
      sectionOrder,
      sections: sectionOrder.map((ref) => manifestSection(resume, ref)),
    },
  };
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
