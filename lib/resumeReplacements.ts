// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Pairs each piece of source resume text with its optimized replacement.
// Both format-preserving exports need exactly this: alignment runs against
// the ORIGINAL wording, because that is what the user's document still
// contains, and the optimized wording is what gets written back.
import type { Optimization, Resume } from "./types.ts";

export type ResumeReplacement = {
  /** Content id, e.g. a bullet id like "b7", or "summary". */
  id: string;
  original: string;
  optimized: string;
};

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
