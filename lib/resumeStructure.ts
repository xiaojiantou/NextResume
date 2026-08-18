import type {
  ContentStructureMode,
  CoreResumeSection,
  JobAnalysis,
  Optimization,
  OptimizationVariant,
  Resume,
  ResumeSectionRef,
  SkillEvidence,
  StructureIntegrity,
} from "./types";

const OPTIMIZATION_STRUCTURE_VERSION = 2;

const DEFAULT_OPTIMIZED_LABELS: Record<CoreResumeSection, string> = {
  summary: "Professional Summary",
  skills: "Core Skills",
  experience: "Professional Experience",
  projects: "Selected Projects",
  education: "Education",
};

const ALLOWED_OPTIMIZED_LABELS: Record<CoreResumeSection, Set<string>> = {
  summary: new Set(["Summary", "Professional Summary", "Research Profile"]),
  skills: new Set([
    "Skills",
    "Core Skills",
    "Technical Skills",
    "Core Competencies",
  ]),
  experience: new Set([
    "Experience",
    "Professional Experience",
    "Work Experience",
    "Research Experience",
  ]),
  projects: new Set([
    "Projects",
    "Selected Projects",
    "Technical Projects",
    "Research Projects",
  ]),
  education: new Set(["Education", "Academic Background"]),
};

type NumberClaim = {
  raw: string;
  key: string;
  lowerBound: boolean;
};

const NUMBER_PATTERN =
  /[$€£¥]?\d[\d,.]*(?:\s*(?:thousand|million|billion)|[kmb])?(?:%|x|×)?\+?/gi;

const NUMBER_MAGNITUDES: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  billion: 1_000_000_000,
};

function canonicalDecimal(value: number, fallback: string): string {
  if (!Number.isFinite(value)) return fallback;
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toPrecision(12)));
}

function parseNumberClaim(rawValue: string): NumberClaim {
  // Sentence punctuation is never part of a magnitude, and leaving it on made
  // Number("1.5.") NaN, which fell back to the raw string as the key — so the
  // same figure stopped matching itself across a sentence boundary.
  const raw = rawValue.trim().replace(/[.,]+$/, "");
  let value = raw.toLocaleLowerCase().replaceAll(",", "").replaceAll("×", "x");
  const lowerBound = value.endsWith("+");
  if (lowerBound) value = value.slice(0, -1);
  const currency = value.match(/^[$€£¥]/)?.[0] ?? "";
  if (currency) value = value.slice(currency.length);
  const unit = value.endsWith("%")
    ? "%"
    : value.endsWith("x")
      ? "x"
      : "";
  if (unit) value = value.slice(0, -1);
  const magnitudeMatch = value.match(/\s*(thousand|million|billion|[kmb])$/);
  const magnitude = magnitudeMatch?.[1] ?? "";
  if (magnitudeMatch) value = value.slice(0, magnitudeMatch.index).trim();
  const numeric = Number(value);
  const scaled = magnitude
    ? numeric * NUMBER_MAGNITUDES[magnitude]
    : numeric;
  return {
    raw,
    key: `${currency}|${canonicalDecimal(scaled, value)}|${unit}`,
    lowerBound,
  };
}

// Digits glued to letters are names, not quantities: S3, EC2, p99, GPT-4,
// OAuth 2.0. Scoring them as magnitudes broke this both ways — it rejected
// "migrated to S3" as an unsupported "3", with repair feedback the model
// cannot act on, and it let an invented "3 regions" pass whenever the source
// happened to mention S3. Compare those as whole tokens instead.
const IDENT_LEFT = /[A-Za-z0-9.\-]/;
const IDENT_RIGHT = /[A-Za-z0-9]/;
const HAS_LETTER = /[A-Za-z]/;

// Spelled-out counts ground their digit form, so a source saying "three
// engineers" supports a rewrite saying "3 engineers".
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUMBER_WORD_PATTERN = new RegExp(
  `(?<![a-z])(${Object.keys(NUMBER_WORDS).join("|")})(?![a-z])`,
  "gi",
);

export function numberClaims(value: string): NumberClaim[] {
  const claims: NumberClaim[] = [];
  for (const match of value.matchAll(NUMBER_PATTERN)) {
    const matched = match[0];
    const start = match.index ?? 0;
    const end = start + matched.length;

    let left = start;
    while (left > 0 && IDENT_LEFT.test(value[left - 1])) left -= 1;
    let right = end;
    while (right < value.length && IDENT_RIGHT.test(value[right])) right += 1;

    const context = value.slice(left, start) + value.slice(end, right);
    if (HAS_LETTER.test(context)) {
      // Trim punctuation the number pattern swallowed ("S3," -> "S3").
      const token = value.slice(left, right).replace(/[.,]+$/, "");
      claims.push({
        raw: token,
        key: `ident|${token.toLocaleLowerCase()}`,
        lowerBound: false,
      });
      continue;
    }
    claims.push(parseNumberClaim(matched));
  }
  return claims;
}

// Only ever widens what the source supports. Emitting these from the rewrite
// side would reject ordinary prose ("one of the largest teams").
function spelledOutClaims(source: string): NumberClaim[] {
  return [...source.matchAll(NUMBER_WORD_PATTERN)].map((match) =>
    parseNumberClaim(String(NUMBER_WORDS[match[1].toLocaleLowerCase()])),
  );
}

export function unsupportedNumberClaims(
  value: string,
  source: string,
): string[] {
  const available = [...numberClaims(source), ...spelledOutClaims(source)];
  return numberClaims(value)
    .filter(
      (claim) =>
        !available.some(
          (candidate) =>
            candidate.key === claim.key &&
            (!claim.lowerBound || candidate.lowerBound),
        ),
    )
    .map((claim) => claim.raw);
}

export function numbersAreGrounded(value: string, source: string): boolean {
  return unsupportedNumberClaims(value, source).length === 0;
}

