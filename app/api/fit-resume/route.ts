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
import { renderPersonalizedPdf } from "@/lib/personalizedResume";
import { rateLimitGuard } from "@/lib/ratelimit";
import {
  createFitCacheKey,
  createResumeRevision,
  defaultResumePage,
  type FitConflict,
  type FitDensity,
  type ResumeFitChange,
  type ResumeFitVariant,
} from "@/lib/resumeFit";
import type {
  AtsReport,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  Resume,
  ResumePageSpec,
  ResumeStyleProfile,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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
  "hiddenAdditionalItemIds": string[]
}

Evidence and truth rules:
- Never invent a metric, tool, skill, responsibility, employer, project, customer, team size, or result.
- Every output bullet must keep an existing optimized bullet id. A user-added original bullet id may also be used when it cites itself as evidence.
- Keep each bullet and every evidence id inside its original work role or project. Never move evidence between employers or projects.
- Reword, combine, shorten, or expand only facts traceable to those evidence ids. Every number in rewritten text must appear in that bullet's evidence.
- Skills must be selected verbatim from the original or optimized skill lists.
- Return every work role id. The newest role needs at least 2 bullets when the source has 2; other non-collapsed roles need at least 1.
- Only older, low-relevance roles may be collapsed. A collapsed role keeps company/title/dates but has no bullets.
- Return every project id and mark low-relevance projects hidden when compression requires it.
- Do not hide user-kept ids.
- Preserve every grounded required keyword at least once; remove duplicate occurrences first.
- Keep education metadata unchanged; it is not part of this response.
- For expansion, do not hide content. Add useful detail only by combining or clarifying existing evidence.
- Prefer relevance to the target job, measurable impact, unique evidence, then recency.
- Produce concise English resume prose, not commentary.`;

type AiFitPlan = {
  summary: string;
  skills: string[];
  roles: Array<{
    id: string;
    collapsed: boolean;
    bullets: OptimizedBullet[];
  }>;
  projects: Array<{
    id: string;
    hidden: boolean;
    bullets: OptimizedBullet[];
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
};

type Measured = {
  pageCount: number;
  density: FitDensity;
  observedPages: number[];
};

function normalizeAiFitPlan(
  value: unknown,
  resume: Resume,
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
  const normalizeOwner = (
    owner: unknown,
    booleanKey: "collapsed" | "hidden",
  ) => {
    if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
      return owner;
    }
    const item = owner as Record<string, unknown>;
    return {
      ...item,
      [booleanKey]:
        typeof item[booleanKey] === "boolean" ? item[booleanKey] : false,
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
  return {
    ...record,
    roles: Array.isArray(record.roles)
      ? record.roles.map((role) => normalizeOwner(role, "collapsed"))
      : record.roles,
    projects: Array.isArray(record.projects)
      ? record.projects.map((project) => normalizeOwner(project, "hidden"))
      : (resume.projects ?? []).length === 0
        ? []
        : record.projects,
    hiddenAdditionalItemIds,
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
        role.id === contentId ||
        role.bullets.some(
          (bullet) =>
            bullet.id === contentId || bullet.evidence.includes(contentId),
        ),
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
  const isAdditionalItem = (resume.additionalSections ?? []).some((section) =>
    section.items.some((item) => item.id === contentId),
  );
  return (
    isAdditionalItem && !plan.hiddenAdditionalItemIds.includes(contentId)
  );
}

function normalizedNumbers(value: string): string[] {
  return (
    value.match(
      /[$€£¥]?\d[\d,.]*(?:\+|%|x|×|k|m|b|thousand|million|billion)?/gi,
    ) ?? []
  ).map((number) => number.toLowerCase().replaceAll(",", ""));
}

function hasOnlyGroundedNumbers(value: string, evidence: string): boolean {
  const available = new Set(normalizedNumbers(evidence));
  return normalizedNumbers(value).every((number) => available.has(number));
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
  direction,
}: {
  plan: AiFitPlan;
  resume: Resume;
  optimization: Optimization;
  job: JobAnalysis;
  keptContentIds: string[];
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
        typeof role.collapsed !== "boolean" ||
        !Array.isArray(role.bullets),
    )
  ) {
    const invalidRole = Array.isArray(plan.roles)
      ? plan.roles.find(
          (role) =>
            !role ||
            typeof role.id !== "string" ||
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
      role.id === protectedNewestRoleId
        ? Math.min(2, sourceBulletCount)
        : Math.min(1, sourceBulletCount);
    if (role.collapsed && role.id === protectedNewestRoleId) {
      issues.push(`${role.id} is too recent to collapse.`);
    } else if (!role.collapsed && role.bullets.length < minimum) {
      issues.push(`${role.id} does not meet its protected bullet minimum.`);
    }

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

  if (
    direction === "expand" &&
    (plan.roles.some((role) => role.collapsed) ||
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
  }

  const candidateCorpus = JSON.stringify(plan).toLowerCase();
  for (const keyword of groundedRequiredKeywords(resume, optimization, job)) {
    if (!candidateCorpus.includes(keyword.toLowerCase())) {
      issues.push(`Grounded required keyword "${keyword}" was removed.`);
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

  const academicTarget = /(research|scientist|professor|academic|phd)/i.test(
    `${job.title} ${job.responsibilities.join(" ")}`,
  );
  if (academicTarget) {
    const publicationIds = (resume.additionalSections ?? [])
      .filter((section) => section.kind === "publications")
      .flatMap((section) => section.items.map((item) => item.id));
    if (
      publicationIds.some((id) => plan.hiddenAdditionalItemIds.includes(id))
    ) {
      issues.push("Publications are protected for this academic target.");
    }
  }

  return issues;
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
  const fittedResume: Resume = {
    ...resume,
    summary: plan.summary,
    skills: [...plan.skills],
    experience: resume.experience.map((role) => {
      const fit = rolePlans.get(role.id);
      return {
        ...role,
        bullets:
          fit?.collapsed
            ? []
            : (fit?.bullets ?? []).map((bullet) => ({
                id: bullet.id,
                text: bullet.text,
              })),
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
        items: section.items.filter(
          (item) => !plan.hiddenAdditionalItemIds.includes(item.id),
        ),
      }))
      .filter((section) => section.items.length > 0),
  };

  const fittedOptimization: Optimization = {
    ...optimization,
    summary: plan.summary,
    skills: [...plan.skills],
    roles: plan.roles.map((role) => ({
      id: role.id,
      bullets: role.collapsed ? [] : role.bullets,
    })),
    projects: plan.projects
      .filter((project) => !project.hidden)
      .map((project) => ({
        id: project.id,
        bullets: project.bullets,
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

  for (const role of plan.roles.filter((candidate) => candidate.collapsed)) {
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
  previousPlan: AiFitPlan | null;
}) {
  const intensity =
    attempt === 1 ? "conservative" : attempt === 2 ? "moderate" : "decisive";
  return `Target: exactly ${targetPages} page(s).
