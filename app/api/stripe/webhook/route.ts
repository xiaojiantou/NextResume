import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { markOrderFromCheckoutSession } from "@/lib/orders";
import { sendOrderReadyEmail } from "@/lib/email";
import type { CheckoutSession } from "@/lib/stripe";

export const runtime = "nodejs";

type StripeEvent = {
  id: string;
  type: string;
  data: {
    object: CheckoutSession;
  };
};

function verifyStripeSignature({
  payload,
  signature,
  secret,
}: {
  payload: string;
  signature: string;
  secret: string;
}) {
  const parts = Object.fromEntries(
    signature.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );
  const timestamp = parts.t;
  const expected = parts.v1;

  if (!timestamp || !expected) {
    throw new Error("Invalid Stripe signature header.");
  }

  const signedPayload = `${timestamp}.${payload}`;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const actualBuffer = Buffer.from(expected, "hex");
  const expectedBuffer = Buffer.from(digest, "hex");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Stripe webhook signature verification failed.");
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Missing STRIPE_WEBHOOK_SECRET" },
      { status: 500 },
    );
  }

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe signature" },
      { status: 400 },
    );
  }

  try {
    verifyStripeSignature({ payload, signature, secret });
    const event = JSON.parse(payload) as StripeEvent;

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.expired"
    ) {
      const session = event.data.object;
      const order = await markOrderFromCheckoutSession({
        orderId: session.metadata?.order_id || session.client_reference_id,
        stripeSessionId: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
      });

      // Fire the "resume ready" email on successful payment. Non-fatal.
      if (order?.status === "paid") {
        const to =
          session.customer_details?.email || session.customer_email || "";
        if (to) {
          try {
            await sendOrderReadyEmail({
              to,
              name: session.customer_details?.name || undefined,
              orderId: order.id,
            });
          } catch (err) {
            console.error("[webhook] email send failed", err);
          }
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not process Stripe webhook.",
      },
      { status: 400 },
    );
  }
}
