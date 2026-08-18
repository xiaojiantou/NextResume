// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { retrieveCheckoutSession } from "@/lib/stripe";
import { markOrderFromCheckoutSession } from "@/lib/orders";
import { signOrderToken } from "@/lib/tokens";


export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("session_id");
    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing checkout session id." },
        { status: 400 },
      );
    }

    const session = await retrieveCheckoutSession(sessionId);
    const order = await markOrderFromCheckoutSession({
      orderId: session.metadata?.order_id || session.client_reference_id,
      stripeSessionId: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
    });
    const paid =
      session.status === "complete" &&
      (session.payment_status === "paid" ||
        session.payment_status === "no_payment_required");

    // A pack order unlocks nothing by itself — marking it paid above credited
    // the buyer's balance instead, so it gets no resume token.
    const kind = order?.kind ?? "resume";

    // The token is what unlocks the paid endpoints, so it is only ever handed
    // out once Stripe itself has confirmed the session is paid.
    const token =
      paid && order && kind === "resume" ? signOrderToken(order.id) : null;

    return NextResponse.json({
      id: session.id,
      orderId: order?.id ?? null,
      kind,
      token,
      paid,
      status: session.status,
      paymentStatus: session.payment_status,
    });


  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not verify Stripe checkout session.",
      },
      { status: 500 },
    );
  }
}
