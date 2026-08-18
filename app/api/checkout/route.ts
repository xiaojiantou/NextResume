// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSku, isSkuId, stripePriceId } from "@/lib/pricing";
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
    let sku = getSku("single");
    try {
      const body = (await req.json()) as {
        resume?: Resume;
        job?: JobAnalysis;
        report?: AtsReport;
        resumeStyleSource?: ResumeStyleSource | null;
        contentStructure?: ContentStructureMode;
        sku?: string;
      };
      if (isSkuId(body?.sku)) sku = getSku(body.sku);
      resume = body?.resume ?? null;

      job = body?.job ?? null;
      report = body?.report ?? null;
      resumeStyleSource = body?.resumeStyleSource ?? null;
      contentStructure =
        body?.contentStructure === "preserve" ? "preserve" : "optimize";
    } catch {
      // No body / not JSON — fine, older client behaviour.
    }

    // Packs are bought by a signed-in user because the balance has to belong
    // to someone; a single unlock stays open to signed-out buyers.
    const { userId } = await auth();
    const isPack = sku.credits > 1;
    if (isPack && !userId) {
      return NextResponse.json(
        { error: "Sign in to buy a resume pack." },
        { status: 401 },
      );
    }

    const orderId = crypto.randomUUID();
    const session = await createCheckoutSession({
      origin: req.nextUrl.origin,
      orderId,
      priceId: stripePriceId(sku),
      sku: sku.id,
    });


    if (!session.url) {
      return NextResponse.json(
        { error: "Stripe did not return a checkout URL." },
        { status: 502 },
      );
    }

    // userId is best-effort attribution for a single unlock — access there is
    // always granted by the order token, never by the session.
    await createOrder({
      id: orderId,
      stripeSessionId: session.id,
      userId: userId ?? null,
      source: "stripe",
      kind: isPack ? "credits" : "resume",
      sku: sku.id,
      ...(isPack ? { creditsPurchased: sku.credits } : {}),
    });

    // Save snapshot if we got one. A pack has no resume attached to it.
    // Non-fatal on failure.
    if (resume && !isPack) {

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
      sku: sku.id,
      kind: isPack ? "credits" : "resume",
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
