// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The contract between the rewrite model and the rest of the pipeline: coerce
// whatever JSON the model returned into Optimization shape, then check the
// invariants the route refuses to ship without.
//
// This lives in lib/ rather than inside the route so scripts/eval-ats.mjs can
// measure the pipeline that actually ships. An eval that reimplements shaping
// and validation measures the reimplementation, and the two drift silently.
// The prompts stay in the route; the eval reads those out of the source.

import {
  MAX_KEYWORD_REPEATS,
  countOccurrences,
  detectStuffing,
  resumeToText,
} from "./atsScore.ts";
import { applyOptimizationToResume } from "./applyOptimization.ts";
import type {
  CoreResumeSection,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  Resume,
  ResumeSectionRef,
  SkillEvidence,
} from "./types";

// The meta-commentary tails weak models bolt on to satisfy matchedKeywords
// ("..., showcasing proficiency in React"). Gerund-after-comma is the
// signature; leading verbs like "Demonstrated X to stakeholders" stay legal.
const SLOP_PATTERN =
  /[,;–—]\s*(showcasing|demonstrating|highlighting|proving|underscoring|exemplifying|evidencing)\b|\b(showcasing|demonstrating)\s+(expertise|proficiency|strong|robust|deep)\b/i;

export function validateOptimization(
  resume: Resume,
  opt: Optimization,
  job?: JobAnalysis,
): string[] {
  const problems: string[] = [];

  const checkSection = (
    label: "roles" | "projects",
    originals: { id: string; bullets: { id: string }[] }[],
    optimized: { id: string; bullets: OptimizedBullet[] }[],
  ) => {
    for (const original of originals) {
      const match = optimized.find((o) => o.id === original.id);
      if (!match) {
        problems.push(`${label}: missing entry "${original.id}"`);
        continue;
      }
      if (match.bullets.length !== original.bullets.length) {
        problems.push(
          `${label} "${original.id}": expected ${original.bullets.length} bullets (one-to-one rewrite), got ${match.bullets.length}`,
        );
      }
      const originalIds = new Set(original.bullets.map((b) => b.id));
      for (const bullet of match.bullets) {
        if (!originalIds.has(bullet.id)) {
          problems.push(
            `${label} "${original.id}": bullet id "${bullet.id}" does not exist in the input resume`,
          );
        }
      }
    }
  };

  checkSection("roles", resume.experience, opt.roles);
  checkSection("projects", resume.projects ?? [], opt.projects ?? []);

  const allBullets = [
    ...opt.roles.flatMap((r) => r.bullets),
    ...(opt.projects ?? []).flatMap((p) => p.bullets),
  ];
  for (const bullet of allBullets) {
    if (SLOP_PATTERN.test(bullet.text)) {
      problems.push(
        `bullet "${bullet.id}": remove the meta-commentary tail ("showcasing/demonstrating...") and weave the keyword into the factual claim instead`,
      );
    }
  }
  if (SLOP_PATTERN.test(opt.summary)) {
    problems.push(
      `summary: remove meta-commentary ("showcasing/demonstrating...")`,
    );
  }

  const originalSkills = new Set(
    resume.skills.map((s) => s.toLocaleLowerCase()),
  );
  const keptSkills = new Set(opt.skills.map((s) => s.toLocaleLowerCase()));
  const dropped = [...originalSkills].filter((s) => !keptSkills.has(s));
  if (dropped.length > 0) {
    problems.push(
      `skills: ${dropped.length} original skills were dropped (${dropped.slice(0, 5).join(", ")}...) — include every original skill, reordered by JD relevance`,
    );
  }

  // Chasing matchedKeywords pushes the model to repeat the same term in every
  // bullet. Scoring counts each keyword once, so that buys nothing, and
  // Workday's 2026 filter flags the density as manipulation. Catch it here so
  // the user never receives a resume that trips it.
  if (job) {
    const materialized = applyOptimizationToResume(resume, opt);
    const sourceText = resumeToText(resume);
    const { worst } = detectStuffing(resumeToText(materialized), job);
    for (const { keyword, count } of worst) {
      // The source resume can legitimately exceed the cap on its own — the
      // skills list and tech-stack lines must be kept verbatim, so in
      // preserve mode no rewrite can get under it. Only reject density the
      // rewrite itself added; pre-existing density is the user's to see in
      // the analysis report, not a reason to fail their paid rewrite.
      const allowed = Math.max(
        MAX_KEYWORD_REPEATS,
        countOccurrences(sourceText, keyword),
      );
      if (count <= allowed) continue;
      problems.push(
        `keyword "${keyword}": repeated ${count} times (the source resume has ${countOccurrences(sourceText, keyword)}) — state it once or twice where it is load-bearing and rewrite the rest without it (max ${allowed})`,
      );
    }
  }

  return problems;
}

