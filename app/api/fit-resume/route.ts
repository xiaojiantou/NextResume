// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { jsonCompletion } from "@/lib/ai";
import {
  getResumePalette,
  isPdfStyle,
  type FixedPdfStyle,
  type PdfStyle,
} from "@/lib/pdf/config";
import {
  renderFixedBalanced,
  renderFixedCandidates,
} from "@/lib/pdf/renderFixed";
import {
  isSupplementalSkillsSection,
  supplementalEducationLabel,
} from "@/lib/pdf/shared";
import { requirePaidOrder } from "@/lib/entitlement";
import { renderPersonalizedPdf } from "@/lib/personalizedResume";
import { rateLimitGuard } from "@/lib/ratelimit";

import {
  numbersAreGrounded,
  validateLockedOptimization,
  validatePreservedFitOptimization,
} from "@/lib/resumeStructure";
import {
  createFitCacheKey,
  createFitLayoutRevision,
  createResumeRevision,
  defaultResumePage,
  type FitConflict,
  type FitDensity,
  type ResumeFitChange,
  type ResumeFitVariant,
} from "@/lib/resumeFit";
import type {
  AtsReport,
  ContentStructureMode,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  Resume,
  ResumePageSpec,
  ResumeStyleProfile,
} from "@/lib/types";
import { reviewSemanticGrounding } from "@/lib/semanticResumeValidation";

export const runtime = "nodejs";
export const maxDuration = 90;

const FIT_LIMIT = {
  key: "fit-resume",
  limit: 5,
  windowMs: 60_000,
};

const SYSTEM = `You are a resume page-fit editor. You receive a complete original resume, its evidence-backed job-tailored optimization, a target job, and measured PDF page counts.

Return ONLY JSON matching:
{
  "summary": string,
  "skills": string[],
  "roles": [{
    "id": string,
    "hidden": boolean,
    "collapsed": boolean,
    "bullets": [{
      "id": string,
      "text": string,
      "evidence": string[],
      "matchedKeywords": string[],
      "rationale": string
    }]
  }],
  "projects": [{
    "id": string,
    "hidden": boolean,
    "bullets": [{
      "id": string,
      "text": string,
      "evidence": string[],
      "matchedKeywords": string[],
      "rationale": string
    }]
  }],
  "additionalSections": [{
    "id": string,
    "items": [{
      "id": string,
      "bullets": [{
        "id": string,
        "text": string,
        "evidence": string[],
        "matchedKeywords": string[],
        "rationale": string
      }]
    }]
  }],
  "hiddenAdditionalItemIds": string[]
}

Evidence and truth rules:
- Never invent a metric, tool, skill, responsibility, employer, project, customer, team size, or result.
- Every output bullet must keep an existing optimized bullet id. A user-added original bullet id may also be used when it cites itself as evidence.
- Keep each bullet and every evidence id inside its original work role or project. Never move evidence between employers or projects.
- Some work roles include nested "teams". Treat team names as source context only. Do not output "teams"; keep each team achievement in its parent role's flat "bullets" transport using the original bullet id/evidence.
- Reword, combine, shorten, or expand only facts traceable to those evidence ids. Every number in rewritten text must appear in that bullet's evidence.
- Skills must be selected verbatim from the original or optimized skill lists.
- Return every work role id as a transport record. Set hidden=true to omit a lower-priority role from a compressed result. In OPTIMIZE FOR ROLE, the newest visible role needs at least 2 bullets when the source has 2; other visible, non-collapsed roles need at least 1.
- A collapsed role remains visible with company/title/dates but no bullets. A hidden role is omitted completely.
- Return every project id as a transport record. Set hidden=true to omit a lower-priority project from a compressed result.
- KEEP ORIGINAL locks section headings and section order, not every content entry. It may hide lower-priority roles, projects, additional items, bullets, or skills, but must leave at least one visible value or entry under every source section heading.
- Do not hide user-kept ids.
- Required job keywords are relevance signals, not locks. Keep the strongest evidence-backed terms when space allows, but page targets may remove any keyword the user did not explicitly keep.
- For a 1-page compression keep roughly 6-10 concrete skills; for 2 pages keep 10-16; for 3+ pages keep at most 20. Drop vague category labels and duplicates first.
- Remove coursework, entrance-exam scores, community extras, and low-relevance supplemental items before hiding a relevant project or collapsing work experience.
- Keep education metadata unchanged; it is not part of this response.
- For expansion, do not hide content. Add useful detail only by combining or clarifying existing evidence.
- Prefer relevance to the target job, measurable impact, unique evidence, then recency.
- Produce concise English resume prose, not commentary.`;

