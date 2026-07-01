import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/stripe";
import { createOrder } from "@/lib/orders";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
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