function describeUnsupportedNumbers(value: string, source: string): string {
  const unsupported = unsupportedNumberClaims(value, source);
  const available = numberClaims(source).map((claim) => claim.raw);
  return `unsupported ${unsupported.map((claim) => `"${claim}"`).join(", ")}; source evidence has ${
    available.length
      ? available.map((claim) => `"${claim}"`).join(", ")
      : "no numeric claim"
  }`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function smallHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function currentResumeSectionOrder(resume: Resume): ResumeSectionRef[] {
  return resume.sectionOrder?.length
    ? [...resume.sectionOrder]
    : [
        ...(resume.summary ? (["summary"] as ResumeSectionRef[]) : []),
        ...(resume.skills.length ? (["skills"] as ResumeSectionRef[]) : []),
        ...(resume.experience.length
          ? (["experience"] as ResumeSectionRef[])
          : []),
        ...(resume.projects?.length
          ? (["projects"] as ResumeSectionRef[])
          : []),
        ...(resume.education.length
          ? (["education"] as ResumeSectionRef[])
          : []),
        ...(resume.additionalSections ?? []).map(
          (section) => `additional:${section.id}` as ResumeSectionRef,
        ),
      ];
}

function optimizedSectionRefs(
  resume: Resume,
  optimization: Optimization,
): ResumeSectionRef[] {
  return [
    ...(optimization.summary ? (["summary"] as ResumeSectionRef[]) : []),
    ...(optimization.skills.length ? (["skills"] as ResumeSectionRef[]) : []),
    ...(resume.experience.length ? (["experience"] as ResumeSectionRef[]) : []),
    ...(resume.projects?.length ? (["projects"] as ResumeSectionRef[]) : []),
    ...(resume.education.length ? (["education"] as ResumeSectionRef[]) : []),
    ...(resume.additionalSections ?? []).map(
      (section) => `additional:${section.id}` as ResumeSectionRef,
    ),
  ];
}

/**
 * Accept the model's relevance ordering, but keep it within the source schema.
 * Unknown/duplicate refs are discarded and every renderable source section is
 * appended exactly once, so a malformed model response cannot lose content.
 */
export function constrainRoleOptimizedStructure({
  resume,
  candidate,
}: {
  resume: Resume;
  candidate: Optimization;
}): Optimization {
  const available = optimizedSectionRefs(resume, candidate);
  const allowed = new Set<ResumeSectionRef>(available);
  const seen = new Set<ResumeSectionRef>();
  const sectionOrder = [
    ...(candidate.sectionOrder ?? []),
    ...available,
  ].filter((ref): ref is ResumeSectionRef => {
    if (!allowed.has(ref) || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
  const proposedLabels = candidate.sectionLabels ?? {};
  const sectionLabels = Object.fromEntries(
    (Object.keys(DEFAULT_OPTIMIZED_LABELS) as CoreResumeSection[]).map(
      (section) => {
        const proposed = proposedLabels[section]?.trim() ?? "";
        return [
          section,
          ALLOWED_OPTIMIZED_LABELS[section].has(proposed)
            ? proposed
            : DEFAULT_OPTIMIZED_LABELS[section],
        ];
      },
    ),
  ) as Record<CoreResumeSection, string>;
  return { ...candidate, sectionOrder, sectionLabels };
}

export function currentResumeManifestSections(resume: Resume) {
  return currentResumeSectionOrder(resume).map((ref) => {
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
        entryIds: resume.experience.map((role) => role.id),
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
  });
}

export function validateResumeStructureManifest(resume: Resume): string[] {
  const manifest = resume.structureManifest;
  if (!manifest) return [];
  const issues: string[] = [];
  if (!manifest.confirmed) issues.push("The detected structure is not confirmed.");
  const currentOrder = currentResumeSectionOrder(resume);
  if (JSON.stringify(manifest.sectionOrder) !== JSON.stringify(currentOrder)) {
    issues.push("Section order changed after structure confirmation.");
  }
  const currentSections = currentResumeManifestSections(resume);
  if (manifest.sections.length !== currentSections.length) {
    issues.push("Sections were added or removed after structure confirmation.");
  }
  currentSections.forEach((section) => {
    const expected = manifest.sections.find(
      (candidate) => candidate.ref === section.ref,
    );
    if (!expected) {
      issues.push(`Section ${section.ref} is missing from the structure manifest.`);
      return;
    }
    if (expected.label !== section.label) {
      issues.push(`Heading for ${section.ref} changed after structure confirmation.`);
    }
    if (JSON.stringify(expected.entryIds) !== JSON.stringify(section.entryIds)) {
      issues.push(`Entries in ${section.ref} changed after structure confirmation.`);
    }
    if (JSON.stringify(expected.bulletIds) !== JSON.stringify(section.bulletIds)) {
      issues.push(`Bullets in ${section.ref} changed after structure confirmation.`);
    }
  });
  return [...new Set(issues)];
}

export function createOptimizationCacheKey({
  resume,
  job,
  modelId,
  structureMode,
}: {
  resume: Resume;
  job: JobAnalysis;
  modelId: string;
  structureMode: ContentStructureMode;
}): string {
  return smallHash(
    JSON.stringify(
      stableValue({
        resume,
        job,
        modelId,
        structureMode,
        structureVersion: OPTIMIZATION_STRUCTURE_VERSION,
      }),
    ),
  );
}

export function pruneOptimizationVariants(
  variants: OptimizationVariant[],
  limit = 8,
): OptimizationVariant[] {
  const byKey = new Map<string, OptimizationVariant>();
  for (const variant of variants) {
    const existing = byKey.get(variant.cacheKey);
    if (
      !existing ||
      new Date(variant.lastUsedAt).getTime() >
        new Date(existing.lastUsedAt).getTime()
    ) {
      byKey.set(variant.cacheKey, variant);
    }
  }
  return [...byKey.values()]
    .sort(
      (left, right) =>
        new Date(right.lastUsedAt).getTime() -
        new Date(left.lastUsedAt).getTime(),
    )
    .slice(0, limit);
}

export function findOptimizationVariant(
  variants: OptimizationVariant[],
  cacheKey: string,
): OptimizationVariant | null {
  return variants.find((variant) => variant.cacheKey === cacheKey) ?? null;
}

function sameIds(actual: string[], expected: string[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index])
  );
}

function orderedSubset(actual: string[], expected: string[]): boolean {
  let cursor = 0;
  for (const id of actual) {
    const index = expected.indexOf(id, cursor);
    if (index < 0) return false;
    cursor = index + 1;
  }
  return true;
}

function normalizedGroundingText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(
      /[\u00a0\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedSkill(value: string): string {
  return normalizedGroundingText(value);
}

function sourceTextValues(value: unknown): string[] {
  if (typeof value === "string") return [normalizedGroundingText(value)];
  if (Array.isArray(value)) return value.flatMap(sourceTextValues);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(sourceTextValues);
}

function skillIsGrounded(skill: string, sourceTexts: string[]): boolean {
  const normalized = normalizedSkill(skill);
  if (!normalized) return false;
  const compact = normalized.replace(/\s+/g, "");
  return sourceTexts.some(
    (source) =>
      source.includes(normalized) ||
      source.replace(/\s+/g, "").includes(compact),
  );
}

const INDIRECT_SKILL_TYPES = new Set<SkillEvidence["skillType"]>([
  "capability",
  "domain",
  "soft",
]);

function validIndirectSkillEvidence(
  evidence: SkillEvidence | undefined,
  sourceBulletIds: Set<string>,
): SkillEvidence | null {
  if (
    !evidence ||
    evidence.grounding !== "indirect" ||
    !INDIRECT_SKILL_TYPES.has(evidence.skillType) ||
    !evidence.rationale.trim()
  ) {
    return null;
  }
  const sourceIds = [
    ...new Set(evidence.evidence.filter((id) => sourceBulletIds.has(id))),
  ].slice(0, 3);
  if (sourceIds.length === 0) return null;
  return { ...evidence, evidence: sourceIds };
}

export function reconcileGroundedSkills(
  resume: Resume,
  proposedSkills: string[],
  proposedEvidence: SkillEvidence[] = [],
): { skills: string[]; skillEvidence: SkillEvidence[] } {
  const sourceTexts = sourceTextValues(resume);
  const sourceBulletIds = new Set(resumeBulletText(resume).keys());
  const evidenceBySkill = new Map(
    proposedEvidence.map((item) => [normalizedSkill(item.skill), item]),
  );
  const skills: string[] = [];
  const skillEvidence: SkillEvidence[] = [];
  const seen = new Set<string>();
  const add = (skill: string, grounding: SkillEvidence) => {
    const normalized = normalizedSkill(skill);
    if (!normalized || seen.has(normalized)) return;
    const outputSkill = skill.trim();
    skills.push(outputSkill);
    skillEvidence.push({ ...grounding, skill: outputSkill });
    seen.add(normalized);
  };

  for (const skill of proposedSkills) {
    const proposed = evidenceBySkill.get(normalizedSkill(skill));
    if (skillIsGrounded(skill, sourceTexts)) {
      add(skill, {
        skill,
        grounding: "direct",
        skillType: proposed?.skillType ?? "capability",
        evidence: (proposed?.evidence ?? []).filter((id) =>
          sourceBulletIds.has(id),
        ),
        rationale:
          proposed?.rationale.trim() ||
          "Appears explicitly in the source resume.",
      });
      continue;
    }
    const indirect = validIndirectSkillEvidence(proposed, sourceBulletIds);
    if (indirect) add(skill, indirect);
  }
  // Source skills are always safe and must not disappear just because the
  // model selected an unsupported JD keyword instead.
  for (const skill of resume.skills) {
    add(skill, {
      skill,
      grounding: "direct",
      skillType:
        evidenceBySkill.get(normalizedSkill(skill))?.skillType ?? "capability",
      evidence: [],
      rationale: "Listed in the source resume's skills section.",
    });
  }
  return { skills, skillEvidence };
}

export function validateGroundedOptimization(
  resume: Resume,
  optimization: Optimization,
): string[] {
  const issues: string[] = [];
  // PDF text frequently contains non-breaking spaces, line breaks, or
  // zero-width characters. Compare normalized text leaves instead of a raw
  // JSON string so visually identical source skills are not rejected.
  const sourceTexts = sourceTextValues(resume);
  const sourceBulletIds = new Set(resumeBulletText(resume).keys());
  const evidenceBySkill = new Map(
    (optimization.skillEvidence ?? []).map((item) => [
      normalizedSkill(item.skill),
      item,
    ]),
  );
  if (!numbersAreGrounded(optimization.summary, JSON.stringify(resume))) {
    issues.push(
      `The summary introduces an unsupported number: ${describeUnsupportedNumbers(optimization.summary, JSON.stringify(resume))}.`,
    );
  }
  if (!numbersAreGrounded(optimization.title, JSON.stringify(resume))) {
    issues.push(
      `The professional title introduces an unsupported number: ${describeUnsupportedNumbers(optimization.title, JSON.stringify(resume))}.`,
    );
  }
  for (const skill of optimization.skills) {
    if (skillIsGrounded(skill, sourceTexts)) continue;
    const evidence = evidenceBySkill.get(normalizedSkill(skill));
    if (!validIndirectSkillEvidence(evidence, sourceBulletIds)) {
      issues.push(`Skill "${skill}" is not grounded in the source resume.`);
    }
  }
  if (
    !sameIds(
      optimization.roles.map((role) => role.id),
      resume.experience.map((role) => role.id),
    )
  ) {
    issues.push("Work roles were added, removed, or reordered.");
  }
  if (
    !sameIds(
      optimization.projects.map((project) => project.id),
      (resume.projects ?? []).map((project) => project.id),
    )
  ) {
    issues.push("Projects were added, removed, or reordered.");
  }

  const returnedBulletIds = new Set<string>();
  const validateBullets = (
    ownerLabel: string,
    sourceBullets: Resume["experience"][number]["bullets"],
    bullets: Optimization["roles"][number]["bullets"],
  ) => {
    const sourceById = new Map(
      sourceBullets.map((bullet) => [bullet.id, bullet.text]),
    );
    for (const bullet of bullets) {
      if (!bullet.id || returnedBulletIds.has(bullet.id)) {
        issues.push(`Bullet id ${bullet.id || "(empty)"} is missing or duplicated.`);
      }
      returnedBulletIds.add(bullet.id);
      if (!bullet.text.trim()) issues.push(`${ownerLabel} contains an empty bullet.`);
      if (
        bullet.evidence.length === 0 ||
        bullet.evidence.some((id) => !sourceById.has(id))
      ) {
        issues.push(`${bullet.id} cites evidence outside ${ownerLabel}.`);
        continue;
      }
      const evidenceText = bullet.evidence
        .map((id) => sourceById.get(id) ?? "")
        .join(" ");
      if (!numbersAreGrounded(bullet.text, evidenceText)) {
        issues.push(
          `${bullet.id} introduces an unsupported number: ${describeUnsupportedNumbers(bullet.text, evidenceText)}.`,
        );
      }
    }
  };

  for (const role of optimization.roles) {
    const source = resume.experience.find(
      (candidate) => candidate.id === role.id,
    );
    if (source) validateBullets(`work role ${role.id}`, source.bullets, role.bullets);
  }
  for (const project of optimization.projects ?? []) {
    const source = (resume.projects ?? []).find(
      (candidate) => candidate.id === project.id,
    );
    if (source) {
      validateBullets(`project ${project.id}`, source.bullets, project.bullets);
    }
  }
  for (const section of optimization.additionalSections ?? []) {
    const sourceSection = (resume.additionalSections ?? []).find(
      (candidate) => candidate.id === section.id,
    );
    if (!sourceSection) {
      issues.push(`Additional section ${section.id} is not in the source resume.`);
      continue;
    }
    for (const item of section.items) {
      const sourceItem = sourceSection.items.find(
        (candidate) => candidate.id === item.id,
      );
      if (!sourceItem) {
        issues.push(`Additional item ${item.id} is not in section ${section.id}.`);
        continue;
      }
      validateBullets(`additional item ${item.id}`, sourceItem.bullets, item.bullets);
    }
  }
  return [...new Set(issues)];
}

export function validatePreservedOptimization(
  resume: Resume,
  optimization: Optimization,
): string[] {
  const issues: string[] = [];
  if (
    optimization.sectionOrder &&
    !sameIds(optimization.sectionOrder, currentResumeSectionOrder(resume))
  ) {
    issues.push("Original section order changed.");
  }
  const sourceLabels = resume.sectionLabels ?? {};
  const outputLabels = optimization.sectionLabels;
  for (const section of Object.keys(sourceLabels) as CoreResumeSection[]) {
    if (outputLabels && outputLabels[section] !== sourceLabels[section]) {
      issues.push(`Original heading for ${section} changed.`);
    }
  }
  if (!resume.summary && optimization.summary) {
    issues.push("Summary was added even though the source has no summary section.");
  }
  if (resume.summary && !optimization.summary.trim()) {
    issues.push("The existing summary was removed.");
  }
  if (!numbersAreGrounded(optimization.summary, resume.summary)) {
    issues.push(
      `The summary introduces an unsupported number: ${describeUnsupportedNumbers(optimization.summary, resume.summary)}.`,
    );
  }
  if (!resume.title && optimization.title) {
    issues.push("A professional title was added to a source without one.");
  }
  if (!numbersAreGrounded(optimization.title, resume.title)) {
    issues.push(
      `The professional title introduces an unsupported number: ${describeUnsupportedNumbers(optimization.title, resume.title)}.`,
    );
  }

  const sourceSkills = resume.skills.map(normalizedSkill).sort();
  const outputSkills = optimization.skills.map(normalizedSkill).sort();
  if (
    sourceSkills.length !== outputSkills.length ||
    sourceSkills.some((skill, index) => skill !== outputSkills[index])
  ) {
    issues.push("The original skills must all be preserved.");
  }

  if (
    !sameIds(
      optimization.roles.map((role) => role.id),
      resume.experience.map((role) => role.id),
    )
  ) {
    issues.push("Work roles were added, removed, or reordered.");
  }
  if (
    !sameIds(
      optimization.projects.map((project) => project.id),
      (resume.projects ?? []).map((project) => project.id),
    )
  ) {
    issues.push("Projects were added, removed, or reordered.");
  }

  for (const role of resume.experience) {
    const output = optimization.roles.find((candidate) => candidate.id === role.id);
    if (!output) continue;
    if (
      !sameIds(
        output.bullets.map((bullet) => bullet.id),
        role.bullets.map((bullet) => bullet.id),
      )
    ) {
      issues.push(`${role.id} bullet count, ids, or order changed.`);
      continue;
    }
    role.bullets.forEach((source, index) => {
      const bullet = output.bullets[index];
      if (!bullet.text.trim()) issues.push(`${source.id} became empty.`);
      if (
        bullet.evidence.length !== 1 ||
        bullet.evidence[0] !== source.id
      ) {
        issues.push(`${source.id} is not mapped one-to-one to its source.`);
      }
      if (!numbersAreGrounded(bullet.text, source.text)) {
        issues.push(
          `${source.id} introduces an unsupported number: ${describeUnsupportedNumbers(bullet.text, source.text)}.`,
        );
      }
    });
  }

  for (const project of resume.projects ?? []) {
    const output = optimization.projects.find(
      (candidate) => candidate.id === project.id,
    );
    if (!output) continue;
    if (
      !sameIds(
        output.bullets.map((bullet) => bullet.id),
        project.bullets.map((bullet) => bullet.id),
      )
    ) {
      issues.push(`${project.id} bullet count, ids, or order changed.`);
      continue;
    }
    project.bullets.forEach((source, index) => {
      const bullet = output.bullets[index];
      if (!bullet.text.trim()) issues.push(`${source.id} became empty.`);
      if (
        bullet.evidence.length !== 1 ||
        bullet.evidence[0] !== source.id
      ) {
        issues.push(`${source.id} is not mapped one-to-one to its source.`);
      }
      if (!numbersAreGrounded(bullet.text, source.text)) {
        issues.push(
          `${source.id} introduces an unsupported number: ${describeUnsupportedNumbers(bullet.text, source.text)}.`,
        );
      }
    });
  }

  const sourceAdditional = resume.additionalSections ?? [];
  const outputAdditional = optimization.additionalSections ?? [];
  if (
    !sameIds(
      outputAdditional.map((section) => section.id),
      sourceAdditional.map((section) => section.id),
    )
  ) {
    issues.push("Additional sections were added, removed, or reordered.");
  }
  for (const section of sourceAdditional) {
    const outputSection = outputAdditional.find(
      (candidate) => candidate.id === section.id,
    );
    if (!outputSection) continue;
    if (
      !sameIds(
        outputSection.items.map((item) => item.id),
        section.items.map((item) => item.id),
      )
    ) {
      issues.push(`${section.id} items were added, removed, or reordered.`);
      continue;
    }
    section.items.forEach((item, itemIndex) => {
      const outputItem = outputSection.items[itemIndex];
      if (
        !sameIds(
          outputItem.bullets.map((bullet) => bullet.id),
          item.bullets.map((bullet) => bullet.id),
        )
      ) {
        issues.push(`${item.id} bullet count, ids, or order changed.`);
        return;
      }
      item.bullets.forEach((source, bulletIndex) => {
        const bullet = outputItem.bullets[bulletIndex];
        if (!bullet.text.trim()) issues.push(`${source.id} became empty.`);
        if (
          bullet.evidence.length !== 1 ||
          bullet.evidence[0] !== source.id
        ) {
          issues.push(`${source.id} is not mapped one-to-one to its source.`);
        }
        if (!numbersAreGrounded(bullet.text, source.text)) {
          issues.push(
            `${source.id} introduces an unsupported number: ${describeUnsupportedNumbers(bullet.text, source.text)}.`,
          );
        }
      });
    });
  }
  return [...new Set(issues)];
}

/**
 * Page-fit variants preserve source section headings and their order, not every
 * content entry in the full master. Lower-priority entries, items, skills, and
 * bullets may be removed to satisfy an exact page target, but every source
 * section must remain represented. The full optimized master remains untouched
 * and restorable.
 */
export function validatePreservedFitOptimization(
  resume: Resume,
  optimization: Optimization,
  baseline: Optimization,
): string[] {
  const issues: string[] = [];
  if (
    optimization.sectionOrder &&
    !sameIds(
      optimization.sectionOrder,
      baseline.sectionOrder ?? currentResumeSectionOrder(resume),
    )
  ) {
    issues.push("Original section order changed during page fitting.");
  }
  if (
    JSON.stringify(optimization.sectionLabels ?? {}) !==
    JSON.stringify(baseline.sectionLabels ?? {})
  ) {
    issues.push("Original section headings changed during page fitting.");
  }
  if (!resume.summary && optimization.summary.trim()) {
    issues.push("Page fitting added a summary section absent from the source.");
  }
  if (resume.summary && !optimization.summary.trim()) {
    issues.push("Page fitting removed the existing summary section.");
  }
  if (
    resume.skills.length > 0 &&
    baseline.skills.length > 0 &&
    optimization.skills.length === 0
  ) {
    issues.push("Page fitting removed the entire skills section.");
  }
  const allowedSkills = new Set(
    [...resume.skills, ...baseline.skills].map(normalizedSkill),
  );
  if (
    optimization.skills.some(
      (skill) => !allowedSkills.has(normalizedSkill(skill)),
    )
  ) {
    issues.push("Page fitting introduced a skill absent from the full master.");
  }

  const sourceRoleIds = resume.experience.map((role) => role.id);
  const fittedRoleIds = optimization.roles.map((role) => role.id);
  if (!orderedSubset(fittedRoleIds, sourceRoleIds)) {
    issues.push("Work entries were added or reordered during page fitting.");
  }
  if (sourceRoleIds.length > 0 && fittedRoleIds.length === 0) {
    issues.push("Page fitting removed the entire work section.");
  }
  const sourceProjectIds = (resume.projects ?? []).map((project) => project.id);
  const fittedProjectIds = optimization.projects.map((project) => project.id);
  if (!orderedSubset(fittedProjectIds, sourceProjectIds)) {
    issues.push("Project entries were added or reordered during page fitting.");
  }
  if (sourceProjectIds.length > 0 && fittedProjectIds.length === 0) {
    issues.push("Page fitting removed the entire project section.");
  }

  for (const role of optimization.roles) {
    const source = resume.experience.find((candidate) => candidate.id === role.id);
    if (
      source &&
      !orderedSubset(
        role.bullets.map((bullet) => bullet.id),
        source.bullets.map((bullet) => bullet.id),
      )
    ) {
      issues.push(`${role.id} bullets were moved, added, or reordered.`);
    }
  }
  for (const project of optimization.projects) {
    const source = (resume.projects ?? []).find(
      (candidate) => candidate.id === project.id,
    );
    if (
      source &&
      !orderedSubset(
        project.bullets.map((bullet) => bullet.id),
        source.bullets.map((bullet) => bullet.id),
      )
    ) {
      issues.push(`${project.id} bullets were moved, added, or reordered.`);
    }
  }

  const sourceAdditional = resume.additionalSections ?? [];
  const fittedAdditional = optimization.additionalSections ?? [];
  if (
    !sameIds(
      fittedAdditional.map((section) => section.id),
      sourceAdditional.map((section) => section.id),
    )
  ) {
    issues.push("Additional sections were added, removed, or reordered during page fitting.");
  }
  for (const section of fittedAdditional) {
    const sourceSection = sourceAdditional.find(
      (candidate) => candidate.id === section.id,
    );
    if (!sourceSection) continue;
    const fittedItemIds = section.items.map((item) => item.id);
    const sourceItemIds = sourceSection.items.map((item) => item.id);
    if (!orderedSubset(fittedItemIds, sourceItemIds)) {
      issues.push(`${section.id} entries were added or reordered.`);
      continue;
    }
    if (sourceItemIds.length > 0 && fittedItemIds.length === 0) {
      issues.push(`Page fitting removed every entry under ${section.id}.`);
      continue;
    }
    for (const item of section.items) {
      const sourceItem = sourceSection.items.find(
        (candidate) => candidate.id === item.id,
      );
      if (
        sourceItem &&
        !orderedSubset(
          item.bullets.map((bullet) => bullet.id),
          sourceItem.bullets.map((bullet) => bullet.id),
        )
      ) {
        issues.push(`${item.id} bullets were moved, added, or reordered.`);
      }
    }
  }
  return [...new Set(issues)];
}

function optimizationBulletText(optimization: Optimization): Map<string, string> {
  return new Map(
    [
      ...optimization.roles.flatMap((role) => role.bullets),
      ...optimization.projects.flatMap((project) => project.bullets),
      ...(optimization.additionalSections ?? []).flatMap((section) =>
        section.items.flatMap((item) => item.bullets),
      ),
    ].map((bullet) => [bullet.id, bullet.text]),
  );
}

function optimizationBulletMap(optimization: Optimization) {
  return new Map(
    [
      ...optimization.roles.flatMap((role) => role.bullets),
      ...optimization.projects.flatMap((project) => project.bullets),
      ...(optimization.additionalSections ?? []).flatMap((section) =>
        section.items.flatMap((item) => item.bullets),
      ),
    ].map((bullet) => [bullet.id, bullet]),
  );
}

function resumeBulletText(resume: Resume): Map<string, string> {
  return new Map(
    [
      ...resume.experience.flatMap((role) => role.bullets),
      ...(resume.projects ?? []).flatMap((project) => project.bullets),
      ...(resume.additionalSections ?? []).flatMap((section) =>
        section.items.flatMap((item) => item.bullets),
      ),
    ].map((bullet) => [bullet.id, bullet.text]),
  );
}

function sameEvidence(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((id) => expected.has(id));
}

function sourceOptimizedBullet(
  resume: Resume,
  id: string,
): Optimization["roles"][number]["bullets"][number] | null {
  const text = resumeBulletText(resume).get(id);
  return text === undefined
    ? null
    : {
        id,
        text,
        evidence: [id],
        matchedKeywords: [],
        rationale: "Locked source wording.",
      };
}

function expectedLockedBullet(
  resume: Resume,
  baseline: Optimization | null | undefined,
  id: string,
) {
  if (!baseline) return sourceOptimizedBullet(resume, id);
  const bullets = [...optimizationBulletMap(baseline).values()];
  return (
    bullets.find((bullet) => bullet.id === id) ??
    bullets.find(
      (bullet) => bullet.evidence.length === 1 && bullet.evidence[0] === id,
    ) ??
    sourceOptimizedBullet(resume, id)
  );
}

function lockedBulletOwner(
  resume: Resume,
  baseline: Optimization | null | undefined,
  id: string,
):
  | { kind: "role" | "project"; ownerId: string }
  | { kind: "additional"; ownerId: string; sectionId: string }
  | null {
  const matches = (bullet: { id: string; evidence?: string[] }) =>
    bullet.id === id || bullet.evidence?.includes(id);
  for (const role of baseline?.roles ?? []) {
    if (role.bullets.some(matches)) return { kind: "role", ownerId: role.id };
  }
  for (const project of baseline?.projects ?? []) {
    if (project.bullets.some(matches)) {
      return { kind: "project", ownerId: project.id };
    }
  }
  for (const section of baseline?.additionalSections ?? []) {
    for (const item of section.items) {
      if (item.bullets.some(matches)) {
        return { kind: "additional", ownerId: item.id, sectionId: section.id };
      }
    }
  }
  for (const role of resume.experience) {
    if (role.bullets.some((bullet) => bullet.id === id)) {
      return { kind: "role", ownerId: role.id };
    }
  }
  for (const project of resume.projects ?? []) {
    if (project.bullets.some((bullet) => bullet.id === id)) {
      return { kind: "project", ownerId: project.id };
    }
  }
  for (const section of resume.additionalSections ?? []) {
    for (const item of section.items) {
      if (item.bullets.some((bullet) => bullet.id === id)) {
        return { kind: "additional", ownerId: item.id, sectionId: section.id };
      }
    }
  }
  return null;
}

export function enforceLockedOptimization({
  resume,
  candidate,
  lockedContentIds,
  baseline,
}: {
  resume: Resume;
  candidate: Optimization;
  lockedContentIds: string[];
  baseline?: Optimization | null;
}): Optimization {
  if (lockedContentIds.length === 0) return candidate;
  const locked = new Set(lockedContentIds);
  const output: Optimization = {
    ...candidate,
    summary: locked.has("summary")
      ? baseline?.summary ?? resume.summary
      : candidate.summary,
    title: locked.has("title")
      ? baseline?.title ?? resume.title
      : candidate.title,
    skills: [...candidate.skills],
    skillEvidence: candidate.skillEvidence
      ? candidate.skillEvidence.map((item) => ({
          ...item,
          evidence: [...item.evidence],
        }))
      : undefined,
    roles: candidate.roles.map((role) => ({
      ...role,
      bullets: role.bullets.map((bullet) => ({
        ...bullet,
        evidence: [...bullet.evidence],
        matchedKeywords: [...bullet.matchedKeywords],
      })),
    })),
    projects: candidate.projects.map((project) => ({
      ...project,
      bullets: project.bullets.map((bullet) => ({
        ...bullet,
        evidence: [...bullet.evidence],
        matchedKeywords: [...bullet.matchedKeywords],
      })),
    })),
    additionalSections: (candidate.additionalSections ?? []).map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        bullets: item.bullets.map((bullet) => ({
          ...bullet,
          evidence: [...bullet.evidence],
          matchedKeywords: [...bullet.matchedKeywords],
        })),
      })),
    })),
  };

  for (const id of lockedContentIds) {
    if (id.startsWith("skill:")) {
      const normalized = id.slice("skill:".length);
      const expected = (baseline?.skills ?? resume.skills).find(
        (skill) => normalizedSkill(skill) === normalized,
      );
      if (
        expected &&
        !output.skills.some((skill) => normalizedSkill(skill) === normalized)
      ) {
        output.skills.push(expected);
      }
      continue;
    }
    if (id === "summary" || id === "title") continue;
    const expected = expectedLockedBullet(resume, baseline, id);
    if (!expected) continue;
    let replaced = false;
    const replace = (
      bullets: Optimization["roles"][number]["bullets"],
    ) =>
      bullets.map((bullet) => {
        if (
          replaced ||
          (bullet.id !== id && !sameEvidence(bullet.evidence, expected.evidence))
        ) {
          return bullet;
        }
        replaced = true;
        return {
          ...expected,
          evidence: [...expected.evidence],
          matchedKeywords: [...expected.matchedKeywords],
        };
      });
    output.roles = output.roles.map((role) => ({
      ...role,
      bullets: replace(role.bullets),
    }));
    output.projects = output.projects.map((project) => ({
      ...project,
      bullets: replace(project.bullets),
    }));
    output.additionalSections = (output.additionalSections ?? []).map(
      (section) => ({
        ...section,
        items: section.items.map((item) => ({
          ...item,
          bullets: replace(item.bullets),
        })),
      }),
    );
    if (!replaced) {
      const owner = lockedBulletOwner(resume, baseline, id);
      const lockedBullet = {
        ...expected,
        evidence: [...expected.evidence],
        matchedKeywords: [...expected.matchedKeywords],
      };
      if (owner?.kind === "role") {
        output.roles = output.roles.map((role) =>
          role.id === owner.ownerId
            ? { ...role, bullets: [...role.bullets, lockedBullet] }
            : role,
        );
      } else if (owner?.kind === "project") {
        output.projects = output.projects.map((project) =>
          project.id === owner.ownerId
            ? { ...project, bullets: [...project.bullets, lockedBullet] }
            : project,
        );
      } else if (owner?.kind === "additional") {
        output.additionalSections = (output.additionalSections ?? []).map(
          (section) =>
            section.id !== owner.sectionId
              ? section
              : {
                  ...section,
                  items: section.items.map((item) =>
                    item.id === owner.ownerId
                      ? { ...item, bullets: [...item.bullets, lockedBullet] }
                      : item,
                  ),
                },
        );
      }
    }
  }
  return output;
}