type AiFitPlan = {
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

type FitRequest = {
  resume: Resume;
  optimization: Optimization;
  job: JobAnalysis;
  report: AtsReport;
  model: string;
  style: PdfStyle;
  palette?: string;
  targetPages: number;
  pageSize?: ResumePageSpec;
  resumeStyleSourcePage?: ResumePageSpec | null;
  personalizedStyleProfile?: ResumeStyleProfile | null;
  keptContentIds?: string[];
  priorityContentIds?: string[];
  lockedContentIds?: string[];
  structureMode?: ContentStructureMode;
};

type Measured = {
  pageCount: number;
  density: FitDensity;
  observedPages: number[];
};

async function fitJsonCompletion({
  system,
  user,
  model,
  maxTokens,
  timeoutMs,
}: {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await jsonCompletion<unknown>({
      system,
      user,
      model,
      maxTokens,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || /aborted|abort error/i.test(error.message))
  );
}

function normalizeAiFitPlan(
  value: unknown,
  resume: Resume,
  optimization: Optimization,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const normalizeBullet = (bullet: unknown) => {
    if (!bullet || typeof bullet !== "object" || Array.isArray(bullet)) {
      return bullet;
    }
    const item = bullet as Record<string, unknown>;
    return {
      ...item,
      matchedKeywords: Array.isArray(item.matchedKeywords)
        ? item.matchedKeywords
        : [],
      rationale:
        typeof item.rationale === "string"
          ? item.rationale
          : "Adjusted for the selected page target.",
    };
  };
  const normalizeOwner = (owner: unknown, booleanKeys: Array<"collapsed" | "hidden">) => {
    if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
      return owner;
    }
    const item = owner as Record<string, unknown>;
    return {
      ...item,
      ...Object.fromEntries(
        booleanKeys.map((booleanKey) => [
          booleanKey,
          typeof item[booleanKey] === "boolean" ? item[booleanKey] : false,
        ]),
      ),
      bullets: Array.isArray(item.bullets)
        ? item.bullets.map(normalizeBullet)
        : item.bullets,
    };
  };
  const hiddenAdditionalItemIds = Array.isArray(
    record.hiddenAdditionalItemIds,
  )
    ? [
        ...new Set(
          record.hiddenAdditionalItemIds.flatMap((id) => {
            if (typeof id !== "string") return [id];
            const section = (resume.additionalSections ?? []).find(
              (candidate) => candidate.id === id,
            );
            return section ? section.items.map((item) => item.id) : [id];
          }),
        ),
      ]
    : [];
  const additionalSections = Array.isArray(record.additionalSections)
    ? record.additionalSections.map((rawSection) => {
        if (
          !rawSection ||
          typeof rawSection !== "object" ||
          Array.isArray(rawSection)
        ) {
          return rawSection;
        }
        const section = rawSection as Record<string, unknown>;
        return {
          ...section,
          items: Array.isArray(section.items)
            ? section.items.map((rawItem) => {
                if (
                  !rawItem ||
                  typeof rawItem !== "object" ||
                  Array.isArray(rawItem)
                ) {
                  return rawItem;
                }
                const item = rawItem as Record<string, unknown>;
                return {
                  ...item,
                  bullets: Array.isArray(item.bullets)
                    ? item.bullets.map(normalizeBullet)
                    : item.bullets,
                };
              })
            : section.items,
        };
      })
    : (optimization.additionalSections ?? []).map((section) => ({
        ...section,
        items: section.items.map((item) => ({
          ...item,
          bullets: item.bullets.map((bullet) => ({ ...bullet })),
        })),
      }));
  return {
    ...record,
    roles: Array.isArray(record.roles)
      ? record.roles.map((role) =>
          normalizeOwner(role, ["hidden", "collapsed"]),
        )
      : record.roles,
    projects: Array.isArray(record.projects)
      ? record.projects.map((project) => normalizeOwner(project, ["hidden"]))
      : (resume.projects ?? []).length === 0
        ? []
        : record.projects,
    additionalSections,
    hiddenAdditionalItemIds,
  };
}

function repairPreservedBullets(
  value: unknown,
  sourceBullets: Resume["experience"][number]["bullets"],
  baselineBullets: OptimizedBullet[],
): OptimizedBullet[] {
  const candidates = Array.isArray(value)
    ? value.filter(
        (bullet): bullet is Record<string, unknown> =>
          Boolean(bullet) && typeof bullet === "object" && !Array.isArray(bullet),
      )
    : [];
  const sourceIds = new Set(sourceBullets.map((bullet) => bullet.id));
  const sourceText = new Map(
    sourceBullets.map((bullet) => [bullet.id, bullet.text]),
  );
  const used = new Set<number>();

  return baselineBullets.flatMap((baseline) => {
    let candidateIndex = candidates.findIndex(
      (candidate, index) => !used.has(index) && candidate.id === baseline.id,
    );
    if (candidateIndex < 0) {
      candidateIndex = candidates.findIndex((candidate, index) => {
        if (used.has(index) || !Array.isArray(candidate.evidence)) return false;
        const evidence = candidate.evidence.filter(
          (id): id is string => typeof id === "string",
        );
        return (
          evidence.includes(baseline.id) ||
          baseline.evidence.some((id) => evidence.includes(id))
        );
      });
    }
    if (candidateIndex < 0) return [];
    used.add(candidateIndex);
    const candidate = candidates[candidateIndex];
    const evidence = baseline.evidence.filter((id) => sourceIds.has(id));
    if (evidence.length === 0 && sourceIds.has(baseline.id)) {
      evidence.push(baseline.id);
    }
    if (evidence.length === 0) return [];
    const evidenceText = [
      ...evidence.map((id) => sourceText.get(id) ?? ""),
      baseline.text,
    ].join(" ");
    const proposedText =
      typeof candidate.text === "string" && candidate.text.trim()
        ? candidate.text.trim()
        : baseline.text;
    return [
      {
        ...baseline,
        text: hasOnlyGroundedNumbers(proposedText, evidenceText)
          ? proposedText
          : baseline.text,
        evidence,
        matchedKeywords: Array.isArray(candidate.matchedKeywords)
          ? candidate.matchedKeywords.filter(
              (keyword): keyword is string => typeof keyword === "string",
            )
          : baseline.matchedKeywords,
        rationale:
          typeof candidate.rationale === "string"
            ? candidate.rationale
            : "Adjusted for the selected page target.",
      },
    ];
  });
}

function enforcePreservedFitSkeleton(
  value: unknown,
  resume: Resume,
  optimization: Optimization,
  protectedContentIds: string[],
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const plan = value as Record<string, unknown>;
  const rawRoles = Array.isArray(plan.roles) ? plan.roles : [];
  const rawProjects = Array.isArray(plan.projects) ? plan.projects : [];
  const rawAdditional = Array.isArray(plan.additionalSections)
    ? plan.additionalSections
    : [];
  const protectedIds = new Set(protectedContentIds);
  const allowedSkills = new Map(
    [...resume.skills, ...optimization.skills].map((skill) => [
      skill.trim().toLocaleLowerCase().replace(/\s+/g, " "),
      skill,
    ]),
  );
  const proposedSkills = Array.isArray(plan.skills)
    ? plan.skills.flatMap((skill) => {
        if (typeof skill !== "string") return [];
        const allowed = allowedSkills.get(
          skill.trim().toLocaleLowerCase().replace(/\s+/g, " "),
        );
        return allowed ? [allowed] : [];
      })
    : [];
  const skills = [...new Set(proposedSkills)];
  for (const skill of [...resume.skills, ...optimization.skills]) {
    const normalized = skill.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    if (
      protectedIds.has(`skill:${normalized}`) ||
      protectedIds.has(skill) ||
      protectedIds.has(normalized)
    ) {
      skills.push(skill);
    }
  }
  const uniqueSkills = [...new Set(skills)];
  if (uniqueSkills.length === 0) {
    const fallbackSkill = optimization.skills[0] ?? resume.skills[0];
    if (fallbackSkill) uniqueSkills.push(fallbackSkill);
  }
  const proposedSummary =
    typeof plan.summary === "string" ? plan.summary.trim() : "";
  const summary =
    !protectedIds.has("summary") &&
    proposedSummary &&
    hasOnlyGroundedNumbers(
      proposedSummary,
      `${resume.summary} ${optimization.summary}`,
    )
      ? proposedSummary
      : optimization.summary;

  const restoreProtectedBullets = (
    bullets: OptimizedBullet[],
    baseline: OptimizedBullet[],
    ownerId: string,
  ) => {
    if (protectedIds.has(ownerId)) return baseline.map((bullet) => ({ ...bullet }));
    const retained = new Map(bullets.map((bullet) => [bullet.id, bullet]));
    for (const bullet of baseline) {
      if (
        protectedIds.has(bullet.id) ||
        bullet.evidence.some((id) => protectedIds.has(id))
      ) {
        retained.set(bullet.id, { ...bullet });
      }
    }
    return baseline.flatMap((bullet) => {
      const retainedBullet = retained.get(bullet.id);
      return retainedBullet ? [retainedBullet] : [];
    });
  };

  const roles = resume.experience.map((sourceRole) => {
      const raw = rawRoles.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          (candidate as Record<string, unknown>).id === sourceRole.id,
      ) as Record<string, unknown> | undefined;
      const baseline = optimization.roles.find(
        (candidate) => candidate.id === sourceRole.id,
      );
      const baselineBullets =
        baseline?.bullets ?? sourceBulletsAsOptimization(sourceRole.bullets);
      const bullets = restoreProtectedBullets(
        repairPreservedBullets(
          raw?.bullets,
          sourceRole.bullets,
          baselineBullets,
        ),
        baselineBullets,
        sourceRole.id,
      );
      const ownerProtected =
        protectedIds.has(sourceRole.id) ||
        sourceRole.bullets.some((bullet) => protectedIds.has(bullet.id));
      return {
        id: sourceRole.id,
        hidden: ownerProtected ? false : raw?.hidden === true,
        collapsed:
          ownerProtected || bullets.length > 0 ? false : raw?.collapsed === true,
        bullets,
      };
    });
  if (roles.length > 0 && roles.every((role) => role.hidden)) {
    const retainedId =
      roles.find((role) => protectedIds.has(role.id))?.id ??
      newestRoleId(resume) ??
      roles[0].id;
    const retained = roles.find((role) => role.id === retainedId);
    if (retained) retained.hidden = false;
  }

  const projects = (resume.projects ?? []).map((sourceProject) => {
      const raw = rawProjects.find(
        (candidate) =>
          candidate &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          (candidate as Record<string, unknown>).id === sourceProject.id,
      ) as Record<string, unknown> | undefined;
      const baseline = optimization.projects.find(
        (candidate) => candidate.id === sourceProject.id,
      );
      const baselineBullets =
        baseline?.bullets ?? sourceBulletsAsOptimization(sourceProject.bullets);
      const bullets = restoreProtectedBullets(
        repairPreservedBullets(
          raw?.bullets,
          sourceProject.bullets,
          baselineBullets,
        ),
        baselineBullets,
        sourceProject.id,
      );
      const ownerProtected =
        protectedIds.has(sourceProject.id) ||
        sourceProject.bullets.some((bullet) => protectedIds.has(bullet.id));
      return {
        id: sourceProject.id,
        hidden: ownerProtected ? false : raw?.hidden === true,
        bullets,
      };
    });
  if (projects.length > 0 && projects.every((project) => project.hidden)) {
    projects[0].hidden = false;
  }

  const proposedHiddenAdditional = new Set(
    (Array.isArray(plan.hiddenAdditionalItemIds)
      ? plan.hiddenAdditionalItemIds
      : []
    ).filter((id): id is string => typeof id === "string"),
  );
  const additionalSections = (resume.additionalSections ?? []).map(
      (sourceSection) => {
        const rawSection = rawAdditional.find(
          (candidate) =>
            candidate &&
            typeof candidate === "object" &&
            !Array.isArray(candidate) &&
            (candidate as Record<string, unknown>).id === sourceSection.id,
        ) as Record<string, unknown> | undefined;
        const rawItems = Array.isArray(rawSection?.items)
          ? rawSection.items
          : [];
        const baselineSection = optimization.additionalSections?.find(
          (candidate) => candidate.id === sourceSection.id,
        );
        return {
          id: sourceSection.id,
          items: sourceSection.items.map((sourceItem) => {
            const rawItem = rawItems.find(
              (candidate) =>
                candidate &&
                typeof candidate === "object" &&
                !Array.isArray(candidate) &&
                (candidate as Record<string, unknown>).id === sourceItem.id,
            ) as Record<string, unknown> | undefined;
            const baselineItem = baselineSection?.items.find(
              (candidate) => candidate.id === sourceItem.id,
            );
            const baselineBullets =
              baselineItem?.bullets ??
              sourceBulletsAsOptimization(sourceItem.bullets);
            return {
              id: sourceItem.id,
              bullets: restoreProtectedBullets(
                repairPreservedBullets(
                  rawItem?.bullets,
                  sourceItem.bullets,
                  baselineBullets,
                ),
                baselineBullets,
                sourceItem.id,
              ),
            };
          }),
        };
      },
    );
  for (const section of resume.additionalSections ?? []) {
    const visibleItems = section.items.filter((item) => {
      const itemProtected =
        protectedIds.has(section.id) ||
        protectedIds.has(item.id) ||
        item.bullets.some((bullet) => protectedIds.has(bullet.id));
      if (itemProtected) proposedHiddenAdditional.delete(item.id);
      return !proposedHiddenAdditional.has(item.id);
    });
    if (section.items.length > 0 && visibleItems.length === 0) {
      proposedHiddenAdditional.delete(section.items[0].id);
    }
  }

  return {
    ...plan,
    summary,
    skills: uniqueSkills,
    roles,
    projects,
    additionalSections,
    hiddenAdditionalItemIds: [...proposedHiddenAdditional],
  };
}

