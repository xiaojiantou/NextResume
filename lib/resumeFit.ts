// Copyright (c) 2026 HowBe LLC. All rights reserved.

import type { PdfStyle } from "./pdf/config";
import type {
  JobAnalysis,
  Optimization,
  Resume,
  ResumePageSpec,
  ResumeStyleProfile,
} from "./types";

const FIT_CACHE_VERSION = 3;

export type FitChangeKind =
  | "shortened"
  | "expanded"
  | "hidden"
  | "collapsed"
  | "restored";

export type ResumeFitChange = {
  id: string;
  kind: FitChangeKind;
  targetType:
    | "summary"
    | "skill"
    | "bullet"
    | "role"
    | "project"
    | "additional";
  targetId: string;
  label: string;
  before: string;
  after: string;
  reason: string;
  evidence: string[];
};

export type FitDensity =
  | "very-relaxed"
  | "relaxed"
  | "standard"
  | "compact"
  | "tight"
  | "minimum-safe"
  | "source";

export type ResumeFitVariant = {
  id: string;
  cacheKey: string;
  sourceRevision: string;
  targetPages: number;
  actualPages: number;
  style: PdfStyle;
  page: ResumePageSpec;
  modelId: string;
  density: FitDensity;
  fittedResume: Resume;
  fittedOptimization: Optimization;
  changes: ResumeFitChange[];
  keptContentIds: string[];
  atsScore: number;
  sourceAtsScore: number;
  createdAt: string;
  lastUsedAt: string;
};

export type FitConflict = {
  message: string;
  reasons: string[];
  recommendedRange: {
    min: number;
    max: number;
  };
  observedPages: number[];
};

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

export function createResumeRevision({
  resume,
  optimization,
  job,
  modelId,
}: {
  resume: Resume;
  optimization: Optimization | null;
  job: JobAnalysis | null;
  modelId: string | null;
}): string {
  return smallHash(
    JSON.stringify(
      stableValue({
        resume,
        optimization,
        job,
        modelId,
      }),
    ),
  );
}

export function createFitCacheKey({
  sourceRevision,
  targetPages,
  style,
  page,
  modelId,
  keptContentIds,
  layoutRevision,
}: {
  sourceRevision: string;
  targetPages: number;
  style: PdfStyle;
  page: ResumePageSpec;
  modelId: string;
  keptContentIds: string[];
  layoutRevision?: string;
}): string {
  return [
    `fit-v${FIT_CACHE_VERSION}`,
    sourceRevision,
    style,
    targetPages,
    `${Math.round(page.widthPt)}x${Math.round(page.heightPt)}`,
    modelId,
    layoutRevision ?? "fixed-layout",
    [...keptContentIds].sort().join(","),
  ].join(":");
}

export function createFitLayoutRevision(
  profile?: ResumeStyleProfile | null,
): string {
  return profile
    ? `profile-${smallHash(JSON.stringify(stableValue(profile)))}`
    : "fixed-layout";
}

export function defaultResumePage(
  page?: ResumePageSpec | null,
): ResumePageSpec {
  if (
    page &&
    Number.isFinite(page.widthPt) &&
    Number.isFinite(page.heightPt) &&
    page.widthPt >= 400 &&
    page.heightPt >= 500
  ) {
    return page;
  }
  return {
    widthPt: 612,
    heightPt: 792,
    orientation: "portrait",
  };
}

export function pruneFitVariants(
  variants: ResumeFitVariant[],
  limit = 12,
): ResumeFitVariant[] {
  const newestByKey = new Map<string, ResumeFitVariant>();
  for (const variant of variants) {
    const existing = newestByKey.get(variant.cacheKey);
    if (
      !existing ||
      new Date(variant.lastUsedAt).getTime() >
        new Date(existing.lastUsedAt).getTime()
    ) {
      newestByKey.set(variant.cacheKey, variant);
    }
  }
  return [...newestByKey.values()]
    .sort(
      (left, right) =>
        new Date(right.lastUsedAt).getTime() -
        new Date(left.lastUsedAt).getTime(),
    )
    .slice(0, limit);
}

export function findFitVariant(
  variants: ResumeFitVariant[],
  cacheKey: string,
): ResumeFitVariant | null {
  return variants.find((variant) => variant.cacheKey === cacheKey) ?? null;
}
