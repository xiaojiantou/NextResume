// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createOrder, incrementPromoUse } from "@/lib/orders";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import { signOrderToken } from "@/lib/tokens";

export const runtime = "nodejs";

type PromoCode = { expiry: Date | null; maxUses: number | null };

// PROMO_CODES entries are "CODE", "CODE:YYYY-MM-DD" (valid until that date,
// UTC — the code stops working at 00:00 UTC on it), "CODE:YYYY-MM-DD:MAXUSES",
// or "CODE::MAXUSES" for a cap with no expiry.
function validCodes(): Map<string, PromoCode> {
  const codes = new Map<string, PromoCode>();

  for (const entry of (process.env.PROMO_CODES || "").split(",")) {
    const [rawCode, rawExpiry, rawMaxUses] = entry.split(":");
    const code = (rawCode || "").trim().toUpperCase();
    if (!code) continue;

    let expiry: Date | null = null;
    if (rawExpiry?.trim()) {
      const parsed = new Date(`${rawExpiry.trim()}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) expiry = parsed;
    }

    let maxUses: number | null = null;
    if (rawMaxUses?.trim()) {
      const parsed = Number.parseInt(rawMaxUses.trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) maxUses = parsed;
    }

    codes.set(code, { expiry, maxUses });
  }

  if (process.env.NODE_ENV !== "production") {
    codes.set("DEV-UNLOCK", { expiry: null, maxUses: null });
  }

  return codes;
}

function rejected() {
  return NextResponse.json(
    { error: "That code isn't valid or has expired." },
    { status: 404 },
  );
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.redeem);
  if (rl) return rl;
  try {
    const { code } = (await req.json()) as { code?: string };
    const submitted = (code || "").trim().toUpperCase();

    if (!submitted) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const promo = validCodes().get(submitted);
    if (!promo) return rejected();

    if (promo.expiry && Date.now() >= promo.expiry.getTime()) {
      return rejected();
    }

    // Count the redemption before minting anything, so a capped code can't be
    // spent past its limit by concurrent requests.
    const uses = await incrementPromoUse(submitted);
    if (promo.maxUses !== null && uses > promo.maxUses) {
      return NextResponse.json(
        { error: "That code has already been fully redeemed." },
        { status: 410 },
      );
    }

    // A promo redemption mints a real paid order, so the unlocked session goes
    // through exactly the same server-side gate a Stripe purchase does.
    const { userId } = await auth();
    const orderId = crypto.randomUUID();
    await createOrder({
      id: orderId,
      status: "paid",
      source: "promo",
      userId: userId ?? null,
    });

    return NextResponse.json({
      ok: true,
      code: submitted,
      orderId,
      token: signOrderToken(orderId),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Redeem failed" },
      { status: 500 },
    );
  }
}
