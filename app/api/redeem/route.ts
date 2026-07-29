// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";

export const runtime = "nodejs";

// PROMO_CODES entries are either "CODE" (never expires) or "CODE:YYYY-MM-DD"
// (valid until that date, UTC — the code stops working at 00:00 UTC on it).
function validCodes(): Map<string, Date | null> {
  const codes = new Map<string, Date | null>();

  for (const entry of (process.env.PROMO_CODES || "").split(",")) {
    const [rawCode, rawExpiry] = entry.split(":");
    const code = (rawCode || "").trim().toUpperCase();
    if (!code) continue;

    let expiry: Date | null = null;
    if (rawExpiry?.trim()) {
      const parsed = new Date(`${rawExpiry.trim()}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) expiry = parsed;
    }
    codes.set(code, expiry);
  }

  if (process.env.NODE_ENV !== "production") {
    codes.set("DEV-UNLOCK", null);
  }

  return codes;
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

    const codes = validCodes();
    if (!codes.has(submitted)) {
      return NextResponse.json(
        { error: "That code isn't valid or has expired." },
        { status: 404 },
      );
    }

    const expiry = codes.get(submitted);
    if (expiry && Date.now() >= expiry.getTime()) {
      return NextResponse.json(
        { error: "That code isn't valid or has expired." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, code: submitted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Redeem failed" },
      { status: 500 },
    );
  }
}