function sourceBulletsAsOptimization(
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

/**
 * In role-optimized mode, source-only sections are folded into the system
 * schema at render time (for example AGENT / AI -> Skills and coursework ->
 * Education). The model still uses their source ids as a transport/evidence
 * envelope. Rebuild that envelope deterministically so a harmless omission in
 * model JSON is not mistaken for a protected-structure change.
 */
function enforceRoleOptimizedFitTransport({
  value,
  resume,
  optimization,
  targetPages,
  direction,
  protectedContentIds,
}: {
  value: unknown;
  resume: Resume;
  optimization: Optimization;
  targetPages: number;
  direction: "compress" | "expand";
  protectedContentIds: string[];
}): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const plan = value as Record<string, unknown>;
  const rawAdditional = Array.isArray(plan.additionalSections)
    ? plan.additionalSections
    : [];
  const validItemIds = new Set(
    (resume.additionalSections ?? []).flatMap((section) =>
      section.items.map((item) => item.id),
    ),
  );
  const hidden = new Set(
    (Array.isArray(plan.hiddenAdditionalItemIds)
      ? plan.hiddenAdditionalItemIds
      : []
    ).filter(
      (id): id is string => typeof id === "string" && validItemIds.has(id),
    ),
  );
  const protectedIds = new Set(protectedContentIds);
  const allowedSkills = new Map(
    [...resume.skills, ...optimization.skills].map((skill) => [
      skill.trim().toLocaleLowerCase().replace(/\s+/g, " "),
      skill,
    ]),
  );
  const skillBudget = targetPages === 1 ? 10 : targetPages === 2 ? 16 : 20;
  const skills = [
    ...new Set(
      (Array.isArray(plan.skills) ? plan.skills : []).flatMap((skill) => {
        if (typeof skill !== "string") return [];
        const allowed = allowedSkills.get(
          skill.trim().toLocaleLowerCase().replace(/\s+/g, " "),
        );
        return allowed ? [allowed] : [];
      }),
    ),
  ].slice(0, skillBudget);

  // In a role-optimized compressed document these source taxonomies are
  // already represented by the selected system Skills/Education fields. Do
  // not append the entire raw list again, which previously produced dozens of
  // skills and made a one-page target impossible.
  if (direction === "compress" && targetPages <= 3) {
    for (const section of resume.additionalSections ?? []) {
      const foldedIntoSystemSchema =
        isSupplementalSkillsSection(section) ||
        Boolean(supplementalEducationLabel(section.title));
      if (!foldedIntoSystemSchema) continue;
      for (const item of section.items) {
        const isProtected =
          protectedIds.has(section.id) ||
          protectedIds.has(item.id) ||
          item.bullets.some((bullet) => protectedIds.has(bullet.id));
        if (!isProtected) hidden.add(item.id);
      }
    }
  }

  return {
    ...plan,
    skills,
    additionalSections: (resume.additionalSections ?? []).map(
      (sourceSection) => {
        const rawSection = rawAdditional.find(
          (candidate) =>
            candidate &&
            typeof candidate === "object" &&
            !Array.isArray(candidate) &&
            (candidate as Record<string, unknown>).id === sourceSection.id,
        ) as Record<string, unknown> | undefined;
        const rawItems = Array.isArray(rawSection?.items)
          ? rawSection.items
          : [];
        const baselineSection = optimization.additionalSections?.find(
          (candidate) => candidate.id === sourceSection.id,
        );
        return {
          id: sourceSection.id,
          items: sourceSection.items.map((sourceItem) => {
            const rawItem = rawItems.find(
              (candidate) =>
                candidate &&
                typeof candidate === "object" &&
                !Array.isArray(candidate) &&
                (candidate as Record<string, unknown>).id === sourceItem.id,
            ) as Record<string, unknown> | undefined;
            const baselineItem = baselineSection?.items.find(
              (candidate) => candidate.id === sourceItem.id,
            );
            const baselineBullets =
              baselineItem?.bullets ??
              sourceBulletsAsOptimization(sourceItem.bullets);
            const proposedBullets =
              rawItem && Array.isArray(rawItem.bullets)
                ? rawItem.bullets
                : direction === "expand"
                  ? baselineBullets
                  : [];
            return {
              id: sourceItem.id,
              bullets: repairPreservedBullets(
                proposedBullets,
                sourceItem.bullets,
                baselineBullets,
              ),
            };
          }),
        };
      },
    ),
    hiddenAdditionalItemIds: direction === "compress" ? [...hidden] : [],
  };
}

function removeSemanticallyRejectedContent({
  plan,
  issues,
  optimization,
}: {
  plan: AiFitPlan;
  issues: string[];
  optimization: Optimization;
}): AiFitPlan | null {
  const rejected = new Set(
    issues.flatMap((issue) => {
      const match = issue.match(/^Semantic grounding failed for ([^:]+):/i);
      return match?.[1] ? [match[1].trim()] : [];
    }),
  );
  if (rejected.size === 0) return null;
  return {
    ...plan,
    summary: rejected.has("summary") ? optimization.summary : plan.summary,
    roles: plan.roles.map((role) => ({
      ...role,
      bullets: role.bullets.filter((bullet) => !rejected.has(bullet.id)),
    })),
    projects: plan.projects.map((project) => ({
      ...project,
      bullets: project.bullets.filter((bullet) => !rejected.has(bullet.id)),
    })),
    additionalSections: plan.additionalSections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        bullets: item.bullets.filter((bullet) => !rejected.has(bullet.id)),
      })),
    })),
  };
}

function originalBulletMap(resume: Resume) {
  const bullets = [
    ...resume.experience.flatMap((role) => role.bullets),
    ...(resume.projects ?? []).flatMap((project) => project.bullets),
    ...(resume.additionalSections ?? []).flatMap((section) =>
      section.items.flatMap((item) => item.bullets),
    ),
  ];
  return new Map(bullets.map((bullet) => [bullet.id, bullet.text]));
}

function optimizedBulletMap(optimization: Optimization) {
  return new Map(
    [
      ...optimization.roles.flatMap((role) => role.bullets),
      ...(optimization.projects ?? []).flatMap((project) => project.bullets),
      ...(optimization.additionalSections ?? []).flatMap((section) =>
        section.items.flatMap((item) => item.bullets),
      ),
    ].map((bullet) => [bullet.id, bullet]),
  );
}

function resumeCorpus(resume: Resume, optimization: Optimization): string {
  return JSON.stringify({ resume, optimization }).toLowerCase();
}

function groundedRequiredKeywords(
  resume: Resume,
  optimization: Optimization,
  job: JobAnalysis,
) {
  const corpus = resumeCorpus(resume, optimization);
  return job.requiredKeywords.filter((keyword) =>
    corpus.includes(keyword.toLowerCase()),
  );
}

function containsContentId(
  plan: AiFitPlan,
  resume: Resume,
  contentId: string,
): boolean {
  if (contentId.startsWith("skill:")) {
    const expected = contentId.slice("skill:".length);
    return plan.skills.some(
      (skill) =>
        skill.trim().toLowerCase().replace(/\s+/g, " ") === expected,
    );
  }
  if (
    plan.skills.some(
      (skill) => skill.toLowerCase() === contentId.toLowerCase(),
    )
  ) {
    return true;
  }
  if (
    plan.roles.some(
      (role) =>
        !role.hidden &&
        (role.id === contentId ||
          role.bullets.some(
            (bullet) =>
              bullet.id === contentId || bullet.evidence.includes(contentId),
          )),
    )
  ) {
    return true;
  }
  if (
    plan.projects.some(
      (project) =>
        (!project.hidden && project.id === contentId) ||
        (!project.hidden &&
          project.bullets.some(
            (bullet) =>
              bullet.id === contentId || bullet.evidence.includes(contentId),
          )),
    )
  ) {
    return true;
  }
  for (const section of plan.additionalSections) {
    if (section.id === contentId) {
      return section.items.some(
        (item) => !plan.hiddenAdditionalItemIds.includes(item.id),
      );
    }
    for (const item of section.items) {
      if (
        item.id === contentId ||
        item.bullets.some(
          (bullet) =>
            bullet.id === contentId || bullet.evidence.includes(contentId),
        )
      ) {
        return !plan.hiddenAdditionalItemIds.includes(item.id);
      }
    }
  }
  const isAdditionalItem = (resume.additionalSections ?? []).some((section) =>
    section.items.some((item) => item.id === contentId),
  );
  return (
    isAdditionalItem && !plan.hiddenAdditionalItemIds.includes(contentId)
  );
}

function hasOnlyGroundedNumbers(value: string, evidence: string): boolean {
  return numbersAreGrounded(value, evidence);
}

function dateRank(value: string): number {
  if (/(present|current|now|ongoing)/i.test(value)) {
    return Number.MAX_SAFE_INTEGER;
  }
  const years = value.match(/\b(?:19|20)\d{2}\b/g)?.map(Number) ?? [];
  return years.length > 0 ? Math.max(...years) : 0;
}

