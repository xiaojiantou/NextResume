// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createCheckoutSession } from "@/lib/stripe";

import { createOrder, saveOrderSnapshot } from "@/lib/orders";
import type {
  ContentStructureMode,
  AtsReport,
  JobAnalysis,
  Resume,
  ResumeStyleSource,
} from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Optional body: resume + job snapshot to persist alongside the order,
    // so the buyer can access their resume from any device via the email link.
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
      // No body / not JSON — fine, older client behaviour.
    }

    const orderId = crypto.randomUUID();
    const session = await createCheckoutSession({
      origin: req.nextUrl.origin,
      orderId,
    });

    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL." },
        { status: 502 },
      );
    }

    // Best-effort attribution only — checkout is deliberately open to
    // signed-out buyers, so access is always granted by the order token.
    const { userId } = await auth();
    await createOrder({
      id: orderId,
      stripeSessionId: session.id,
      userId: userId ?? null,
      source: "stripe",
    });


    // Save snapshot if we got one. Non-fatal on failure.
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
        console.error("[checkout] saveOrderSnapshot failed", e);
      }
    }

    return NextResponse.json({
      url: session.url,
      id: session.id,
      orderId,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not create Stripe checkout session.",
      },
      { status: 500 },
    );
  }
}
