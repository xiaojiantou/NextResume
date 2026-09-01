// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Pairs each piece of source resume text with its optimized replacement.
// Both format-preserving exports need exactly this: alignment runs against
// the ORIGINAL wording, because that is what the user's document still
// contains, and the optimized wording is what gets written back.
import type { Optimization, Resume } from "./types.ts";
import {
  alignToParagraphs,
  type AlignSource,
  type AlignTarget,
} from "./alignParagraphs.ts";

export type ResumeReplacement = {
  /** Content id, e.g. a bullet id like "b7", or "summary". */
  id: string;
  original: string;
  optimized: string;
  /**
   * Refuse anything short of an exact normalized match. A headline is a few
   * generic words — "Software Engineer" sits within fuzzy range of half the
   * job titles in the same document — so a near miss there would rewrite a
   * role in the work history instead.
   */
  requireExact?: boolean;
};

function normalizedSkill(skill: string): string {
  return skill.normalize("NFKC").toLocaleLowerCase().trim();
}

/**
 * The source headline is only safe to rewrite when it is the header's own
 * line. Resumes frequently have no headline at all, in which case the parser
 * reports the most-recent role's title as `resume.title` — writing the
 * optimized headline over that would corrupt an employment entry.
 */
function headlineIsItsOwnLine(resume: Resume): boolean {
  const headline = normalizedSkill(resume.title);
  if (!headline) return false;
  const entryTitles = [
    ...resume.experience.map((role) => role.title),
    ...(resume.projects ?? []).map((project) => project.name),
    ...(resume.projects ?? []).map((project) => project.role),
  ];
  return !entryTitles.some((title) => normalizedSkill(title) === headline);
}

/**
 * Reorders one source category by the optimized list's ranking, keeping the
 * label and every original member. Skills the optimizer added are not placed:
 * nothing states which category a new skill belongs to, and guessing would put
 * "Kubernetes" under "Languages".
 */