function newestRoleId(resume: Resume): string | null {
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

function validatePlan({
  plan,
  resume,
  optimization,
  job,
  keptContentIds,
  lockedContentIds,
  structureMode,
  direction,
}: {
  plan: AiFitPlan;
  resume: Resume;
  optimization: Optimization;
  job: JobAnalysis;
  keptContentIds: string[];
  lockedContentIds: string[];
  structureMode: ContentStructureMode;
  direction: "compress" | "expand";
}): string[] {
  const issues: string[] = [];
  if (!plan || typeof plan !== "object") {
    return ["The model did not return a page-fit object."];
  }
  if (typeof plan.summary !== "string") {
    issues.push("The page-fit plan is missing a summary.");
  }
  if (
    !Array.isArray(plan.skills) ||
    plan.skills.some((skill) => typeof skill !== "string")
  ) {
    issues.push("The page-fit plan has an invalid skills list.");
  }
  if (
    !Array.isArray(plan.roles) ||
    plan.roles.some(
      (role) =>
        !role ||
        typeof role.id !== "string" ||
        typeof role.hidden !== "boolean" ||
        typeof role.collapsed !== "boolean" ||
        !Array.isArray(role.bullets),
    )
  ) {
    const invalidRole = Array.isArray(plan.roles)
      ? plan.roles.find(
          (role) =>
            !role ||
            typeof role.id !== "string" ||
            typeof role.hidden !== "boolean" ||
            typeof role.collapsed !== "boolean" ||
            !Array.isArray(role.bullets),
        )
      : null;
    const received = !Array.isArray(plan.roles)
      ? `top-level keys: ${Object.keys(plan).join(", ") || "none"}`
      : invalidRole && typeof invalidRole === "object"
        ? `role keys: ${Object.keys(invalidRole).join(", ") || "none"}`
        : `role value type: ${typeof invalidRole}`;
    issues.push(`The page-fit plan has an invalid work-role list (${received}).`);
  }
  if (
    !Array.isArray(plan.projects) ||
    plan.projects.some(
      (project) =>
        !project ||
        typeof project.id !== "string" ||
        typeof project.hidden !== "boolean" ||
        !Array.isArray(project.bullets),
    )
  ) {
    issues.push("The page-fit plan has an invalid project list.");
  }
  if (!Array.isArray(plan.hiddenAdditionalItemIds)) {
    issues.push("The page-fit plan has an invalid additional-content list.");
  }
  if (
    !Array.isArray(plan.additionalSections) ||
    plan.additionalSections.some(
      (section) =>
        !section ||
        typeof section.id !== "string" ||
        !Array.isArray(section.items) ||
        section.items.some(
          (item) =>
            !item ||
            typeof item.id !== "string" ||
            !Array.isArray(item.bullets),
        ),
    )
  ) {
    issues.push("The page-fit plan has an invalid additional-section list.");
  }
  if (issues.length > 0) return issues;

  const evidence = originalBulletMap(resume);
  const roleIds = new Set(resume.experience.map((role) => role.id));
  const projectIds = new Set((resume.projects ?? []).map((project) => project.id));
  const returnedRoleIds = plan.roles.map((role) => role.id);
  const returnedProjectIds = plan.projects.map((project) => project.id);
  const protectedNewestRoleId = newestRoleId(resume);

  if (
    plan.roles.length !== roleIds.size ||
    new Set(returnedRoleIds).size !== roleIds.size ||
    returnedRoleIds.some((id) => !roleIds.has(id))
  ) {
    issues.push("Every work role must be returned exactly once.");
  }
  if (
    plan.projects.length !== projectIds.size ||
    new Set(returnedProjectIds).size !== projectIds.size ||
    returnedProjectIds.some((id) => !projectIds.has(id))
  ) {
    issues.push("Every project must be returned exactly once.");
  }

  const outputBulletIds = new Set<string>();
  plan.roles.forEach((role) => {
    const sourceRole = resume.experience.find((item) => item.id === role.id);
    const optimizedRole = optimization.roles.find(
      (item) => item.id === role.id,
    );
    const sourceBulletCount = Math.max(
      optimizedRole?.bullets.length ?? 0,
      sourceRole?.bullets.length ?? 0,
    );
    const minimum =
      structureMode === "preserve"
        ? 0
        : role.id === protectedNewestRoleId
          ? Math.min(2, sourceBulletCount)
          : Math.min(1, sourceBulletCount);
    if (structureMode === "optimize" && role.hidden && role.id === protectedNewestRoleId) {
      issues.push(`${role.id} is too recent to hide.`);
    } else if (
      structureMode === "optimize" &&
      role.collapsed &&
      role.id === protectedNewestRoleId
    ) {
      issues.push(`${role.id} is too recent to collapse.`);
    } else if (!role.hidden && !role.collapsed && role.bullets.length < minimum) {
      issues.push(`${role.id} does not meet its protected bullet minimum.`);
    }
    if (role.hidden) return;

    const ownerEvidence = new Set(
      sourceRole?.bullets.map((bullet) => bullet.id) ?? [],
    );
    const ownerOptimized = new Map(
      (optimizedRole?.bullets ?? []).map((bullet) => [bullet.id, bullet]),
    );
    for (const bullet of role.bullets) {
      if (
        !bullet ||
        typeof bullet.id !== "string" ||
        typeof bullet.text !== "string" ||
        !Array.isArray(bullet.evidence) ||
        bullet.evidence.some((id) => typeof id !== "string")
      ) {
        issues.push(`${role.id} contains an invalid bullet.`);
        continue;
      }
      if (outputBulletIds.has(bullet.id)) {
        issues.push(`Bullet ${bullet.id} was returned more than once.`);
      }
      outputBulletIds.add(bullet.id);
      if (!ownerOptimized.has(bullet.id) && !ownerEvidence.has(bullet.id)) {
        issues.push(`${bullet.id} does not belong to work role ${role.id}.`);
      }
      if (
        bullet.evidence.length === 0 ||
        bullet.evidence.some((id) => !ownerEvidence.has(id))
      ) {
        issues.push(`${bullet.id} cites evidence from another work role.`);
      }
      const evidenceText = [
        ...bullet.evidence.map((id) => evidence.get(id) ?? ""),
        ownerOptimized.get(bullet.id)?.text ?? "",
      ].join(" ");
      if (!hasOnlyGroundedNumbers(bullet.text, evidenceText)) {
        issues.push(`${bullet.id} introduces an unsupported number.`);
      }
    }
  });

  plan.projects.forEach((project) => {
    if (project.hidden) return;
    const sourceProject = (resume.projects ?? []).find(
      (item) => item.id === project.id,
    );
    const optimizedProject = (optimization.projects ?? []).find(
      (item) => item.id === project.id,
    );
    const ownerEvidence = new Set(
      sourceProject?.bullets.map((bullet) => bullet.id) ?? [],
    );
    const ownerOptimized = new Map(
      (optimizedProject?.bullets ?? []).map((bullet) => [bullet.id, bullet]),
    );
    for (const bullet of project.bullets) {
      if (
        !bullet ||
        typeof bullet.id !== "string" ||
        typeof bullet.text !== "string" ||
        !Array.isArray(bullet.evidence) ||
        bullet.evidence.some((id) => typeof id !== "string")
      ) {
        issues.push(`${project.id} contains an invalid bullet.`);
        continue;
      }
      if (outputBulletIds.has(bullet.id)) {
        issues.push(`Bullet ${bullet.id} was returned more than once.`);
      }
      outputBulletIds.add(bullet.id);
      if (!ownerOptimized.has(bullet.id) && !ownerEvidence.has(bullet.id)) {
        issues.push(`${bullet.id} does not belong to project ${project.id}.`);
      }
      if (
        bullet.evidence.length === 0 ||
        bullet.evidence.some((id) => !ownerEvidence.has(id))
      ) {
        issues.push(`${bullet.id} cites evidence from another project.`);
      }
      const evidenceText = [
        ...bullet.evidence.map((id) => evidence.get(id) ?? ""),
        ownerOptimized.get(bullet.id)?.text ?? "",
      ].join(" ");
      if (!hasOnlyGroundedNumbers(bullet.text, evidenceText)) {
        issues.push(`${bullet.id} introduces an unsupported number.`);
      }
    }
  });

  const additionalSectionIds = new Set(
    (resume.additionalSections ?? []).map((section) => section.id),
  );
  const returnedAdditionalSectionIds = plan.additionalSections.map(
    (section) => section.id,
  );
  if (
    plan.additionalSections.length !== additionalSectionIds.size ||
    new Set(returnedAdditionalSectionIds).size !== additionalSectionIds.size ||
    returnedAdditionalSectionIds.some((id) => !additionalSectionIds.has(id))
  ) {
    issues.push("Every additional section must be returned exactly once.");
  }
  for (const section of plan.additionalSections) {
    const sourceSection = (resume.additionalSections ?? []).find(
      (candidate) => candidate.id === section.id,
    );
    const optimizedSection = (optimization.additionalSections ?? []).find(
      (candidate) => candidate.id === section.id,
    );
    const sourceItemIds = new Set(
      sourceSection?.items.map((item) => item.id) ?? [],
    );
    if (
      section.items.length !== sourceItemIds.size ||
      new Set(section.items.map((item) => item.id)).size !==
        sourceItemIds.size ||
      section.items.some((item) => !sourceItemIds.has(item.id))
    ) {
      issues.push(`${section.id} must return every item exactly once.`);
    }
    for (const item of section.items) {
      if (plan.hiddenAdditionalItemIds.includes(item.id)) continue;
      const sourceItem = sourceSection?.items.find(
        (candidate) => candidate.id === item.id,
      );
      const optimizedItem = optimizedSection?.items.find(
        (candidate) => candidate.id === item.id,
      );
      const ownerEvidence = new Set(
        sourceItem?.bullets.map((bullet) => bullet.id) ?? [],
      );
      const ownerOptimized = new Map(
        (optimizedItem?.bullets ?? []).map((bullet) => [bullet.id, bullet]),
      );
      for (const bullet of item.bullets) {
        if (
          !bullet ||
          typeof bullet.id !== "string" ||
          typeof bullet.text !== "string" ||
          !Array.isArray(bullet.evidence) ||
          bullet.evidence.some((id) => typeof id !== "string")
        ) {
          issues.push(`${item.id} contains an invalid bullet.`);
          continue;
        }
        if (outputBulletIds.has(bullet.id)) {
          issues.push(`Bullet ${bullet.id} was returned more than once.`);
        }
        outputBulletIds.add(bullet.id);
        if (!ownerOptimized.has(bullet.id) && !ownerEvidence.has(bullet.id)) {
          issues.push(`${bullet.id} does not belong to item ${item.id}.`);
        }
        if (
          bullet.evidence.length === 0 ||
          bullet.evidence.some((id) => !ownerEvidence.has(id))
        ) {
          issues.push(`${bullet.id} cites evidence from another item.`);
        }
        const evidenceText = [
          ...bullet.evidence.map((id) => evidence.get(id) ?? ""),
          ownerOptimized.get(bullet.id)?.text ?? "",
        ].join(" ");
        if (!hasOnlyGroundedNumbers(bullet.text, evidenceText)) {
          issues.push(`${bullet.id} introduces an unsupported number.`);
        }
      }
    }
  }

  if (
    direction === "expand" &&
    (plan.roles.some((role) => role.hidden || role.collapsed) ||
      plan.projects.some((project) => project.hidden) ||
      plan.hiddenAdditionalItemIds.length > 0)
  ) {
    issues.push("Expansion cannot hide or collapse content.");
  }

  const allowedSkills = new Set(
    [...resume.skills, ...optimization.skills].map((skill) =>
      skill.trim().toLowerCase(),
    ),
  );
  if (
    plan.skills.some(
      (skill) => !allowedSkills.has(skill.trim().toLowerCase()),
    )
  ) {
    issues.push("The page-fit plan introduced a skill absent from the resume.");
  }
  if (
    !hasOnlyGroundedNumbers(
      plan.summary,
      `${resume.summary} ${optimization.summary}`,
    )
  ) {
    issues.push("The page-fit summary introduced an unsupported number.");
  }

  const additionalItemIds = new Set(
    (resume.additionalSections ?? []).flatMap((section) =>
      section.items.map((item) => item.id),
    ),
  );
  if (
    new Set(plan.hiddenAdditionalItemIds).size !==
      plan.hiddenAdditionalItemIds.length ||
    plan.hiddenAdditionalItemIds.some((id) => !additionalItemIds.has(id))
  ) {
    issues.push("The page-fit plan returned an invalid additional item id.");
  }

  for (const id of keptContentIds) {
    if (!containsContentId(plan, resume, id)) {
      issues.push(`User-kept content ${id} was removed.`);
    }
    const keptRole = resume.experience.find((role) => role.id === id);
    if (keptRole) {
      for (const bullet of keptRole.bullets) {
        if (!containsContentId(plan, resume, bullet.id)) {
          issues.push(`User-kept role ${id} lost bullet ${bullet.id}.`);
        }
      }
    }
    const keptProject = (resume.projects ?? []).find(
      (project) => project.id === id,
    );
    if (keptProject) {
      for (const bullet of keptProject.bullets) {
        if (!containsContentId(plan, resume, bullet.id)) {
          issues.push(`User-kept project ${id} lost bullet ${bullet.id}.`);
        }
      }
    }
  }

  const isEarlyCareer = resume.experience.length <= 1;
  if (
    isEarlyCareer &&
    (resume.projects ?? []).length > 0 &&
    plan.projects.every((project) => project.hidden)
  ) {
    issues.push("Early-career resumes must keep at least one project.");
  }


  const documents = createFittedDocuments({ plan, resume, optimization });
  issues.push(
    ...validateLockedOptimization({
      resume,
      candidate: documents.fittedOptimization,
      baseline: optimization,
      lockedContentIds,
    }),
  );

  if (structureMode === "preserve") {
    issues.push(
      ...validatePreservedFitOptimization(
        resume,
        documents.fittedOptimization,
        optimization,
      ),
    );
  }

  return [...new Set(issues)];
}

function createFittedDocuments({
  plan,
  resume,
  optimization,
}: {
  plan: AiFitPlan;
  resume: Resume;
  optimization: Optimization;
}) {
  const rolePlans = new Map(plan.roles.map((role) => [role.id, role]));
  const projectPlans = new Map(
    plan.projects.map((project) => [project.id, project]),
  );
  const additionalSectionPlans = new Map(
    plan.additionalSections.map((section) => [section.id, section]),
  );
  const fittedResume: Resume = {
    ...resume,
    summary: plan.summary,
    skills: [...plan.skills],
    experience: resume.experience
      .filter((role) => !rolePlans.get(role.id)?.hidden)
      .map((role) => {
        const fit = rolePlans.get(role.id);
        const bullets =
          fit?.collapsed
            ? []
            : (fit?.bullets ?? []).map((bullet) => ({
                id: bullet.id,
                text: bullet.text,
              }));
        const retainedIds = new Set(bullets.map((bullet) => bullet.id));
        const teams = (role.teams ?? [])
          .map((team) => ({
            ...team,
            bulletIds: team.bulletIds.filter((id) => retainedIds.has(id)),
          }))
          .filter((team) => team.bulletIds.length > 0);
        const { teams: _teams, ...roleRest } = role;
        return {
          ...roleRest,
          bullets,
          ...(teams.length > 0 ? { teams } : {}),
        };
      }),
    projects: (resume.projects ?? [])
      .filter((project) => !projectPlans.get(project.id)?.hidden)
      .map((project) => ({
        ...project,
        bullets: (projectPlans.get(project.id)?.bullets ?? []).map(
          (bullet) => ({
            id: bullet.id,
            text: bullet.text,
          }),
        ),
      })),
    additionalSections: (resume.additionalSections ?? [])
      .map((section) => ({
        ...section,
        items: section.items
          .filter((item) => !plan.hiddenAdditionalItemIds.includes(item.id))
          .map((item) => {
            const fit = additionalSectionPlans
              .get(section.id)
              ?.items.find((candidate) => candidate.id === item.id);
            return {
              ...item,
              bullets: (fit?.bullets ?? item.bullets).map((bullet) => ({
                id: bullet.id,
                text: bullet.text,
              })),
            };
          }),
      }))
      .filter((section) => section.items.length > 0),
  };

  const selectedSkillKeys = new Set(
    plan.skills.map((skill) => skill.trim().toLocaleLowerCase().replace(/\s+/g, " ")),
  );
  const fittedOptimization: Optimization = {
    ...optimization,
    summary: plan.summary,
    skills: [...plan.skills],
    skillEvidence: (optimization.skillEvidence ?? []).filter((item) =>
      selectedSkillKeys.has(
        item.skill.trim().toLocaleLowerCase().replace(/\s+/g, " "),
      ),
    ),
    roles: plan.roles
      .filter((role) => !role.hidden)
      .map((role) => ({
        id: role.id,
        bullets: role.collapsed ? [] : role.bullets,
      })),
    projects: plan.projects
      .filter((project) => !project.hidden)
      .map((project) => ({
        id: project.id,
        bullets: project.bullets,
      })),
    additionalSections: plan.additionalSections
      .map((section) => ({
        id: section.id,
        items: section.items
          .filter(
            (item) => !plan.hiddenAdditionalItemIds.includes(item.id),
          )
          .map((item) => ({
            id: item.id,
            bullets: item.bullets,
          })),
      }))
      .filter((section) => section.items.length > 0),
  };
  return { fittedResume, fittedOptimization };
}

function createPreservedLowerBoundDocuments(
  resume: Resume,
  optimization: Optimization,
) {
  // Keep-original locks section headings and order, but not every entry. This
  // lower bound keeps one minimal entry under each detected content section.
  // If even this smaller document exceeds the target, the requested page count
  // is not achievable without deleting a source heading or harming readability.
  const fittedResume: Resume = {
    ...resume,
    summary: "",
    skills: [],
    experience: resume.experience.slice(0, 1).map((role) => {
      const { teams: _teams, ...roleRest } = role;
      return { ...roleRest, bullets: [] };
    }),
    projects: (resume.projects ?? []).slice(0, 1).map((project) => ({
      ...project,
      bullets: [],
    })),
    additionalSections: (resume.additionalSections ?? []).map((section) => ({
      ...section,
      items: section.items.slice(0, 1).map((item) => ({ ...item, bullets: [] })),
    })),
  };
  const fittedOptimization: Optimization = {
    ...optimization,
    summary: "",
    skills: [],
    skillEvidence: [],
    roles: resume.experience.slice(0, 1).map((role) => ({ id: role.id, bullets: [] })),
    projects: (resume.projects ?? []).slice(0, 1).map((project) => ({
      id: project.id,
      bullets: [],
    })),
    additionalSections: (resume.additionalSections ?? []).map((section) => ({
      id: section.id,
      items: section.items.slice(0, 1).map((item) => ({ id: item.id, bullets: [] })),
    })),
  };
  return { fittedResume, fittedOptimization };
}

function describeRole(role: Resume["experience"][number]): string {
  return [role.company, role.title].filter(Boolean).join(" — ");
}

function createChanges({
  plan,
  resume,
  optimization,
}: {
  plan: AiFitPlan;
  resume: Resume;
  optimization: Optimization;
}): ResumeFitChange[] {
  const changes: ResumeFitChange[] = [];
  const oldBullets = optimizedBulletMap(optimization);
  const nextBullets = new Map(
    [
      ...plan.roles.flatMap((role) => role.bullets),
      ...plan.projects.flatMap((project) => project.bullets),
      ...plan.additionalSections.flatMap((section) =>
        section.items.flatMap((item) => item.bullets),
      ),
    ].map((bullet) => [bullet.id, bullet]),
  );

  if (plan.summary !== optimization.summary) {
    changes.push({
      id: "fit-summary",
      kind:
        plan.summary.length <= optimization.summary.length
          ? "shortened"
          : "expanded",
      targetType: "summary",
      targetId: "summary",
      label: "Professional summary",
      before: optimization.summary,
      after: plan.summary,
      reason: "Adjusted the summary to support the exact page target.",
      evidence: [],
    });
  }

  for (const [id, before] of oldBullets) {
    const after = nextBullets.get(id);
    if (!after) {
      changes.push({
        id: `fit-hidden-${id}`,
        kind: "hidden",
        targetType: "bullet",
        targetId: id,
        label: before.text,
        before: before.text,
        after: "",
        reason: "Lower priority for this target role and page limit.",
        evidence: before.evidence,
      });
    } else if (after.text !== before.text) {
      changes.push({
        id: `fit-rewrite-${id}`,
        kind:
          after.text.length <= before.text.length ? "shortened" : "expanded",
        targetType: "bullet",
        targetId: id,
        label: after.text,
        before: before.text,
        after: after.text,
        reason: after.rationale || "Rewritten to fit the selected page count.",
        evidence: after.evidence,
      });
    }
  }

  for (const role of plan.roles.filter((candidate) => candidate.hidden)) {
    const source = resume.experience.find((candidate) => candidate.id === role.id);
    if (!source) continue;
    changes.push({
      id: `fit-hidden-role-${role.id}`,
      kind: "hidden",
      targetType: "role",
      targetId: role.id,
      label: describeRole(source),
      before: source.bullets.map((bullet) => bullet.text).join(" "),
      after: "",
      reason: "Lower priority than the retained experience for this page limit.",
      evidence: source.bullets.map((bullet) => bullet.id),
    });
  }

  for (const role of plan.roles.filter(
    (candidate) => !candidate.hidden && candidate.collapsed,
  )) {
    const source = resume.experience.find((candidate) => candidate.id === role.id);
    if (!source) continue;
    changes.push({
      id: `fit-collapsed-${role.id}`,
      kind: "collapsed",
      targetType: "role",
      targetId: role.id,
      label: describeRole(source),
      before: source.bullets.map((bullet) => bullet.text).join(" "),
      after: `Earlier Experience: ${source.title}, ${source.company}`,
      reason: "Collapsed older, lower-relevance experience while keeping metadata.",
      evidence: source.bullets.map((bullet) => bullet.id),
    });
  }

  for (const project of plan.projects.filter((candidate) => candidate.hidden)) {
    const source = (resume.projects ?? []).find(
      (candidate) => candidate.id === project.id,
    );
    if (!source) continue;
    changes.push({
      id: `fit-project-${project.id}`,
      kind: "hidden",
      targetType: "project",
      targetId: project.id,
      label: source.name,
      before: source.bullets.map((bullet) => bullet.text).join(" "),
      after: "",
      reason: "Lower relevance than the retained evidence for this target role.",
      evidence: source.bullets.map((bullet) => bullet.id),
    });
  }

  for (const itemId of plan.hiddenAdditionalItemIds) {
    const item = (resume.additionalSections ?? [])
      .flatMap((section) => section.items)
      .find((candidate) => candidate.id === itemId);
    if (!item) continue;
    changes.push({
      id: `fit-additional-${itemId}`,
      kind: "hidden",
      targetType: "additional",
      targetId: itemId,
      label: item.heading,
      before: item.heading,
      after: "",
      reason: "Optional content with lower target-role relevance.",
      evidence: item.bullets.map((bullet) => bullet.id),
    });
  }

  const nextSkills = new Set(plan.skills.map((skill) => skill.toLowerCase()));
  for (const skill of optimization.skills) {
    if (nextSkills.has(skill.toLowerCase())) continue;
    changes.push({
      id: `fit-skill-${skill.toLowerCase().replace(/\W+/g, "-")}`,
      kind: "hidden",
      targetType: "skill",
      targetId: skill,
      label: skill,
      before: skill,
      after: "",
      reason: "Removed a lower-priority or duplicate skill.",
      evidence: [],
    });
  }
  return changes;
}

function firstVerifiedSentences(value: string, count: number): string {
  const text = value.trim();
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, Math.max(1, count)).join(" ");
}