export function validateLockedOptimization({
  resume,
  candidate,
  lockedContentIds,
  baseline,
}: {
  resume: Resume;
  candidate: Optimization;
  lockedContentIds: string[];
  baseline?: Optimization | null;
}): string[] {
  if (lockedContentIds.length === 0) return [];
  const candidateBullets = optimizationBulletText(candidate);
  const baselineBullets = baseline
    ? optimizationBulletText(baseline)
    : resumeBulletText(resume);
  const candidateBulletDetails = optimizationBulletMap(candidate);
  const baselineBulletDetails = baseline
    ? optimizationBulletMap(baseline)
    : null;
  const issues: string[] = [];
  for (const id of lockedContentIds) {
    if (id === "summary") {
      const expected = baseline?.summary ?? resume.summary;
      if (candidate.summary !== expected) issues.push("Locked summary changed.");
      continue;
    }
    if (id.startsWith("skill:")) {
      const expected = id.slice("skill:".length);
      if (
        !candidate.skills.some(
          (skill) => normalizedSkill(skill) === expected,
        )
      ) {
        issues.push(`Locked skill ${expected} changed or was removed.`);
      }
      continue;
    }
    if (id === "title") {
      const expected = baseline?.title ?? resume.title;
      if (candidate.title !== expected) issues.push("Locked title changed.");
      continue;
    }
    const expectedBullet = expectedLockedBullet(resume, baseline, id);
    const expected = expectedBullet?.text ?? baselineBullets.get(id);
    if (expected === undefined) continue;
    const baselineBullet =
      baselineBulletDetails?.get(id) ?? expectedBullet ?? undefined;
    const remappedCandidate =
      !candidateBullets.has(id) && baselineBullet?.evidence.length
        ? [...candidateBulletDetails.values()].find(
            (bullet) =>
              sameEvidence(bullet.evidence, baselineBullet.evidence),
          )
        : null;
    if ((candidateBullets.get(id) ?? remappedCandidate?.text) !== expected) {
      issues.push(`Locked content ${id} changed.`);
    }
  }
  return issues;
}

