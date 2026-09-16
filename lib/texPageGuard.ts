// Copyright (c) 2026 HowBe LLC. All rights reserved.

// A user's own .tex is a fixed layout: the same margins and font that fit
// their original content in N pages will overflow onto N+1 the moment a
// rewrite runs longer, even though nothing in the rewrite is factually wrong.
// The prompt-side length budget (lib/optimizeChunks.ts) keeps most rewrites
// close to source length, but it is advice to a model, not a guarantee.
//
// This module is the deterministic backstop for the .tex export: given the
// page counts of the original and the edited document, decide which bullets
// (and the summary) to revert to their exact source wording — largest growth
// first — until nothing distinguishes the export from a document the user's
// own template already knows how to fit. Reverting is deterministic and free
// (no model call): the source wording is definitionally not longer than
// itself, so it is the fastest way back to the original page count.
import type { Optimization, OptimizedBullet, Resume } from "./types";

export type ShrinkCandidate = {
  kind: "bullet" | "summary";
  /** Bullet id, or "summary" for the headline paragraph. */
  id: string;
  /** Characters the rewrite added over the source; always positive. */
  growth: number;
};

function sourceBulletTextById(resume: Resume): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of [...resume.experience, ...(resume.projects ?? [])]) {
    for (const bullet of entry.bullets) map.set(bullet.id, bullet.text);
  }
  for (const section of resume.additionalSections ?? []) {
    for (const item of section.items) {
      for (const bullet of item.bullets) map.set(bullet.id, bullet.text);
    }
  }
  return map;
}

/**
 * Every rewritten bullet and the summary that grew past its source length,
 * longest growth first. Only growth can cause an overflow a revert can fix;
 * a rewrite that got shorter or stayed the same is never a shrink candidate.
 */
export function findShrinkCandidates(
  resume: Resume,
  optimization: Optimization,
): ShrinkCandidate[] {
  const sourceText = sourceBulletTextById(resume);
  const candidates: ShrinkCandidate[] = [];
  const scan = (bullets: OptimizedBullet[]) => {
    for (const bullet of bullets) {
      const source = sourceText.get(bullet.id);
      if (source === undefined || source === bullet.text) continue;
      const growth = bullet.text.length - source.length;
      if (growth > 0) candidates.push({ kind: "bullet", id: bullet.id, growth });
    }
  };
  for (const role of optimization.roles) scan(role.bullets);
  for (const project of optimization.projects ?? []) scan(project.bullets);
  for (const section of optimization.additionalSections ?? []) {
    for (const item of section.items) scan(item.bullets);
  }
  if (
    resume.summary &&
    optimization.summary &&
    optimization.summary !== resume.summary &&
    optimization.summary.length > resume.summary.length
  ) {
    candidates.push({
      kind: "summary",
      id: "summary",
      growth: optimization.summary.length - resume.summary.length,
    });
  }
  return candidates.sort((a, b) => b.growth - a.growth);
}

/**
 * Revert exactly the given ids to their source wording. A reverted bullet's
 * evidence becomes itself and it drops the keyword/quality annotations that
 * described a rewrite it no longer is, matching how the ATS regression guard
 * (lib/atsGuard.ts) restores a bullet for the same reason.
 */
export function revertShrinkCandidates(
  resume: Resume,
  optimization: Optimization,
  ids: ReadonlySet<string>,
): Optimization {
  if (ids.size === 0) return optimization;
  const sourceText = sourceBulletTextById(resume);
  const revertBullet = (bullet: OptimizedBullet): OptimizedBullet => {
    const source = sourceText.get(bullet.id);
    if (!ids.has(bullet.id) || source === undefined) return bullet;
    return {
      ...bullet,
      text: source,
      evidence: [bullet.id],
      matchedKeywords: [],
      rationale: "Kept the original wording to fit the document back into its original page count.",
      contentReview: undefined,
    };
  };
  return {
    ...optimization,
    summary:
      ids.has("summary") && resume.summary ? resume.summary : optimization.summary,
    roles: optimization.roles.map((role) => ({
      ...role,
      bullets: role.bullets.map(revertBullet),
    })),
    projects: (optimization.projects ?? []).map((project) => ({
      ...project,
      bullets: project.bullets.map(revertBullet),
    })),
    additionalSections: (optimization.additionalSections ?? []).map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        bullets: item.bullets.map(revertBullet),
      })),
    })),
  };
}

/**
 * How many of the sorted candidates to revert on each attempt. Escalates
 * fast (a resume that overflowed by one bullet's growth needs only that one
 * reverted; one that overflowed by a paragraph needs more) while bounding
 * the number of recompiles a single export can trigger.
 */
export const SHRINK_BATCH_SIZES = [1, 3, 8];