function deterministicBulletSelection({
  baseline,
  source,
  limit,
  ownerId,
  protectedIds,
}: {
  baseline: OptimizedBullet[];
  source: Resume["experience"][number]["bullets"];
  limit: number;
  ownerId: string;
  protectedIds: Set<string>;
}): OptimizedBullet[] {
  const available =
    baseline.length > 0 ? baseline : sourceBulletsAsOptimization(source);
  if (protectedIds.has(ownerId)) {
    return available.map((bullet) => ({ ...bullet }));
  }
  const selected = new Set(
    available.flatMap((bullet) =>
      protectedIds.has(bullet.id) ||
      bullet.evidence.some((id) => protectedIds.has(id))
        ? [bullet.id]
        : [],
    ),
  );
  const ranked = available
    .map((bullet, index) => ({
      bullet,
      score:
        bullet.matchedKeywords.length * 5 +
        (/\d/.test(bullet.text) ? 2 : 0) +
        Math.max(0, 1 - index / 100),
    }))
    .sort((left, right) => right.score - left.score);
  for (const { bullet } of ranked) {
    if (selected.size >= limit) break;
    selected.add(bullet.id);
  }
  return available
    .filter((bullet) => selected.has(bullet.id))
    .map((bullet) => ({ ...bullet }));
}