Current measured result: ${measuredPages} page(s).
Direction: ${direction}.
Adjustment intensity: ${intensity}.

If compressing, shorten language before hiding content. Remove duplicate or generic evidence before unique, quantified, job-relevant evidence. If expanding, restore full evidence and write more complete but still concise bullets without adding facts.

User-kept content ids: ${JSON.stringify(keptContentIds)}
User-edited/high-priority ids: ${JSON.stringify(priorityContentIds)}
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
        ? reasons.slice(0, 8)
        : [
            "The selected page count conflicts with protected content or the safe typography limits.",
          ],
    recommendedRange: { min, max: Math.max(min, max) },
    observedPages: [...new Set(valid)].sort((a, b) => a - b),
  };
  return NextResponse.json({ conflict }, { status: 409 });
}

export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, FIT_LIMIT);
  if (limited) return limited;

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

    const keptContentIds = [...new Set(body.keptContentIds ?? [])];
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
        sourceAtsScore: report.overallAfter,
        createdAt: now,
        lastUsedAt: now,
      };
      return NextResponse.json({ variant });
    }

    let measuredPages = initial.pageCount;
    let direction: "compress" | "expand" =
      Math.min(...initial.observedPages) > targetPages ? "compress" : "expand";
    let previousPlan: AiFitPlan | null = null;
    let lastIssues: string[] = [];

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const rawPlan = await jsonCompletion<unknown>({
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
          previousPlan,
        }),
        model,
        maxTokens: 7000,
      });
      const plan = normalizeAiFitPlan(rawPlan, resume) as AiFitPlan;
      const issues = validatePlan({
        plan,
        resume,
        optimization,
        job,
        keptContentIds,
        direction,
      });
      if (issues.length > 0) {
        lastIssues = issues;
        previousPlan = plan;
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
      measuredPages = result.pageCount;
      previousPlan = plan;

      if (result.observedPages.includes(targetPages)) {
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
          sourceAtsScore: report.overallAfter,
          createdAt: now,
          lastUsedAt: now,
        };
        return NextResponse.json({ variant });
      }
      direction =
        Math.min(...result.observedPages) > targetPages ? "compress" : "expand";
    }

    return conflictResponse({
      targetPages,
      observed,
      reasons: lastIssues,
    });
  } catch (error) {
    console.error("resume fit failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not fit the resume.",
      },
      { status: 500 },
    );
  }
}