export function constrainPreservedOptimization({
  resume,
  candidate,
  baseline,
  lockedContentIds,
}: {
  resume: Resume;
  candidate: Optimization;
  baseline?: Optimization | null;
  lockedContentIds: string[];
}): Optimization {
  const locked = new Set(lockedContentIds);
  const candidateBullets = [
    ...candidate.roles.flatMap((role) => role.bullets),
    ...candidate.projects.flatMap((project) => project.bullets),
    ...(candidate.additionalSections ?? []).flatMap((section) =>
      section.items.flatMap((item) => item.bullets),
    ),
  ];
  const baselineBullets = baseline
    ? [...optimizationBulletMap(baseline).values()]
    : [];
  const rewriteBullet = (source: { id: string; text: string }) => {
    const lockedBaseline = baselineBullets.find(
      (bullet) =>
        locked.has(bullet.id) &&
        (bullet.id === source.id ||
          (bullet.evidence.length === 1 && bullet.evidence[0] === source.id)),
    );
    const proposed = candidateBullets.find(
      (bullet) =>
        (bullet.id === source.id &&
          bullet.evidence.length === 1 &&
          bullet.evidence[0] === source.id) ||
        (bullet.evidence.length === 1 && bullet.evidence[0] === source.id),
    );
    const selected = lockedBaseline ?? proposed;
    const safeText =
      selected?.text.trim() && numbersAreGrounded(selected.text, source.text)
        ? selected.text.trim()
        : source.text;
    return {
      id: source.id,
      text: safeText,
      evidence: [source.id],
      matchedKeywords: selected?.matchedKeywords ?? [],
      rationale:
        selected?.rationale ||
        (selected
          ? "Rewritten within the original bullet structure."
          : "Kept the original wording because no safe rewrite was returned."),
    };
  };

  const skillByNormalized = new Map(
    resume.skills.map((skill) => [normalizedSkill(skill), skill]),
  );
  const orderedSkills: string[] = [];
  const seenSkills = new Set<string>();
  for (const proposed of candidate.skills) {
    const key = normalizedSkill(proposed);
    if (!skillByNormalized.has(key) || seenSkills.has(key)) continue;
    orderedSkills.push(proposed);
    seenSkills.add(key);
  }
  for (const source of resume.skills) {
    const key = normalizedSkill(source);
    if (seenSkills.has(key)) continue;
    orderedSkills.push(source);
    seenSkills.add(key);
  }
  const preservedSkills = reconcileGroundedSkills(
    resume,
    orderedSkills,
    candidate.skillEvidence,
  );

  const summaryBaseline = locked.has("summary")
    ? baseline?.summary ?? resume.summary
    : candidate.summary;
  const titleBaseline = locked.has("title")
    ? baseline?.title ?? resume.title
    : candidate.title;
  const summary = !resume.summary
    ? ""
    : summaryBaseline.trim() &&
        numbersAreGrounded(summaryBaseline, resume.summary)
      ? summaryBaseline.trim()
      : resume.summary;
  const title = !resume.title
    ? ""
    : titleBaseline.trim() && numbersAreGrounded(titleBaseline, resume.title)
      ? titleBaseline.trim()
      : resume.title;

  return {
    summary,
    title,
    skills: preservedSkills.skills,
    skillEvidence: preservedSkills.skillEvidence,
    roles: resume.experience.map((role) => ({
      id: role.id,
      bullets: role.bullets.map(rewriteBullet),
    })),
    projects: (resume.projects ?? []).map((project) => ({
      id: project.id,
      bullets: project.bullets.map(rewriteBullet),
    })),
    additionalSections: (resume.additionalSections ?? []).map((section) => ({
      id: section.id,
      items: section.items.map((item) => ({
        id: item.id,
        bullets: item.bullets.map(rewriteBullet),
      })),
    })),
    sectionOrder: currentResumeSectionOrder(resume),
    sectionLabels: { ...(resume.sectionLabels ?? {}) },
    structureMode: "preserve",
  };
}