/**
 * A model-independent safety net for compression. It never invents or
 * rewrites facts: it selects a grounded subset of the already validated full
 * optimization. This keeps exact-page fitting usable when a provider times
 * out or returns malformed JSON.
 */
function createDeterministicCompressionPlan({
  resume,
  optimization,
  targetPages,
  structureMode,
  protectedContentIds,
  intensity,
}: {
  resume: Resume;
  optimization: Optimization;
  targetPages: number;
  structureMode: ContentStructureMode;
  protectedContentIds: string[];
  intensity: "moderate" | "decisive";
}): AiFitPlan {
  const protectedIds = new Set(protectedContentIds);
  const decisive = intensity === "decisive";
  const newestId = newestRoleId(resume);
  const roleBudget = Math.max(1, targetPages * (decisive ? 1 : 2));
  const projectBudget = Math.max(1, targetPages * (decisive ? 1 : 2));
  const defaultRoleIds = new Set(
    [
      ...new Set([
        ...(newestId ? [newestId] : []),
        ...resume.experience.map((role) => role.id),
      ]),
    ].slice(0, roleBudget),
  );
  const defaultProjectIds = new Set(
    (resume.projects ?? []).slice(0, projectBudget).map((project) => project.id),
  );
  const skillBudget = Math.max(
    1,
    targetPages === 1
      ? decisive
        ? 6
        : 9
      : targetPages * (decisive ? 6 : 8),
  );
  const selectedSkills = new Set(optimization.skills.slice(0, skillBudget));
  for (const skill of [...resume.skills, ...optimization.skills]) {
    const normalized = skill.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    if (
      protectedIds.has(skill) ||
      protectedIds.has(normalized) ||
      protectedIds.has(`skill:${normalized}`)
    ) {
      selectedSkills.add(skill);
    }
  }
  if (selectedSkills.size === 0) {
    const fallback = optimization.skills[0] ?? resume.skills[0];
    if (fallback) selectedSkills.add(fallback);
  }

  const roles = resume.experience.map((sourceRole) => {
    const baseline = optimization.roles.find(
      (role) => role.id === sourceRole.id,
    );
    const ownerProtected =
      protectedIds.has(sourceRole.id) ||
      sourceRole.bullets.some((bullet) => protectedIds.has(bullet.id));
    const hidden = !ownerProtected && !defaultRoleIds.has(sourceRole.id);
    const bulletLimit =
      structureMode === "optimize" && sourceRole.id === newestId
        ? Math.min(2, Math.max(baseline?.bullets.length ?? 0, sourceRole.bullets.length))
        : decisive
          ? 1
          : 2;
    return {
      id: sourceRole.id,
      hidden,
      collapsed: false,
      bullets: deterministicBulletSelection({
        baseline: baseline?.bullets ?? [],
        source: sourceRole.bullets,
        limit: hidden ? 0 : bulletLimit,
        ownerId: sourceRole.id,
        protectedIds,
      }),
    };
  });

  const projects = (resume.projects ?? []).map((sourceProject) => {
    const baseline = optimization.projects.find(
      (project) => project.id === sourceProject.id,
    );
    const ownerProtected =
      protectedIds.has(sourceProject.id) ||
      sourceProject.bullets.some((bullet) => protectedIds.has(bullet.id));
    const hidden = !ownerProtected && !defaultProjectIds.has(sourceProject.id);
    return {
      id: sourceProject.id,
      hidden,
      bullets: deterministicBulletSelection({
        baseline: baseline?.bullets ?? [],
        source: sourceProject.bullets,
        limit: hidden ? 0 : decisive ? 1 : 2,
        ownerId: sourceProject.id,
        protectedIds,
      }),
    };
  });

  const hiddenAdditionalItemIds: string[] = [];
  const additionalSections = (resume.additionalSections ?? []).map(
    (sourceSection) => {
      const baselineSection = optimization.additionalSections?.find(
        (section) => section.id === sourceSection.id,
      );
      const protectedItems = sourceSection.items.filter(
        (item) =>
          protectedIds.has(sourceSection.id) ||
          protectedIds.has(item.id) ||
          item.bullets.some((bullet) => protectedIds.has(bullet.id)),
      );
      const defaultVisibleIds = new Set(
        structureMode === "preserve"
          ? [sourceSection.items[0]?.id, ...protectedItems.map((item) => item.id)].filter(
              (id): id is string => Boolean(id),
            )
          : protectedItems.map((item) => item.id),
      );
      return {
        id: sourceSection.id,
        items: sourceSection.items.map((sourceItem) => {
          const hidden = !defaultVisibleIds.has(sourceItem.id);
          if (hidden) hiddenAdditionalItemIds.push(sourceItem.id);
          const baselineItem = baselineSection?.items.find(
            (item) => item.id === sourceItem.id,
          );
          return {
            id: sourceItem.id,
            bullets: deterministicBulletSelection({
              baseline: baselineItem?.bullets ?? [],
              source: sourceItem.bullets,
              limit: hidden ? 0 : decisive ? 0 : 1,
              ownerId: sourceItem.id,
              protectedIds,
            }),
          };
        }),
      };
    },
  );

  const fullSummary = optimization.summary || resume.summary;
  return {
    summary: protectedIds.has("summary")
      ? fullSummary
      : firstVerifiedSentences(fullSummary, decisive ? 1 : 2),
    skills: [...selectedSkills],
    roles,
    projects,
    additionalSections,
    hiddenAdditionalItemIds,
  };
}

