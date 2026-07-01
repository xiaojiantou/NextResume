const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return key;
}

async function stripeRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${stripeKey()}`,
      ...init.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) {
    const message =
      data?.error?.message || data?.error || "Stripe request failed";
    throw new Error(message);
  }
  return data as T;
}

export type CheckoutSession = {
  id: string;
  url: string | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  status: "open" | "complete" | "expired";
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
};

export async function createCheckoutSession({
  origin,
  orderId,
}: {
  origin: string;
  orderId: string;
}): Promise<CheckoutSession> {
  const price = process.env.STRIPE_PRICE_ID;
  if (!price) throw new Error("Missing STRIPE_PRICE_ID");

  const body = new URLSearchParams({
    mode: "payment",
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout`,
    client_reference_id: orderId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "metadata[product]": "nextresume_optimized_resume",
    "metadata[order_id]": orderId,
  });

  return stripeRequest<CheckoutSession>("/checkout/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

export async function retrieveCheckoutSession(
  sessionId: string,
): Promise<CheckoutSession> {
  const encoded = encodeURIComponent(sessionId);
  return stripeRequest<CheckoutSession>(`/checkout/sessions/${encoded}`);
}