function sectionCount(resume: Resume): number {
  return (resume.sectionOrder ?? []).length || [
    resume.summary,
    resume.skills.length,
    resume.experience.length,
    resume.projects?.length,
    resume.education.length,
    resume.additionalSections?.length,
  ].filter(Boolean).length;
}

export function createStructureIntegrity(
  resume: Resume,
  optimization: Optimization,
  mode: ContentStructureMode,
): StructureIntegrity {
  const totalEntries =
    resume.experience.length +
    (resume.projects ?? []).length +
    resume.education.length +
    (resume.additionalSections ?? []).reduce(
      (total, section) => total + section.items.length,
      0,
    );
  const totalBullets =
    resume.experience.reduce((total, role) => total + role.bullets.length, 0) +
    (resume.projects ?? []).reduce(
      (total, project) => total + project.bullets.length,
      0,
    ) +
    (resume.additionalSections ?? []).reduce(
      (total, section) =>
        total +
        section.items.reduce(
          (itemTotal, item) => itemTotal + item.bullets.length,
          0,
        ),
      0,
    );
  const issues =
    mode === "preserve"
      ? validatePreservedOptimization(resume, optimization)
      : [];
  const preservedBullets = Math.max(0, totalBullets - issues.filter(
    (issue) => /bullet|became empty|one-to-one|unsupported number/i.test(issue),
  ).length);
  const totalSections = sectionCount(resume);
  return {
    valid: issues.length === 0,
    sectionsPreserved: issues.some((issue) => /section/i.test(issue))
      ? Math.max(0, totalSections - 1)
      : totalSections,
    totalSections,
    entriesPreserved: issues.some((issue) => /role|project|item/i.test(issue))
      ? Math.max(0, totalEntries - 1)
      : totalEntries,
    totalEntries,
    bulletsPreserved: preservedBullets,
    totalBullets,
    factualFieldsChanged: 0,
    issues,
  };
}