function fitAtsScore({
  resume,
  optimization,
  job,
  requiredKeywords,
}: {
  resume: Resume;
  optimization: Optimization;
  job: JobAnalysis;
  requiredKeywords?: string[];
}): number {
  const text = resumeCorpus(resume, optimization);
  const grounded =
    requiredKeywords ??
    groundedRequiredKeywords(resume, optimization, job);
  const keywordScore =
    grounded.length === 0
      ? 100
      : (grounded.filter((keyword) => text.includes(keyword.toLowerCase()))
          .length /
          grounded.length) *
        100;
  const bullets = [
    ...optimization.roles.flatMap((role) => role.bullets),
    ...(optimization.projects ?? []).flatMap((project) => project.bullets),
    ...(optimization.additionalSections ?? []).flatMap((section) =>
      section.items.flatMap((item) => item.bullets),
    ),
  ];
  const impactScore =
    bullets.length === 0
      ? 50
      : (bullets.filter((bullet) => /\d/.test(bullet.text)).length /
          bullets.length) *
        100;
  const actionScore =
    bullets.length === 0
      ? 50
      : (bullets.filter((bullet) =>
          /^(Led|Built|Shipped|Owned|Drove|Designed|Migrated|Architected|Mentored|Partnered|Created|Developed|Implemented)/i.test(
            bullet.text,
          ),
        ).length /
          bullets.length) *
        100;
  const titleWords = job.title
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 2);
  const roleScore =
    titleWords.length === 0
      ? 85
      : (titleWords.filter((word) => text.includes(word)).length /
          titleWords.length) *
        100;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        keywordScore * 0.4 +
          impactScore * 0.15 +
          actionScore * 0.15 +
          roleScore * 0.2 +
          95 * 0.1,
      ),
    ),
  );
}

async function measure({
  style,
  palette,
  resume,
  optimization,
  page,
  targetPages,
  personalizedStyleProfile,
}: {
  style: PdfStyle;
  palette?: string;
  resume: Resume;
  optimization: Optimization;
  page: ResumePageSpec;
  targetPages: number;
  personalizedStyleProfile?: ResumeStyleProfile | null;
}): Promise<Measured> {
  if (style === "personalized") {
    if (!personalizedStyleProfile) {
      throw new Error("Personalized style is not ready.");
    }
    try {
      const buffer = await renderPersonalizedPdf({
        styleProfile: {
          ...personalizedStyleProfile,
          page,
        },
        resume,
        optimization,
        targetPages,
        allowMinimumTypography: true,
      });
      const pageCount = (await PDFDocument.load(buffer)).getPageCount();
      return {
        pageCount,
        density: "source",
        observedPages: [pageCount],
      };
    } catch (error) {
      console.warn(
        "original-inspired measurement fell back to a safe fixed layout",
        error,
      );
      const fallbackStyle: FixedPdfStyle =
        personalizedStyleProfile.layout === "single-column"
          ? "classic"
          : "sidebar";
      return measure({
        style: fallbackStyle,
        resume,
        optimization,
        page,
        targetPages,
      });
    }
  }

  const selectedPalette = getResumePalette(
    style as FixedPdfStyle,
    palette,
  );
  const candidates = await renderFixedCandidates({
    style: style as FixedPdfStyle,
    palette: selectedPalette,
    resume,
    optimization,
    page,
  });
  const exact = candidates.find(
    (candidate) => candidate.pageCount === targetPages,
  );
  const maximumObserved = Math.max(
    ...candidates.map((candidate) => candidate.pageCount),
  );
  const balanced =
    !exact && targetPages > maximumObserved
      ? await renderFixedBalanced({
          style: style as FixedPdfStyle,
          palette: selectedPalette,
          resume,
          optimization,
          page,
          targetPages,
        })
      : null;
  const standard =
    candidates.find((candidate) => candidate.density === "standard") ??
    candidates[0];
  return {
    pageCount: exact?.pageCount ?? balanced?.pageCount ?? standard.pageCount,
    density: exact?.density ?? balanced?.density ?? standard.density,
    observedPages: [
      ...candidates.map((candidate) => candidate.pageCount),
      ...(balanced ? [balanced.pageCount] : []),
    ],
  };
}

function fitUserPrompt({
  resume,
  optimization,
  job,
  report,
  targetPages,
  direction,
  attempt,
  measuredPages,
  keptContentIds,
  priorityContentIds,
  lockedContentIds,
  structureMode,
  previousPlan,
}: {
  resume: Resume;
  optimization: Optimization;
  job: JobAnalysis;
  report: AtsReport;
  targetPages: number;
  direction: "compress" | "expand";
  attempt: number;
  measuredPages: number;
  keptContentIds: string[];
  priorityContentIds: string[];
  lockedContentIds: string[];
  structureMode: ContentStructureMode;
  previousPlan: AiFitPlan | null;
}) {
  const intensity =
    attempt === 1 ? "conservative" : attempt === 2 ? "moderate" : "decisive";
  return `Target: exactly ${targetPages} page(s).
Current measured result: ${measuredPages} page(s).
Direction: ${direction}.
Adjustment intensity: ${intensity}.
Content structure mode: ${structureMode === "preserve" ? "KEEP ORIGINAL" : "OPTIMIZE FOR ROLE"}.

If compressing, shorten language before hiding content. Remove duplicate or generic evidence before unique, quantified, job-relevant evidence. If expanding, restore full evidence and write more complete but still concise bullets without adding facts.

${
  structureMode === "preserve"
    ? `KEEP ORIGINAL preserves every detected section heading and the original section order; it does NOT lock every content entry. Never add, delete, rename, merge, split, or reorder section headings. To meet the exact page target, first shorten wording and spacing; then you MAY remove lower-priority skills and bullets, collapse a role to metadata only, or hide lower-priority work roles, projects, and additional items. Leave at least one visible value or entry under every source heading so no heading disappears. Return every source owner id in the JSON transport even when hidden. Keep retained bullet ids inside their original owner and preserve their evidence. Never remove user-kept, user-edited, or locked content. On moderate and decisive compression, reduce content aggressively enough to reach the requested page count.`
    : ""
}

User-kept content ids: ${JSON.stringify(keptContentIds)}
User-edited/high-priority ids: ${JSON.stringify(priorityContentIds)}
Locked content ids (copy their complete optimized text verbatim): ${JSON.stringify(lockedContentIds)}
Protected newest work role id: ${JSON.stringify(newestRoleId(resume))}
Grounded required keywords: ${JSON.stringify(
    groundedRequiredKeywords(resume, optimization, job),
  )}
ATS context: ${JSON.stringify({
    currentScore: report.overallAfter,
    missingKeywords: report.missingKeywords,
  })}

Original resume:
${JSON.stringify(resume)}

Complete optimized master:
${JSON.stringify(optimization)}

Target job:
${JSON.stringify(job)}

${
  previousPlan
    ? `Previous page-fit plan to revise based on the measured result:\n${JSON.stringify(previousPlan)}`
    : ""
}`;
}

function conflictResponse({
  targetPages,
  observed,
  reasons,
}: {
  targetPages: number;
  observed: number[];
  reasons: string[];
}) {
  const valid = observed.filter((value) => Number.isInteger(value) && value > 0);
  const min = valid.length > 0 ? Math.min(...valid) : 1;
  const max = valid.length > 0 ? Math.max(...valid) : targetPages;
  const conflict: FitConflict = {
    message: `Could not produce an evidence-safe, readable ${targetPages}-page version.`,
    reasons:
      reasons.length > 0
        ? [...new Set(reasons.map(publicFitIssue))].slice(0, 8)
        : [
            "The selected page count conflicts with protected content or the safe typography limits.",
          ],
    recommendedRange: { min, max: Math.max(min, max) },
    observedPages: [...new Set(valid)].sort((a, b) => a - b),
  };
  return NextResponse.json({ conflict }, { status: 409 });
}

function publicFitIssue(issue: string): string {
  if (/did not return the page-fit rewrite/i.test(issue)) {
    return "The selected model took too long to produce this page-fit rewrite. Retry or choose another model.";
  }
  if (/keeping every detected section heading exceeds/i.test(issue)) {
    return "Even with each section reduced to its smallest readable content, the original headings need more than one page. Choose 2 pages or Optimize for role.";
  }
  if (/unsupported number/i.test(issue)) {
    return "A rewrite introduced a number that was not supported by its source evidence.";
  }
  if (/locked/i.test(issue)) {
    return "A manually edited field changed, so the proposal was rejected.";
  }
  if (/user-kept/i.test(issue)) {
    return "The proposal removed part of an item you marked Keep.";
  }
  if (/skill/i.test(issue)) {
    return "The proposed skills were not fully grounded in the uploaded resume.";
  }
  if (/role|project|bullet|evidence|item/i.test(issue)) {
    return "A rewritten achievement could not be matched safely to its original entry.";
  }
  if (/structure|section/i.test(issue)) {
    return "The proposal changed a protected part of the resume structure.";
  }
  return "The proposal did not pass the evidence-safety checks.";
}

