import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/stripe";
import { createOrder, saveOrderSnapshot } from "@/lib/orders";
import type { JobAnalysis, Resume } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Optional body: resume + job snapshot to persist alongside the order,
    // so the buyer can access their resume from any device via the email link.
    let resume: Resume | null = null;
    let job: JobAnalysis | null = null;
    try {
      const body = (await req.json()) as {
        resume?: Resume;
        job?: JobAnalysis;
      };
      resume = body?.resume ?? null;
      job = body?.job ?? null;
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

    await createOrder({ id: orderId, stripeSessionId: session.id });

    // Save snapshot if we got one. Non-fatal on failure.
    if (resume) {
      try {
        await saveOrderSnapshot(orderId, {
          resume,
          job,
          optimization: null,
          optimizationModel: null,
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