export function calculateOptimizationAtsScore({
  resume,
  optimization,
  job,
}: {
  resume: Resume;
  optimization: Optimization;
  job: JobAnalysis;
}): number {
  const corpus = JSON.stringify({ resume, optimization }).toLocaleLowerCase();
  const keywords = [...job.requiredKeywords, ...job.niceToHaveKeywords];
  const keywordScore = keywords.length
    ? (keywords.filter((keyword) =>
        corpus.includes(keyword.toLocaleLowerCase()),
      ).length /
        keywords.length) *
      100
    : 85;
  const bullets = [
    ...optimization.roles.flatMap((role) => role.bullets),
    ...optimization.projects.flatMap((project) => project.bullets),
    ...(optimization.additionalSections ?? []).flatMap((section) =>
      section.items.flatMap((item) => item.bullets),
    ),
  ];
  const actionScore = bullets.length
    ? (bullets.filter((bullet) =>
        /^(Led|Built|Shipped|Owned|Drove|Designed|Migrated|Architected|Mentored|Partnered|Created|Developed|Implemented)/i.test(
          bullet.text,
        ),
      ).length /
        bullets.length) *
      100
    : 50;
  const evidenceScore = bullets.length
    ? (bullets.filter((bullet) => bullet.evidence.length > 0).length /
        bullets.length) *
      100
    : 50;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(keywordScore * 0.55 + actionScore * 0.25 + evidenceScore * 0.2),
    ),
  );
}