export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, FIT_LIMIT);
  if (limited) return limited;

  const entitlement = await requirePaidOrder(req);
  if (!entitlement.ok) return entitlement.response;

  try {

    const body = (await req.json()) as FitRequest;
    const {
      resume,
      optimization,
      job,
      report,
      model,
      style,
      palette,
      targetPages,
      personalizedStyleProfile,
    } = body;
    if (
      !resume?.name ||
      !optimization ||
      !job ||
      !report ||
      !model ||
      !isPdfStyle(style) ||
      !Number.isInteger(targetPages) ||
      targetPages < 1 ||
      targetPages > 10
    ) {
      return NextResponse.json(
        { error: "Missing or invalid page-fit input." },
        { status: 400 },
      );
    }

    const structureMode: ContentStructureMode =
      body.structureMode ?? optimization.structureMode ?? "optimize";
    const lockedContentIds = [...new Set(body.lockedContentIds ?? [])];
    const keptContentIds = [
      ...new Set([...(body.keptContentIds ?? []), ...lockedContentIds]),
    ];
    const priorityContentIds = [...new Set(body.priorityContentIds ?? [])];
    const page = defaultResumePage(
      body.pageSize ??
        body.resumeStyleSourcePage ??
        personalizedStyleProfile?.page,
    );
    const sourceRevision = createResumeRevision({
      resume,
      optimization,
      job,
      modelId: model,
    });
    const cacheKey = createFitCacheKey({
      sourceRevision,
      targetPages,
      style,
      page,
      modelId: model,
      layoutRevision: createFitLayoutRevision(
        style === "personalized" ? personalizedStyleProfile : null,
      ),
      keptContentIds,
    });
    const protectedKeywords = groundedRequiredKeywords(
      resume,
      optimization,
      job,
    );

    const initial = await measure({
      style,
      palette,
      resume,
      optimization,
      page,
      targetPages,
      personalizedStyleProfile,
    });
    const observed = [...initial.observedPages];
    if (initial.observedPages.includes(targetPages)) {
      const now = new Date().toISOString();
      const variant: ResumeFitVariant = {
        id: crypto.randomUUID(),
        cacheKey,
        sourceRevision,
        targetPages,
        actualPages: targetPages,
        style,
        page,
        modelId: model,
        density: initial.density,
        fittedResume: resume,
        fittedOptimization: optimization,
        changes: [],
        keptContentIds,
        atsScore: fitAtsScore({
          resume,
          optimization,
          job,
          requiredKeywords: protectedKeywords,
        }),
        sourceAtsScore: optimization.atsScore ?? report.overallAfter,
        createdAt: now,
        lastUsedAt: now,
      };
      return NextResponse.json({ variant });
    }

    let measuredPages = initial.pageCount;
    let direction: "compress" | "expand" =
      Math.min(...initial.observedPages) > targetPages ? "compress" : "expand";
    const initiallyCompressing = direction === "compress";
    let previousPlan: AiFitPlan | null = null;
    let lastIssues: string[] = [];

    if (
      structureMode === "preserve" &&
      direction === "compress" &&
      targetPages === 1
    ) {
      const lowerBoundDocuments = createPreservedLowerBoundDocuments(
        resume,
        optimization,
      );
      const lowerBound = await measure({
        style,
        palette,
        resume: lowerBoundDocuments.fittedResume,
        optimization: lowerBoundDocuments.fittedOptimization,
        page,
        targetPages,
        personalizedStyleProfile,
      });
      observed.push(...lowerBound.observedPages);
      if (Math.min(...lowerBound.observedPages) > targetPages) {
        return conflictResponse({
          targetPages,
          observed,
          reasons: [
            "Keeping every detected section heading exceeds one page even after reducing each section to its smallest readable content.",
          ],
        });
      }
    }

    // Original-inspired measurement launches Chromium for every candidate.
    // Keep its correction loop within the request budget instead of allowing
    // a third long model response to run past the client's timeout.
    const attempts =
      style === "personalized" || structureMode === "preserve" ? 2 : 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let rawPlan: unknown;
      try {
        rawPlan = await fitJsonCompletion({
          system: SYSTEM,
          user: fitUserPrompt({
            resume,
            optimization,
            job,
            report,
            targetPages,
            direction,
            attempt,
            measuredPages,
            keptContentIds,
            priorityContentIds,
            lockedContentIds,
            structureMode,
            previousPlan,
          }),
          model,
          maxTokens:
            structureMode === "preserve"
              ? 4500
              : style === "personalized"
                ? 5200
                : 7000,
          timeoutMs: style === "personalized" ? 18_000 : 24_000,
        });
      } catch (completionError) {
        if (!isAbortLike(completionError)) throw completionError;
        lastIssues = [
          "The selected model did not return the page-fit rewrite within the per-attempt time limit.",
        ];
        break;
      }
      const normalizedPlan = normalizeAiFitPlan(
        rawPlan,
        resume,
        optimization,
      );
      let plan = (structureMode === "preserve"
        ? enforcePreservedFitSkeleton(normalizedPlan, resume, optimization, [
            ...keptContentIds,
            ...priorityContentIds,
            ...lockedContentIds,
          ])
        : enforceRoleOptimizedFitTransport({
            value: normalizedPlan,
            resume,
            optimization,
            targetPages,
            direction,
            protectedContentIds: [
              ...keptContentIds,
              ...priorityContentIds,
              ...lockedContentIds,
            ],
          })) as AiFitPlan;
      const issues = validatePlan({
        plan,
        resume,
        optimization,
        job,
        keptContentIds,
        lockedContentIds,
        structureMode,
        direction,
      });
      if (issues.length > 0) {
        lastIssues = issues;
        previousPlan = plan;
        continue;
      }

      let documents = createFittedDocuments({
        plan,
        resume,
        optimization,
      });
      let result = await measure({
        style,
        palette,
        resume: documents.fittedResume,
        optimization: documents.fittedOptimization,
        page,
        targetPages,
        personalizedStyleProfile,
      });
      observed.push(...result.observedPages);
      measuredPages = result.pageCount;
      previousPlan = plan;

      if (!result.observedPages.includes(targetPages)) {
        direction =
          Math.min(...result.observedPages) > targetPages
            ? "compress"
            : "expand";
        continue;
      }

      // Semantic review is necessary only for a candidate that already meets
      // the physical page target. Reviewing over/under-filled intermediate
      // drafts spent up to eight seconds per failed round without improving
      // safety or the final output.
      const semanticIssues = await reviewSemanticGrounding({
        resume,
        candidate: documents.fittedOptimization,
        model,
      });
      if (semanticIssues.length > 0) {
        const repaired = removeSemanticallyRejectedContent({
          plan,
          issues: semanticIssues,
          optimization,
        });
        const repairedIssues = repaired
          ? validatePlan({
              plan: repaired,
              resume,
              optimization,
              job,
              keptContentIds,
              lockedContentIds,
              structureMode,
              direction,
            })
          : semanticIssues;
        if (!repaired || repairedIssues.length > 0) {
          lastIssues = repairedIssues;
          previousPlan = plan;
          continue;
        }
        plan = repaired;
        documents = createFittedDocuments({
          plan,
          resume,
          optimization,
        });
        result = await measure({
          style,
          palette,
          resume: documents.fittedResume,
          optimization: documents.fittedOptimization,
          page,
          targetPages,
          personalizedStyleProfile,
        });
        observed.push(...result.observedPages);
        measuredPages = result.pageCount;
        previousPlan = plan;
        if (!result.observedPages.includes(targetPages)) {
          direction =
            Math.min(...result.observedPages) > targetPages
              ? "compress"
              : "expand";
          continue;
        }
      }

      const changes = createChanges({ plan, resume, optimization });
      const now = new Date().toISOString();
      const variant: ResumeFitVariant = {
        id: crypto.randomUUID(),
        cacheKey,
        sourceRevision,
        targetPages,
        actualPages: targetPages,
        style,
        page,
        modelId: model,
        density: result.density,
        fittedResume: documents.fittedResume,
        fittedOptimization: documents.fittedOptimization,
        changes,
        keptContentIds,
        atsScore: fitAtsScore({
          resume: documents.fittedResume,
          optimization: documents.fittedOptimization,
          job,
          requiredKeywords: protectedKeywords,
        }),
        sourceAtsScore: optimization.atsScore ?? report.overallAfter,
        createdAt: now,
        lastUsedAt: now,
      };
      return NextResponse.json({ variant });
    }

    if (initiallyCompressing) {
      const protectedContentIds = [
        ...keptContentIds,
        ...priorityContentIds,
        ...lockedContentIds,
      ];
      for (const intensity of ["moderate", "decisive"] as const) {
        let plan = createDeterministicCompressionPlan({
          resume,
          optimization,
          targetPages,
          structureMode,
          protectedContentIds,
          intensity,
        });
        if (structureMode === "preserve") {
          plan = enforcePreservedFitSkeleton(
            plan,
            resume,
            optimization,
            protectedContentIds,
          ) as AiFitPlan;
        }
        const fallbackIssues = validatePlan({
          plan,
          resume,
          optimization,
          job,
          keptContentIds,
          lockedContentIds,
          structureMode,
          direction: "compress",
        });
        if (fallbackIssues.length > 0) {
          lastIssues = fallbackIssues;
          continue;
        }
        const documents = createFittedDocuments({
          plan,
          resume,
          optimization,
        });
        const result = await measure({
          style,
          palette,
          resume: documents.fittedResume,
          optimization: documents.fittedOptimization,
          page,
          targetPages,
          personalizedStyleProfile,
        });
        observed.push(...result.observedPages);
        if (!result.observedPages.includes(targetPages)) {
          lastIssues = [
            `The ${intensity} evidence-safe fallback measured ${result.pageCount} page(s), not ${targetPages}.`,
          ];
          continue;
        }

        const now = new Date().toISOString();
        const variant: ResumeFitVariant = {
          id: crypto.randomUUID(),
          cacheKey,
          sourceRevision,
          targetPages,
          actualPages: targetPages,
          style,
          page,
          modelId: model,
          density: result.density,
          fittedResume: documents.fittedResume,
          fittedOptimization: documents.fittedOptimization,
          changes: createChanges({ plan, resume, optimization }),
          keptContentIds,
          atsScore: fitAtsScore({
            resume: documents.fittedResume,
            optimization: documents.fittedOptimization,
            job,
            requiredKeywords: protectedKeywords,
          }),
          sourceAtsScore: optimization.atsScore ?? report.overallAfter,
          createdAt: now,
          lastUsedAt: now,
        };
        return NextResponse.json({ variant });
      }
    }

    return conflictResponse({
      targetPages,
      observed,
      reasons: lastIssues,
    });
  } catch (error) {
    console.error("resume fit failed", error);
    const message =
      error instanceof Error ? error.message : "Could not fit the resume.";
    const personalizedIntegrityFailure =
      /^Personalized (?:PDF text|content) integrity failed:/.test(message);
    return NextResponse.json(
      {
        error: personalizedIntegrityFailure
          ? "The personalized layout could not preserve every resume field in the PDF. Rebuild the layout or choose another PDF style, then retry."
          : message,
        ...(personalizedIntegrityFailure
          ? { issues: [message] }
          : {}),
      },
      { status: 500 },
    );
  }
}
