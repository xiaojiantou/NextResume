// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getCredits } from "@/lib/orders";
import { configuredSkus } from "@/lib/pricing";

export const runtime = "nodejs";

// Balance + what's purchasable, for the checkout page. Signed-out visitors get
// a zero balance rather than an error — they can still buy a single unlock.
export async function GET() {
  const { userId } = await auth();
  const credits = userId ? await getCredits(userId) : 0;
  return NextResponse.json({
    credits,
    signedIn: Boolean(userId),
    skus: configuredSkus().map((sku) => ({
      id: sku.id,
      label: sku.label,
      credits: sku.credits,
      amount: sku.amount,
      perResume: sku.perResume,
      blurb: sku.blurb,
    })),
  });
}