function reorderGroupSkills(
  groupSkills: readonly string[],
  optimizedRank: ReadonlyMap<string, number>,
): string[] {
  return groupSkills
    .map((skill, index) => ({
      skill,
      index,
      rank: optimizedRank.get(normalizedSkill(skill)) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) =>
      left.rank === right.rank
        ? left.index - right.index
        : left.rank - right.rank,
    )
    .map((entry) => entry.skill);
}

export type SkillReplacements = {
  replacements: ResumeReplacement[];
  /**
   * Skills the optimizer proposed that a category-grouped source has no
   * unambiguous home for. Reported rather than dropped silently, because the
   * rebuilt PDF does contain them.
   */
  omitted: string[];
};

export function collectSkillReplacements(
  resume: Resume,
  optimization: Optimization,
): SkillReplacements {
  if (optimization.skills.length === 0) {
    return { replacements: [], omitted: [] };
  }

  const optimizedRank = new Map(
    optimization.skills.map((skill, index) => [normalizedSkill(skill), index]),
  );
  const groups = resume.skillGroups ?? [];

  // Ungrouped sources list skills as one run of text, so the whole optimized
  // list — additions included — can be written back as one line.
  if (groups.length === 0) {
    if (resume.skills.length === 0) return { replacements: [], omitted: [] };
    return {
      replacements: [
        {
          id: "skills",
          original: resume.skills.join(", "),
          optimized: optimization.skills.join(", "),
        },
      ],
      omitted: [],
    };
  }

  const grouped = new Set(
    groups.flatMap((group) => group.skills.map(normalizedSkill)),
  );
  return {
    replacements: groups.map((group) => ({
      id: `skills:${group.label}`,
      original: `${group.label}: ${group.skills.join(", ")}`,
      optimized: `${group.label}: ${reorderGroupSkills(group.skills, optimizedRank).join(", ")}`,
    })),
    omitted: optimization.skills.filter(
      (skill) => !grouped.has(normalizedSkill(skill)),
    ),
  };
}

export function collectResumeReplacements(
  resume: Resume,
  optimization: Optimization,
  includeSummary: boolean,
): ResumeReplacement[] {
  const replacements: ResumeReplacement[] = [];

  if (includeSummary && optimization.summary && resume.summary) {
    replacements.push({
      id: "summary",
      original: resume.summary,
      optimized: optimization.summary,
    });
  }

  const addBullets = (
    entries: Array<{ id: string; bullets: Array<{ id: string; text: string }> }>,
    optimized: Array<{ id: string; bullets: Array<{ id: string; text: string }> }>,
  ) => {
    for (const entry of entries) {
      const match = optimized.find((candidate) => candidate.id === entry.id);
      if (!match) continue;
      for (const bullet of entry.bullets) {
        const next = match.bullets.find(
          (candidate) => candidate.id === bullet.id,
        );
        if (!next) continue;
        replacements.push({
          id: bullet.id,
          original: bullet.text,
          optimized: next.text,
        });
      }
    }
  };

  addBullets(resume.experience, optimization.roles);
  addBullets(resume.projects ?? [], optimization.projects ?? []);
  // Awards, certifications, publications and the rest. The rebuilt PDF
  // renders these optimized, so an in-place export that skipped them would
  // hand back a weaker document than the PDF from the same rewrite.
  for (const section of resume.additionalSections ?? []) {
    const optimizedSection = (optimization.additionalSections ?? []).find(
      (candidate) => candidate.id === section.id,
    );
    if (!optimizedSection) continue;
    addBullets(section.items, optimizedSection.items);
  }

  // Headline and skills come last so a bullet always gets first claim on a
  // paragraph during the fuzzy pass — bullets are the core of the rewrite.
  if (
    optimization.title &&
    optimization.title !== resume.title &&
    headlineIsItsOwnLine(resume)
  ) {
    replacements.push({
      id: "title",
      original: resume.title,
      optimized: optimization.title,
      requireExact: true,
    });
  }
  replacements.push(
    ...collectSkillReplacements(resume, optimization).replacements,
  );
  return replacements;
}

export type SplitReplacements = {
  /** Wording that actually changed and therefore needs writing back. */
  rewritten: ResumeReplacement[];
  /** Content ids whose wording is identical and must not be touched. */
  unchanged: string[];
};

export function splitByChanged(
  replacements: readonly ResumeReplacement[],
): SplitReplacements {
  return {
    rewritten: replacements.filter(
      (item) => item.original.trim() !== item.optimized.trim(),
    ),
    unchanged: replacements
      .filter((item) => item.original.trim() === item.optimized.trim())
      .map((item) => item.id),
  };
}

export type ReplacementPlan = {
  /** Source unit index paired with the text to write into it. */
  edits: Array<{ index: number; text: string }>;
  /** Content ids whose source unit could not be identified. */
  unplaced: string[];
  /** Content ids that were placed but whose wording did not change. */
  unchanged: string[];
  /** Skills with no unambiguous home in a category-grouped source. */
  skillsOmitted: string[];
  /** Share of rewritten content that found its source unit, 0..1. */
  coverage: number;
};

/**
 * The whole decision, shared by the Word and LaTeX exports: a paragraph and a
 * LaTeX text block are the same problem, so they get the same answer. Callers
 * only translate `edits` into their own edit shape.
 */
export function planReplacements({
  resume,
  optimization,
  units,
  includeSummary = true,
}: {
  resume: Resume;
  optimization: Optimization;
  units: readonly AlignSource[];
  includeSummary?: boolean;
}): ReplacementPlan {
  const { rewritten, unchanged } = splitByChanged(
    collectResumeReplacements(resume, optimization, includeSummary),
  );

  const targets: AlignTarget[] = rewritten.map((item) => ({
    id: item.id,
    text: item.original,
  }));
  const alignment = alignToParagraphs(targets, units);
  const optimizedById = new Map(
    rewritten.map((item) => [item.id, item.optimized]),
  );
  const exactOnly = new Set(
    rewritten.filter((item) => item.requireExact).map((item) => item.id),
  );

  const edits: Array<{ index: number; text: string }> = [];
  const unplaced = [...alignment.unmatched];
  for (const match of alignment.matched) {
    const text = optimizedById.get(match.id);
    if (text === undefined) continue;
    if (exactOnly.has(match.id) && match.confidence < 1) {
      unplaced.push(match.id);
      continue;
    }
    edits.push({ index: match.paragraphIndex, text });
  }
  // Deterministic document order keeps the applied/skipped report readable.
  edits.sort((left, right) => left.index - right.index);

  return {
    edits,
    unplaced,
    unchanged,
    skillsOmitted: collectSkillReplacements(resume, optimization).omitted,
    coverage:
      rewritten.length === 0
        ? 1
        : edits.length / rewritten.length,
  };
}