export function normalizeOptimization(value: unknown): Optimization {
  const object =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const stringValue = (candidate: unknown) =>
    typeof candidate === "string" ? candidate.trim() : "";
  const sectionRefs = new Set<ResumeSectionRef>([
    "summary",
    "skills",
    "experience",
    "projects",
    "education",
  ]);
  const sectionOrder = (Array.isArray(object.sectionOrder)
    ? object.sectionOrder
    : []
  ).flatMap((candidate) => {
    const ref = stringValue(candidate);
    return sectionRefs.has(ref as ResumeSectionRef) ||
      /^additional:[^\s:][^\s]*$/.test(ref)
      ? [ref as ResumeSectionRef]
      : [];
  });
  const rawSectionLabels =
    object.sectionLabels && typeof object.sectionLabels === "object"
      ? (object.sectionLabels as Record<string, unknown>)
      : {};
  const sectionLabels = Object.fromEntries(
    (["summary", "skills", "experience", "projects", "education"] as CoreResumeSection[])
      .map((section) => [section, stringValue(rawSectionLabels[section])] as const)
      .filter(([, label]) => Boolean(label)),
  ) as Partial<Record<CoreResumeSection, string>>;
  const bullet = (candidate: unknown): OptimizedBullet => {
    const item =
      candidate && typeof candidate === "object"
        ? (candidate as Record<string, unknown>)
        : {};
    return {
      id: stringValue(item.id),
      text: stringValue(item.text),
      evidence: Array.isArray(item.evidence)
        ? item.evidence.map(stringValue).filter(Boolean)
        : [],
      matchedKeywords: Array.isArray(item.matchedKeywords)
        ? item.matchedKeywords.map(stringValue).filter(Boolean)
        : [],
      rationale: stringValue(item.rationale),
    };
  };
  const owners = (candidate: unknown) =>
    (Array.isArray(candidate) ? candidate : []).map((raw) => {
      const item =
        raw && typeof raw === "object"
          ? (raw as Record<string, unknown>)
          : {};
      return {
        id: stringValue(item.id),
        bullets: (Array.isArray(item.bullets) ? item.bullets : []).map(bullet),
      };
    });
  const skillEvidenceValues = new Set<SkillEvidence["grounding"]>([
    "direct",
    "indirect",
  ]);
  const skillTypes = new Set<SkillEvidence["skillType"]>([
    "tool",
    "capability",
    "domain",
    "soft",
    "credential",
    "language",
  ]);
  const skillEvidence: SkillEvidence[] = (
    Array.isArray(object.skillEvidence) ? object.skillEvidence : []
  ).flatMap((raw) => {
    const item =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
    const skill = stringValue(item.skill);
    const grounding = stringValue(item.grounding) as SkillEvidence["grounding"];
    const skillType = stringValue(item.skillType) as SkillEvidence["skillType"];
    if (
      !skill ||
      !skillEvidenceValues.has(grounding) ||
      !skillTypes.has(skillType)
    ) {
      return [];
    }
    return [
      {
        skill,
        grounding,
        skillType,
        evidence: Array.isArray(item.evidence)
          ? item.evidence.map(stringValue).filter(Boolean)
          : [],
        rationale: stringValue(item.rationale),
      },
    ];
  });
  return {
    summary: stringValue(object.summary),
    title: stringValue(object.title),
    skills: Array.isArray(object.skills)
      ? object.skills.map(stringValue).filter(Boolean)
      : [],
    skillEvidence,
    roles: owners(object.roles),
    projects: owners(object.projects),
    additionalSections: (Array.isArray(object.additionalSections)
      ? object.additionalSections
      : []
    ).map((raw) => {
      const section =
        raw && typeof raw === "object"
          ? (raw as Record<string, unknown>)
          : {};
      return {
        id: stringValue(section.id),
        items: (Array.isArray(section.items) ? section.items : []).map(
          (itemRaw) => {
            const item =
              itemRaw && typeof itemRaw === "object"
                ? (itemRaw as Record<string, unknown>)
                : {};
            return {
              id: stringValue(item.id),
              bullets: (Array.isArray(item.bullets)
                ? item.bullets
                : []
              ).map(bullet),
            };
          },
        ),
      };
    }),
    sectionOrder,
    sectionLabels,
  };
}
