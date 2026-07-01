import { NextRequest, NextResponse } from "next/server";
import { retrieveCheckoutSession } from "@/lib/stripe";
import { markOrderFromCheckoutSession } from "@/lib/orders";

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

    return NextResponse.json({
      id: session.id,
      orderId: order?.id ?? null,
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
