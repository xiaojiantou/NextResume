// Copyright (c) 2026 HowBe LLC. All rights reserved.
import { buildRefineUserMessage, REFINE_SYSTEM } from "./refineBullet.ts";
import { confirmedEvidenceText, type EvidenceRecord } from "./evidenceLedger.ts";
import { reviewRefinement, type RefinementReview } from "./refinementReview.ts";
import type { QualityCompletion } from "./contentQuality.ts";
import type { OptimizedBullet } from "./types";

export type RefinementTrace = {
  version: 1; model: string; elapsedMs: number;
  outcome: "approved" | "rejected" | "unavailable";
  calls: Array<{ stage: "generate" | "review"; elapsedMs: number; outcome: "completed" | "failed" }>;
};
export type RefinementInput = {
  instruction: string; current?: string; originalBullet: string; originalBulletId: string;
  turns: Array<{ instruction: string; result: string }>; job: unknown; ledger: EvidenceRecord[]; model?: string;
};

export async function runRefinementHarness(input: RefinementInput, complete: QualityCompletion, options: { generationTimeoutMs?: number; reviewTimeoutMs?: number } = {}) {
  const started = Date.now();
  const trace: RefinementTrace = { version: 1, model: input.model || "configured-default", elapsedMs: 0, outcome: "unavailable", calls: [] };
  const invoke = async (stage: "generate" | "review", args: Parameters<QualityCompletion>[0]) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const began = Date.now();
    let outcome: "completed" | "failed" = "failed";
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Refinement timed out.")); },
          stage === "generate" ? options.generationTimeoutMs ?? 25_000 : options.reviewTimeoutMs ?? 14_000);
      });
      const result = await Promise.race([complete({ ...args, signal: controller.signal }), timeout]);
      outcome = "completed";
      return result;
    } finally {
      clearTimeout(timer);
      trace.calls.push({ stage, elapsedMs: Date.now() - began, outcome });
    }
  };
  const finish = (outcome: RefinementTrace["outcome"]) => {
    trace.outcome = outcome;
    trace.elapsedMs = Date.now() - started;
    return trace;
  };
  let raw: unknown;
  try {
    raw = await invoke("generate", {
      system: REFINE_SYSTEM,
      user: buildRefineUserMessage({ ...input, instruction: [confirmedEvidenceText(input.ledger), input.instruction].filter(Boolean).join("\n\n") }),
      maxTokens: 900,
    });
  } catch {
    return { ok: false as const, status: 503, error: "The rewrite could not finish. Your current bullet is unchanged; try again.", trace: finish("unavailable") };
  }
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (typeof row.text !== "string" || !row.text.trim() || row.text.length > 6000) {
    return { ok: false as const, status: 503, error: "The model returned an incomplete rewrite. Your current bullet is unchanged; try again.", trace: finish("unavailable") };
  }
  const text = row.text.trim();
  const review: RefinementReview = await reviewRefinement({
    candidate: text, ledger: input.ledger, current: input.current, turns: input.turns,
    complete: args => invoke("review", args),
  });
  if (review.status !== "approved") {
    return {
      ok: false as const, status: review.status === "rejected" ? 422 : 503,
      error: review.status === "rejected" ? `This rewrite needs a correction: ${review.reason} Your current bullet is unchanged.` : review.reason,
      review, trace: finish(review.status),
    };
  }
  // The model cannot invent evidence IDs, attestation markers or review metadata.
  const bullet: OptimizedBullet = {
    id: input.originalBulletId, text, evidence: [input.originalBulletId, "voice-transcript"],
    matchedKeywords: Array.isArray(row.matchedKeywords) ? row.matchedKeywords.filter((v): v is string => typeof v === "string").slice(0, 3) : [],
    rationale: typeof row.rationale === "string" ? row.rationale.slice(0, 800) : "",
    evidenceLedger: input.ledger, refinementReview: review, refinementTrace: finish("approved"),
  };
  return { ok: true as const, bullet };
}
