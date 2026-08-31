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
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import {
  MAX_TURNS,
  REFINE_SYSTEM,
  buildRefineUserMessage,
  normalizeTurns,
} from "@/lib/refineBullet";

import type { RefineTurn } from "@/lib/refineBullet";
import type { JobAnalysis, OptimizedBullet } from "@/lib/types";

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
      current,
      originalBullet,
      originalBulletId,
      turns,
      job,
      model,
    } = (await req.json()) as {
      instruction: string;
      current?: string;
      originalBullet: string;
      originalBulletId: string;
      turns?: RefineTurn[];
      job: JobAnalysis | null;
      model?: string;
    };

    if (!instruction || instruction.trim().length < 4) {
      return NextResponse.json(
        { error: "Tell me what to change — a few words is enough." },
        { status: 400 },
      );
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

    const bullet = await jsonCompletion<OptimizedBullet>({
      system: REFINE_SYSTEM,
      user: buildRefineUserMessage({
        instruction,
        current,
        originalBullet: originalBullet || "",
        originalBulletId,
        turns: history,
        job,
      }),
      model,
      maxTokens: 600,
    });

    // Guarantee the original id + attestation signal are in evidence. The
    // "voice-transcript" marker predates typed input and is kept verbatim:
    // persisted resumes carry it, and lib/store.ts keys the preserve-mode
    // baseline off it. It means "the candidate asserted this themselves",
    // whether they spoke it or typed it.
    const evidence = new Set(bullet.evidence || []);
    if (originalBulletId) evidence.add(originalBulletId);
    evidence.add("voice-transcript");
    bullet.evidence = Array.from(evidence);

    return NextResponse.json({ bullet });
  } catch (e) {
    console.error("refine-bullet failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Rewrite failed" },
      { status: 500 },
    );
  }
}
