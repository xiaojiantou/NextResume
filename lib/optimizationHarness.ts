// Copyright (c) 2026 HowBe LLC. All rights reserved.
import {
  assembleOptimization, buildChunkPrompt, chunkKey, chunksForIssues,
  mapWithConcurrency, planRewriteChunks,
} from "./optimizeChunks.ts";
import { normalizeOptimization, validateOptimization } from "./optimizeContract.ts";
import {
  calculateOptimizationAtsScore, constrainPreservedOptimization,
  constrainRoleOptimizedStructure, createStructureIntegrity, enforceLockedOptimization,
  reconcileGroundedSkills, validateGroundedOptimization, validateLockedOptimization,
  validatePreservedOptimization,
} from "./resumeStructure.ts";
import {
  contentRevisionIssues, restoreApprovedBullets, qualityPairs, reviewContentQuality,
  selectReviewedContent, type ContentReview, type QualityCompletion,
} from "./contentQuality.ts";
import { restoreUnsupportedNumericText } from "./numericRewriteFallback.ts";
import { finishHarnessTrace, recordCandidateReviews, recordCandidates, startHarnessTrace } from "./harnessTrace.ts";
import type { AtsReport, ContentStructureMode, JobAnalysis, Optimization, OptimizedBullet, Resume } from "./types";

export type HarnessInput = {
  resume: Resume; job: JobAnalysis; report: AtsReport; model?: string;
  structureMode?: ContentStructureMode; lockedContentIds?: string[];
  baselineOptimization?: Optimization | null;
};
export type HarnessAdapters = {
  complete: QualityCompletion;
  reviewGrounding: (args: { resume: Resume; candidate: Optimization; model?: string; complete: QualityCompletion }) => Promise<string[]>;
  now?: () => number;
  runId?: string;
};
const TOTAL_BUDGET_MS = 270_000;
const CHUNK_TIMEOUT_MS = 75_000;
const CHUNK_CONCURRENCY = 5;
const MIN_ATTEMPT_MS = 20_000;

