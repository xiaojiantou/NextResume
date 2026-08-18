// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  consumeCredit,
  createOrder,
  grantCredits,
  saveOrderSnapshot,
} from "@/lib/orders";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import { signOrderToken } from "@/lib/tokens";
import type {
  AtsReport,
  ContentStructureMode,
  JobAnalysis,
  Resume,
  ResumeStyleSource,
} from "@/lib/types";

export const runtime = "nodejs";

// Spends one credit to unlock the resume the user is currently working on.
// The credit mints an ordinary paid order, so everything downstream — the
// paywall, the email link, the snapshot — behaves exactly like a Stripe buy.
export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.redeem);
  if (rl) return rl;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to use a resume credit." },
      { status: 401 },
    );
  }

  let resume: Resume | null = null;
  let job: JobAnalysis | null = null;
  let report: AtsReport | null = null;
  let resumeStyleSource: ResumeStyleSource | null = null;
  let contentStructure: ContentStructureMode = "optimize";
  try {
    const body = (await req.json()) as {
      resume?: Resume;
      job?: JobAnalysis;
      report?: AtsReport;
      resumeStyleSource?: ResumeStyleSource | null;
      contentStructure?: ContentStructureMode;
    };
    resume = body?.resume ?? null;
    job = body?.job ?? null;
    report = body?.report ?? null;
    resumeStyleSource = body?.resumeStyleSource ?? null;
    contentStructure =
      body?.contentStructure === "preserve" ? "preserve" : "optimize";
  } catch {
    // No body is fine — the unlock still works, just without a snapshot.
  }

  const remaining = await consumeCredit(userId);
  if (remaining === null) {
    return NextResponse.json(
      { error: "You don't have any resume credits left.", code: "no_credits" },
      { status: 402 },
    );
  }

  const orderId = crypto.randomUUID();
  try {
    await createOrder({
      id: orderId,
      status: "paid",
      source: "credits",
      kind: "resume",
      userId,
    });
  } catch (e) {
    // Never swallow a credit we failed to turn into an order.
    await grantCredits(userId, 1);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Could not unlock with a credit.",
      },
      { status: 500 },
    );
  }

  if (resume) {
    try {
      await saveOrderSnapshot(orderId, {
        resume,
        job,
        report,
        optimization: null,
        optimizationModel: null,
        optimizationStructureMode: null,
        optimizationVariants: [],
        contentStructure,
        lockedContentIds: [],
        resumeStyleSource,
        personalizedStyleProfile: null,
      });
    } catch (e) {
      console.error("[credits] saveOrderSnapshot failed", e);
    }
  }

  return NextResponse.json({
    ok: true,
    orderId,
    token: signOrderToken(orderId),
    remaining,
  });
}
