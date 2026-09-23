// Copyright (c) 2026 HowBe LLC. All rights reserved.

import {
  dateRank,
  newestRoleId,
  sourceBulletsAsOptimization,
  type AiFitPlan,
} from "./fitPlan.ts";
import type {
  ContentStructureMode,
  Optimization,
  OptimizedBullet,
  Resume,
} from "./types";

export type ProportionalCompressionInput = {
  resume: Resume;
  optimization: Optimization;
  structureMode: ContentStructureMode;
  protectedContentIds: string[];
  /** Text lines the cut must free to reach the page target. */
  removalLines: number;
  /**
   * Characters a full line holds. A removed bullet frees whole wrapped
   * lines plus its row gap, so this converts text length into lines.
   */
  charsPerLine?: number;
};

type Owner = "role" | "project" | "additional";

type RemovableBullet = {
  owner: Owner;
  ownerId: string;
  bullet: OptimizedBullet;
  keepScore: number;
};

const ROW_GAP_LINES = 0.35;
const ENTRY_HEADER_LINES = 1.6;
/** Bullet rows are indented, so they wrap a little sooner than a full line. */
const BULLET_LINE_SHARE = 0.92;

function normalizedSkill(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function splitSentences(value: string): string[] {
  return value
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
}

/**
 * Builds the plan that keeps every bullet of the optimized master: the
 * starting point every proportional cut is measured against.
 */
export function createFullFitPlan(
  resume: Resume,
  optimization: Optimization,
): AiFitPlan {
  return {
    summary: optimization.summary || resume.summary,
    skills: [...optimization.skills],
    roles: resume.experience.map((role) => {
      const baseline = optimization.roles.find(
        (candidate) => candidate.id === role.id,
      );
      return {
        id: role.id,
        hidden: false,
        collapsed: false,
        bullets: (baseline?.bullets ?? sourceBulletsAsOptimization(role.bullets)).map(
          (bullet) => ({ ...bullet }),
        ),
      };
    }),
    projects: (resume.projects ?? []).map((project) => {
      const baseline = (optimization.projects ?? []).find(
        (candidate) => candidate.id === project.id,
      );
      return {
        id: project.id,
        hidden: false,
        bullets: (
          baseline?.bullets ?? sourceBulletsAsOptimization(project.bullets)
        ).map((bullet) => ({ ...bullet })),
      };
    }),
    additionalSections: (resume.additionalSections ?? []).map((section) => {
      const baseline = (optimization.additionalSections ?? []).find(
        (candidate) => candidate.id === section.id,
      );
      return {
        id: section.id,
        items: section.items.map((item) => {
          const baselineItem = baseline?.items.find(
            (candidate) => candidate.id === item.id,
          );
          return {
            id: item.id,
            bullets: (
              baselineItem?.bullets ?? sourceBulletsAsOptimization(item.bullets)
            ).map((bullet) => ({ ...bullet })),
          };
        }),
      };
    }),
    hiddenAdditionalItemIds: [],
  };
}

/**
 * Removes only as much content as the measured overflow asks for, least
 * valuable first: weakly matched bullets in the oldest entries go before
 * quantified, keyword-bearing bullets in recent ones. Whole entries are hidden
 * only once bullets alone cannot free enough room, and the summary is trimmed
 * last. Protected content (kept, edited, locked) is never touched.
 */
export function createProportionalCompressionPlan({
  resume,
  optimization,
  structureMode,
  protectedContentIds,
  removalLines,
  charsPerLine = 90,
}: ProportionalCompressionInput): AiFitPlan {
  const plan = createFullFitPlan(resume, optimization);
  const protectedIds = new Set(protectedContentIds);
  const usableChars = Math.max(20, charsPerLine * BULLET_LINE_SHARE);
  const bulletLines = (bullet: OptimizedBullet) =>
    Math.ceil(bullet.text.length / usableChars) + ROW_GAP_LINES;
  const bulletsLines = (bullets: OptimizedBullet[]) =>
    bullets.reduce((total, bullet) => total + bulletLines(bullet), 0);
  const isProtectedSkill = (skill: string) =>
    protectedIds.has(skill) ||
    protectedIds.has(normalizedSkill(skill)) ||
    protectedIds.has(`skill:${normalizedSkill(skill)}`);
  const bulletProtected = (bullet: OptimizedBullet) =>
    protectedIds.has(bullet.id) ||
    bullet.evidence.some((id) => protectedIds.has(id));
  const ownerProtected = (ownerId: string, bullets: OptimizedBullet[]) =>
    protectedIds.has(ownerId) || bullets.some(bulletProtected);
  let freed = 0;
  const needMore = () => freed < removalLines;
  if (!needMore()) return plan;

  const newestId = newestRoleId(resume);
  const rolesByRecency = [...resume.experience].sort(
    (left, right) =>
      Math.max(dateRank(right.end), dateRank(right.start)) -
      Math.max(dateRank(left.end), dateRank(left.start)),
  );
  const recencyIndex = new Map(
    rolesByRecency.map((role, index) => [role.id, index]),
  );
  const roleCount = Math.max(1, resume.experience.length);
  const bulletValue = (bullet: OptimizedBullet) =>
    bullet.matchedKeywords.length * 5 +
    (/\d/.test(bullet.text) ? 2 : 0) +
    (bullet.relevance ?? 50) / 25;

  const removable: RemovableBullet[] = [];
  for (const role of plan.roles) {
    if (ownerProtected(role.id, role.bullets)) continue;
    const recency = 1 - (recencyIndex.get(role.id) ?? roleCount) / roleCount;
    for (const bullet of role.bullets) {
      if (bulletProtected(bullet)) continue;
      removable.push({
        owner: "role",
        ownerId: role.id,
        bullet,
        keepScore:
          bulletValue(bullet) + recency * 4 + (role.id === newestId ? 3 : 0),
      });
    }
  }
  for (const project of plan.projects) {
    if (ownerProtected(project.id, project.bullets)) continue;
    for (const bullet of project.bullets) {
      if (bulletProtected(bullet)) continue;
      removable.push({
        owner: "project",
        ownerId: project.id,
        bullet,
        keepScore: bulletValue(bullet) + 1,
      });
    }
  }
  for (const section of plan.additionalSections) {
    for (const item of section.items) {
      if (
        protectedIds.has(section.id) ||
        ownerProtected(item.id, item.bullets)
      ) {
        continue;
      }
      for (const bullet of item.bullets) {
        if (bulletProtected(bullet)) continue;
        removable.push({
          owner: "additional",
          ownerId: item.id,
          bullet,
          keepScore: bulletValue(bullet),
        });
      }
    }
  }
  removable.sort((left, right) => left.keepScore - right.keepScore);

  const minimumBullets = (owner: Owner, ownerId: string, total: number) => {
    if (owner === "additional") return 0;
    if (owner === "project") return Math.min(1, total);
    if (structureMode === "preserve") return Math.min(1, total);
    return ownerId === newestId ? Math.min(2, total) : Math.min(1, total);
  };
  const bulletsOf = (owner: Owner, ownerId: string): OptimizedBullet[] => {
    if (owner === "role") {
      return plan.roles.find((role) => role.id === ownerId)?.bullets ?? [];
    }
    if (owner === "project") {
      return (
        plan.projects.find((project) => project.id === ownerId)?.bullets ?? []
      );
    }
    for (const section of plan.additionalSections) {
      const item = section.items.find((candidate) => candidate.id === ownerId);
      if (item) return item.bullets;
    }
    return [];
  };
  const originalCount = new Map<string, number>();
  for (const entry of removable) {
    const key = `${entry.owner}:${entry.ownerId}`;
    if (!originalCount.has(key)) {
      originalCount.set(key, bulletsOf(entry.owner, entry.ownerId).length);
    }
  }

  // Phase 1: individual bullets, weakest first, down to each entry's minimum.
  for (const entry of removable) {
    if (!needMore()) break;
    const bullets = bulletsOf(entry.owner, entry.ownerId);
    const minimum = minimumBullets(
      entry.owner,
      entry.ownerId,
      originalCount.get(`${entry.owner}:${entry.ownerId}`) ?? bullets.length,
    );
    if (bullets.length <= minimum) continue;
    const index = bullets.findIndex((bullet) => bullet.id === entry.bullet.id);
    if (index < 0) continue;
    bullets.splice(index, 1);
    freed += bulletLines(entry.bullet);
    if (entry.owner === "additional" && bullets.length === 0) {
      plan.hiddenAdditionalItemIds.push(entry.ownerId);
      freed += ENTRY_HEADER_LINES;
    }
  }

  // Phase 2: whole entries, oldest first, never the newest role.
  if (needMore()) {
    const hideableRoles = [...rolesByRecency]
      .reverse()
      .filter(
        (role) =>
          role.id !== newestId &&
          !ownerProtected(
            role.id,
            plan.roles.find((candidate) => candidate.id === role.id)?.bullets ?? [],
          ),
      );
    for (const role of hideableRoles) {
      if (!needMore()) break;
      const planRole = plan.roles.find((candidate) => candidate.id === role.id);
      if (!planRole || planRole.hidden) continue;
      const visibleRoles = plan.roles.filter((candidate) => !candidate.hidden);
      if (visibleRoles.length <= 1) break;
      planRole.hidden = true;
      freed += ENTRY_HEADER_LINES + bulletsLines(planRole.bullets);
    }
  }
  if (needMore()) {
    const earlyCareer = resume.experience.length <= 1;
    const projects = [...plan.projects].reverse();
    for (const project of projects) {
      if (!needMore()) break;
      if (project.hidden || ownerProtected(project.id, project.bullets)) continue;
      const visible = plan.projects.filter((candidate) => !candidate.hidden);
      if (earlyCareer && visible.length <= 1) break;
      project.hidden = true;
      freed += ENTRY_HEADER_LINES + bulletsLines(project.bullets);
    }
  }
  if (needMore()) {
    for (const section of plan.additionalSections) {
      for (const item of section.items) {
        if (!needMore()) break;
        if (
          plan.hiddenAdditionalItemIds.includes(item.id) ||
          protectedIds.has(section.id) ||
          ownerProtected(item.id, item.bullets)
        ) {
          continue;
        }
        plan.hiddenAdditionalItemIds.push(item.id);
        freed += ENTRY_HEADER_LINES + bulletsLines(item.bullets);
      }
    }
  }

  // Phase 3: the summary's trailing sentences, then surplus skills.
  if (needMore() && !protectedIds.has("summary")) {
    const sentences = splitSentences(plan.summary);
    for (let keep = Math.min(2, sentences.length); keep >= 1; keep -= 1) {
      if (!needMore()) break;
      const next = sentences.slice(0, keep).join(" ");
      if (next.length >= plan.summary.length) continue;
      freed +=
        Math.ceil(plan.summary.length / charsPerLine) -
        Math.ceil(next.length / charsPerLine);
      plan.summary = next;
    }
  }
  if (needMore()) {
    const minimumSkills = 8;
    while (needMore() && plan.skills.length > minimumSkills) {
      const index = plan.skills
        .map((skill, position) => ({ skill, position }))
        .reverse()
        .find(({ skill }) => !isProtectedSkill(skill))?.position;
      if (index === undefined) break;
      const [removed] = plan.skills.splice(index, 1);
      freed += (removed.length + 2) / charsPerLine;
    }
  }

  return plan;
}
