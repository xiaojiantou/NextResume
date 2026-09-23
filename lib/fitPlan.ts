// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { OptimizedBullet, Resume } from "./types";

/**
 * The page-fit plan the route validates and renders. The model returns a
 * slimmer transport (bullet ids plus optional shortened text); the route
 * hydrates evidence, keywords, and rationale from the optimized master before
 * the plan reaches this shape.
 */
export type AiFitPlan = {
  summary: string;
  skills: string[];
  roles: Array<{
    id: string;
    hidden: boolean;
    collapsed: boolean;
    bullets: OptimizedBullet[];
  }>;
  projects: Array<{
    id: string;
    hidden: boolean;
    bullets: OptimizedBullet[];
  }>;
  additionalSections: Array<{
    id: string;
    items: Array<{
      id: string;
      bullets: OptimizedBullet[];
    }>;
  }>;
  hiddenAdditionalItemIds: string[];
};

export function dateRank(value: string): number {
  if (/(present|current|now|ongoing)/i.test(value)) {
    return Number.MAX_SAFE_INTEGER;
  }
  const years = value.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) ?? [];
  return years.length > 0 ? Math.max(...years) : 0;
}

export function newestRoleId(resume: Resume): string | null {
  let newest: { id: string; rank: number; index: number } | null = null;
  for (const [index, role] of resume.experience.entries()) {
    const rank = Math.max(dateRank(role.end), dateRank(role.start));
    if (
      !newest ||
      rank > newest.rank ||
      (rank === newest.rank && index < newest.index)
    ) {
      newest = { id: role.id, rank, index };
    }
  }
  return newest?.id ?? null;
}

export function sourceBulletsAsOptimization(
  bullets: Resume["experience"][number]["bullets"],
): OptimizedBullet[] {
  return bullets.map((bullet) => ({
    id: bullet.id,
    text: bullet.text,
    evidence: [bullet.id],
    matchedKeywords: [],
    rationale: "Retained from the verified source resume.",
  }));
}

/** Rough characters a fit plan puts on the page, for sizing a cut. */
export function planTextLength(plan: AiFitPlan): number {
  const bulletChars = (bullets: OptimizedBullet[]) =>
    bullets.reduce((total, bullet) => total + bullet.text.length, 0);
  return (
    plan.summary.length +
    plan.skills.join(", ").length +
    plan.roles
      .filter((role) => !role.hidden)
      .reduce(
        (total, role) => total + (role.collapsed ? 0 : bulletChars(role.bullets)),
        0,
      ) +
    plan.projects
      .filter((project) => !project.hidden)
      .reduce((total, project) => total + bulletChars(project.bullets), 0) +
    plan.additionalSections.reduce(
      (total, section) =>
        total +
        section.items
          .filter((item) => !plan.hiddenAdditionalItemIds.includes(item.id))
          .reduce((sum, item) => sum + bulletChars(item.bullets), 0),
      0,
    )
  );
}
