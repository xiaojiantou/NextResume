// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Rewrites a single bullet from the candidate's own instruction.
//
// Replaces the older voice-only, single-shot endpoint. Two things changed:
// the instruction can now be typed as well as spoken, and a refinement is a
// conversation — each round sees the rounds before it, so "shorter" after
// "mention Google Cloud" means both, not just the last one.
import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import { requirePaidOrder } from "@/lib/entitlement";
import { normalizeEstimateRetractions, normalizePriorEvidence, refinementEvidenceLedger, normalizeConfirmedEstimates } from "@/lib/evidenceLedger";
import { runRefinementHarness } from "@/lib/refinementHarness";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import {
  MAX_TURNS,
  normalizeTurns,
} from "@/lib/refineBullet";

import type { RefineTurn } from "@/lib/refineBullet";
import type { JobAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.refineBullet);
  if (rl) return rl;

  const entitlement = await requirePaidOrder(req);
  if (!entitlement.ok) return entitlement.response;

  try {
    const {
      instruction,
      confirmedEvidence,
      priorEvidence,
      current,
      originalBullet,
      originalBulletId,
      turns,
      job,
      model,
    } = (await req.json()) as {
      instruction: string;
      priorEvidence?: unknown;
      confirmedEvidence?: { sourceText: string; notes?: string; estimates?: unknown; removedEstimates?: unknown };
      current?: string;
      originalBullet: string;
      originalBulletId: string;
      turns?: RefineTurn[];
      job: JobAnalysis | null;
      model?: string;
    };

    if (typeof instruction !== "string" || instruction.trim().length < 4 || instruction.length > 4000) {
      return NextResponse.json(
        { error: "Tell me what to change — a few words is enough." },
        { status: 400 },
      );
    }

    if (typeof originalBullet !== "string" || !originalBullet.trim() || originalBullet.length > 6000 ||
        typeof originalBulletId !== "string" || !originalBulletId.trim() || originalBulletId.length > 200 ||
        (current !== undefined && (typeof current !== "string" || current.length > 6000)) ||
        (turns !== undefined && (!Array.isArray(turns) || turns.length > MAX_TURNS ||
          turns.some(turn => !turn || typeof turn !== "object" ||
            (turn.instruction !== undefined && (typeof turn.instruction !== "string" || turn.instruction.length > 6000)) ||
            (turn.result !== undefined && (typeof turn.result !== "string" || turn.result.length > 6000)))))) {
      return NextResponse.json({ error: "The source bullet or refinement history is invalid." }, { status: 400 });
    }
    const history = normalizeTurns(turns);
    if (history.length >= MAX_TURNS) {
      return NextResponse.json(
        {
          error: `That's ${MAX_TURNS} rounds on one bullet. Accept the best version or start over.`,
          limit: "turns",
        },
        { status: 400 },
      );
    }

    let ledger;
    try {
      if (confirmedEvidence && (confirmedEvidence.sourceText !== originalBullet ||
          (confirmedEvidence.notes !== undefined && (typeof confirmedEvidence.notes !== "string" || confirmedEvidence.notes.length > 3000)))) {
        throw new Error("The confirmed evidence does not match this source bullet.");
      }
      ledger = refinementEvidenceLedger({
        source: originalBullet, prior: normalizePriorEvidence(priorEvidence),
        removedEstimates: normalizeEstimateRetractions(confirmedEvidence?.removedEstimates),
        notes: confirmedEvidence?.notes || "", estimates: normalizeConfirmedEstimates(confirmedEvidence?.estimates),
        instructions: [...history.map(turn => turn.instruction), instruction], now: new Date().toISOString(),
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid confirmed evidence." }, { status: 400 });
    }
    const result = await runRefinementHarness({
      instruction, current, originalBullet, originalBulletId, turns: history, job, ledger, model,
    }, args => jsonCompletion({ ...args, model }));
    if (!result.ok) return NextResponse.json({ error: result.error, review: result.review, refinementTrace: result.trace }, { status: result.status });
    return NextResponse.json({ bullet: result.bullet });
  } catch (e) {
    console.error("refine-bullet failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Rewrite failed" },
      { status: 500 },
    );
  }
}
