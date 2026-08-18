// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Server-side paywall. Every endpoint that spends OpenAI credits on a paid
// deliverable must call requirePaidOrder() before doing any work.
//
// The client proves entitlement by presenting the order id plus its HMAC
// token — the same pair the "your resume is ready" email embeds, so the
// same-device flow and the email-link flow use one mechanism. There is no
// Clerk session requirement: buyers are deliberately allowed to check out
// without an account, and the email link has no session by design.
//
// Credentials travel as headers so the binary PDF route can read them the
// same way the JSON routes do; query params are accepted as a fallback.

import { NextRequest, NextResponse } from "next/server";
import { getOrder, type Order } from "./orders";
import { verifyOrderToken } from "./tokens";

export const ORDER_ID_HEADER = "x-nextresume-order";
export const ORDER_TOKEN_HEADER = "x-nextresume-token";

export type Entitlement =
  | { ok: true; order: Order }
  | { ok: false; response: NextResponse };

function readCredentials(req: NextRequest): { orderId: string; token: string } {
  const orderId =
    req.headers.get(ORDER_ID_HEADER) ||
    req.nextUrl.searchParams.get("order") ||
    "";
  const token =
    req.headers.get(ORDER_TOKEN_HEADER) ||
    req.nextUrl.searchParams.get("token") ||
    "";
  return { orderId: orderId.trim(), token: token.trim() };
}

function unauthorized(): NextResponse {
  // Deliberately identical for "no credentials", "bad signature", and
  // "no such order" — none of them should confirm whether an id exists.
  return NextResponse.json(
    {
      error:
        "This request isn't linked to a paid order. Reopen your resume from the link in your confirmation email.",
      code: "not_entitled",
    },
    { status: 401 },
  );
}

export async function requirePaidOrder(req: NextRequest): Promise<Entitlement> {
  const { orderId, token } = readCredentials(req);
  if (!orderId || !token) return { ok: false, response: unauthorized() };
  if (!verifyOrderToken(orderId, token)) {
    return { ok: false, response: unauthorized() };
  }

  const order = await getOrder(orderId);
  if (!order) return { ok: false, response: unauthorized() };

  if (order.status !== "paid") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Payment for this order hasn't completed yet. If you just paid, give Stripe a moment and refresh.",
          code: "payment_incomplete",
        },
        { status: 402 },
      ),
    };
  }

  return { ok: true, order };
}
