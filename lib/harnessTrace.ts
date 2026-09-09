// Copyright (c) 2026 HowBe LLC. All rights reserved.
import type { ContentReview } from "./contentQuality";
import type { Optimization, OptimizedBullet, Resume } from "./types";

export const HARNESS_VERSION = 1;
export type HarnessCandidate = {
  id: string;
  text: string;
  evidence: string[];
  origin: "source" | "model" | "locked";
  attempt: number;
  review?: ContentReview;
};
export type BulletRun = {
  bulletId: string;
  sourceText: string;
  candidates: HarnessCandidate[];
  selectedId?: string;
  state?: "ready" | "needs_evidence" | "review_unavailable" | "locked";
};
export type HarnessTrace = {
  version: number;
  id: string;
  model: string;
  startedAt: string;
  elapsedMs: number;
  outcome: "running" | "completed" | "fallback" | "failed";
  sourceRestorations?: Array<{ attempt: number; ids: string[]; reason: string }>;
  validation: Array<{ attempt: number; stage: "candidate" | "selected"; issues: string[] }>;
  calls: Array<{
    stage: "generate" | "content_review" | "grounding";
    scope?: string;
    attempt: number;
    elapsedMs: number;
    outcome: "completed" | "failed";
    inputTokens?: number;
    outputTokens?: number;
  }>;
  bullets: BulletRun[];
};

export function startHarnessTrace(resume: Resume, model: string, id: string, now: number): HarnessTrace {
  return {
    version: HARNESS_VERSION, id, model, startedAt: new Date(now).toISOString(),
    elapsedMs: 0, outcome: "running", calls: [], validation: [],
    bullets: [...resume.experience, ...(resume.projects ?? [])].flatMap(entry => entry.bullets).map(bullet => ({
      bulletId: bullet.id, sourceText: bullet.text,
      candidates: [{ id: `${bullet.id}:source`, text: bullet.text, evidence: [bullet.id], origin: "source", attempt: 0 }],
    })),
  };
}

export function recordCandidates(trace: HarnessTrace, optimization: Optimization, attempt: number): void {
  const byId = new Map(trace.bullets.map(bullet => [bullet.bulletId, bullet]));
  for (const entry of [...optimization.roles, ...(optimization.projects ?? [])]) {
    for (const bullet of entry.bullets) {
      const run = byId.get(bullet.id);
      if (!run || run.candidates.some(candidate => candidate.text === bullet.text && JSON.stringify(candidate.evidence) === JSON.stringify(bullet.evidence))) continue;
      run.candidates.push({ id: `${bullet.id}:candidate:${run.candidates.length}`, text: bullet.text, evidence: [...bullet.evidence], origin: "model", attempt });
    }
  }
}

export function recordCandidateReviews(trace: HarnessTrace, reviews: ReadonlyMap<string, ContentReview>): void {
  for (const run of trace.bullets) {
    const review = reviews.get(run.bulletId);
    if (!review) continue;
    const candidate = [...run.candidates].reverse().find(item => item.text === review.text);
    if (candidate) candidate.review = { ...review };
  }
}

export function finishHarnessTrace(trace: HarnessTrace, optimization: Optimization | null, locks: string[], now: number, fallback = false): HarnessTrace {
  trace.elapsedMs = Math.max(0, now - Date.parse(trace.startedAt));
  trace.outcome = optimization ? (fallback ? "fallback" : "completed") : "failed";
  if (!optimization) return trace;
  const runs = new Map(trace.bullets.map(run => [run.bulletId, run]));
  for (const entry of [...optimization.roles, ...(optimization.projects ?? [])]) {
    for (const bullet of entry.bullets) {
      const run = runs.get(bullet.id);
      if (!run) continue;
      const locked = locks.includes(bullet.id) || locks.includes(entry.id);
      let selected = run.candidates.find(candidate => candidate.text === bullet.text && JSON.stringify(candidate.evidence) === JSON.stringify(bullet.evidence));
      if (!selected) {
        selected = { id: `${bullet.id}:selected`, text: bullet.text, evidence: [...bullet.evidence], origin: locked ? "locked" : "model", attempt: 0 };
        run.candidates.push(selected);
      }
      run.selectedId = selected.id;
      run.state = locked ? "locked" : bullet.contentReview?.status === "unreviewed" ? "review_unavailable" :
        bullet.contentReview?.question || bullet.contentReview?.impactMetrics?.length ? "needs_evidence" : "ready";
    }
  }
  return trace;
}

export type BulletDecision = {
  action: "accept" | "edit" | "restore";
  before: string;
  after: string;
  at: string;
};
export function recordBulletDecision(previous: OptimizedBullet, next: OptimizedBullet, action: BulletDecision["action"], at: string): OptimizedBullet {
  const history = [...(previous.decisionHistory ?? [])];
  if (previous.text === next.text && action === "edit") return { ...next, decisionHistory: history };
  const last = history.at(-1);
  if (action === "edit" && last?.action === "edit") history[history.length - 1] = { ...last, after: next.text, at };
  else history.push({ action, before: previous.text, after: next.text, at });
  return { ...next, decisionHistory: history.slice(-20) };
}