export async function runOptimizationHarness(input: HarnessInput, adapters: HarnessAdapters) {
  const { resume, job, report, model, structureMode = "optimize", lockedContentIds = [], baselineOptimization = null } = input;
  const { complete, reviewGrounding, now = Date.now } = adapters;
  const trace = startHarnessTrace(resume, model || "configured-default", adapters.runId || crypto.randomUUID(), now());
  let currentAttempt = 0;
  const invoke = async (stage: "generate" | "content_review" | "grounding", scope: string | undefined, args: Parameters<QualityCompletion>[0] & { model?: string }) => {
    const started = now();
    let outcome: "completed" | "failed" = "failed";
    try { const result = await complete(args); outcome = "completed"; return result; }
    finally { trace.calls.push({ stage, scope, attempt: currentAttempt, elapsedMs: Math.max(0, now() - started), outcome }); }
  };
  async function execute() {
    const chunks = planRewriteChunks(resume, structureMode);
    const results = new Map<string, unknown>();
    const qualityReviews = new Map<string, ContentReview>();
    const qualityRevised = new Set<string>();
    const approvedBullets = new Map<string, OptimizedBullet>();
    let bestSafeOptimization: Optimization | null = null;
    let numericRecovery = false;
    const respondWithOptimization = (optimization: Optimization, fallback = numericRecovery) => {
      optimization.structureMode = structureMode;
      optimization.structureIntegrity = createStructureIntegrity(resume, optimization, structureMode);
      optimization.atsScore = calculateOptimizationAtsScore({ resume, optimization, job });
      optimization.harness = finishHarnessTrace(trace, optimization, lockedContentIds, now(), fallback);
      return { ok: true as const, optimization };
    };
    let pending = chunks;
    let feedbackByChunk = new Map<string, string[]>();
    let lastIssues: string[] = [];
    let ranOutOfTime = false;
    const attempts = 3;
    const deadline = now() + TOTAL_BUDGET_MS;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      currentAttempt = attempt;
      const budgetLeft = deadline - now();
      if (budgetLeft < MIN_ATTEMPT_MS) {
        ranOutOfTime = true;
        break;
      }
      const controller = new AbortController();
      const attemptTimer = setTimeout(
        () => controller.abort(),
        Math.min(budgetLeft, CHUNK_TIMEOUT_MS),
      );
      const startedAt = now();
      try {
        await mapWithConcurrency(pending, CHUNK_CONCURRENCY, async (chunk) => {
          const prompt = buildChunkPrompt({
            chunk,
            resume,
            job,
            report,
            structureMode,
            lockedContentIds,
            baselineOptimization,
            feedback: feedbackByChunk.get(chunkKey(chunk)) ?? [],
          });
          const raw = await invoke("generate", chunkKey(chunk), {
            ...prompt,
            model,
            signal: controller.signal,
          });
          results.set(chunkKey(chunk), raw);
        });
      } catch (attemptFailure) {
        // A retry of a round that already blew the per-round ceiling just
        // burns the rest of the budget, so stop and say so.
        if (controller.signal.aborted) {
          ranOutOfTime = true;
          break;
        }
        if (bestSafeOptimization) return respondWithOptimization(bestSafeOptimization, true);
        throw attemptFailure;
      } finally {
        clearTimeout(attemptTimer);
      }
      console.info(
        `optimize round ${attempt}: ${pending.length} chunk(s) in ${((now() - startedAt) / 1000).toFixed(1)}s (${structureMode}, model=${model ?? "default"})`,
      );
      const generated = normalizeOptimization(assembleOptimization(resume, structureMode, results));
      recordCandidates(trace, generated, attempt);
      const normalized = restoreApprovedBullets(generated, approvedBullets);
      if (structureMode === "optimize") {
        const grounded = reconcileGroundedSkills(
          resume,
          normalized.skills,
          normalized.skillEvidence,
        );
        normalized.skills = grounded.skills;
        normalized.skillEvidence = grounded.skillEvidence;
      }
      const structured =
        structureMode === "preserve"
          ? constrainPreservedOptimization({
              resume,
              candidate: normalized,
              baseline: baselineOptimization,
              lockedContentIds,
            })
          : constrainRoleOptimizedStructure({ resume, candidate: normalized });
      let opt = enforceLockedOptimization({
        resume,
        candidate: structured,
        baseline: baselineOptimization,
        lockedContentIds,
      });
      if (attempt === attempts) {
        const recovered = restoreUnsupportedNumericText(resume, opt, lockedContentIds);
        if (recovered.restoredIds.length) {
          opt = recovered.optimization;
          numericRecovery = true;
          trace.sourceRestorations = [...(trace.sourceRestorations ?? []), { attempt, ids: recovered.restoredIds, reason: "Numeric rewrites exhausted retries; restored source wording before full validation." }];
        }
      }
      const issues = [
        ...validateOptimization(resume, opt, job),
        ...validateGroundedOptimization(resume, opt),
        ...(structureMode === "preserve"
          ? validatePreservedOptimization(resume, opt)
          : []),
        ...validateLockedOptimization({
          resume,
          candidate: opt,
          baseline: baselineOptimization,
          lockedContentIds,
        }),
      ];
      if (issues.length === 0) {
        issues.push(
          ...(await reviewGrounding({
            resume,
            candidate: opt,
            model,
            complete: args => invoke("grounding", undefined, args),
          })),
        );
      }
      trace.validation.push({ attempt, stage: "candidate", issues: [...issues] });
      if (issues.length > 0) {
        lastIssues = issues;
        feedbackByChunk = chunksForIssues({
          resume,
          candidate: opt,
          issues,
          chunks,
        });
        pending = chunks.filter((chunk) =>
          feedbackByChunk.has(chunkKey(chunk)),
        );
        if (pending.length === 0) pending = chunks;
        continue;
      }
      // Review only new text. Accepted entries survive retries of other entries.
      const pairs = qualityPairs(resume, opt, lockedContentIds);
      const fresh = pairs.filter(pair => {
        const cached = qualityReviews.get(pair.id);
        return !cached || cached.text !== pair.candidate || cached.sourceText !== pair.source;
      });
      const reviewed = await reviewContentQuality({
        pairs: fresh, job,
        complete: (args) => invoke("content_review", undefined, args),
        timeoutMs: Math.max(1, Math.min(30_000, deadline - now() - 5_000)),
      });
      recordCandidateReviews(trace, reviewed);
      for (const [id, review] of reviewed) qualityReviews.set(id, review);
      for (const entry of [...opt.roles, ...(opt.projects ?? [])]) {
        for (const bullet of entry.bullets) {
          const review = qualityReviews.get(bullet.id);
          if (review?.status === "improved" && review.text === bullet.text) {
            approvedBullets.set(bullet.id, bullet);
          }
        }
      }
      opt = selectReviewedContent(opt, qualityReviews);
      // Restoring source text can change keyword density; validate the actual deliverable.
      const finalIssues = [
        ...validateOptimization(resume, opt, job),
        ...validateGroundedOptimization(resume, opt),
        ...(structureMode === "preserve" ? validatePreservedOptimization(resume, opt) : []),
        ...validateLockedOptimization({ resume, candidate: opt, baseline: baselineOptimization, lockedContentIds }),
      ];
      trace.validation.push({ attempt, stage: "selected", issues: [...finalIssues] });
      if (finalIssues.length) {
        lastIssues = finalIssues;
        feedbackByChunk = chunksForIssues({ resume, candidate: opt, issues: finalIssues, chunks });
        pending = chunks.filter(chunk => feedbackByChunk.has(chunkKey(chunk)));
        if (!pending.length) pending = chunks;
        continue;
      }
      // Keep a fully validated deliverable before attempting optional uplift.
      // A failed extra revision must not discard successful work.
      bestSafeOptimization = opt;
      const revisions = contentRevisionIssues(pairs, qualityReviews, qualityRevised);
      if (revisions.length && attempt < attempts && deadline - now() >= MIN_ATTEMPT_MS + 30_000) {
        feedbackByChunk = chunksForIssues({ resume, candidate: opt, issues: revisions.map(item => item.issue), chunks });
        pending = chunks.filter(chunk => feedbackByChunk.has(chunkKey(chunk)));
        if (pending.length) {
          for (const { id } of revisions) qualityRevised.add(id);
          continue;
        }
      }
      return respondWithOptimization(opt);
    }

    if (bestSafeOptimization) return respondWithOptimization(bestSafeOptimization, true);

    // Concrete safety issues beat a generic timeout notice: if we collected
    // any, the user gets something actionable even though we stopped early.
    if (lastIssues.length > 0) {
      console.error(
        `optimize exhausted attempts (${structureMode}, model=${model ?? "default"})`,
        lastIssues.slice(0, 20),
      );
    }

    return {
      ok: false as const,
      status: ranOutOfTime && lastIssues.length === 0 ? 504 : 422,
      error: ranOutOfTime && lastIssues.length === 0
        ? "The model took too long to rewrite this resume. Retry or choose a faster model."
        : "The rewrite could not pass the factual safety checks.",
      issues: lastIssues,
      trace: finishHarnessTrace(trace, null, lockedContentIds, now()),
    };
  }
  try { return await execute(); }
  catch (error) {
    console.error("optimization harness failed", error);
    return { ok: false as const, status: 502, error: "The rewrite provider could not complete this request.", issues: [] as string[], trace: finishHarnessTrace(trace, null, lockedContentIds, now()) };
  }
}
