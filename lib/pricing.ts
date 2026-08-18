// Copyright (c) 2026 HowBe LLC. All rights reserved.

// What you can buy. One-off unlocks stay the entry price; credit packs exist
// so a repeat applicant isn't paying the single-resume rate on their fifth
// application — that's the point where per-resume pricing loses to a
// competitor's subscription.
//
// `amount` is display copy only. Stripe is the source of truth for what gets
// charged, so each SKU's price id env var must point at a Stripe price with
// the matching amount.

export type SkuId = "single" | "pack5" | "pack20";

export type Sku = {
  id: SkuId;
  label: string;
  // Resumes unlocked. 1 means the classic "pay for this one rewrite" flow.
  credits: number;
  amount: string;
  perResume: string;
  priceEnv: string;
  blurb: string;
};

export const SKUS: Record<SkuId, Sku> = {
  single: {
    id: "single",
    label: "This resume",
    credits: 1,
    amount: "$9.99",
    perResume: "$9.99 per resume",
    priceEnv: "STRIPE_PRICE_ID",
    blurb: "Unlock the rewrite you're looking at.",
  },
  pack5: {
    id: "pack5",
    label: "5 resumes",
    credits: 5,
    amount: "$19.99",
    perResume: "$4.00 per resume",
    priceEnv: "STRIPE_PRICE_ID_PACK5",
    blurb: "Tailor a fresh resume for each of your next five roles.",
  },
  pack20: {
    id: "pack20",
    label: "20 resumes",
    credits: 20,
    amount: "$49.99",
    perResume: "$2.50 per resume",
    priceEnv: "STRIPE_PRICE_ID_PACK20",
    blurb: "For a full search — apply broadly without rationing.",
  },
};

export function isSkuId(value: unknown): value is SkuId {
  return typeof value === "string" && value in SKUS;
}

export function getSku(id: SkuId): Sku {
  return SKUS[id];
}

// A pack whose Stripe price id isn't configured is hidden rather than shown
// as a button that 500s.
export function configuredSkus(): Sku[] {
  return Object.values(SKUS).filter((sku) => Boolean(process.env[sku.priceEnv]));
}

export function stripePriceId(sku: Sku): string {
  const priceId = process.env[sku.priceEnv];
  if (!priceId) {
    throw new Error(
      `Missing ${sku.priceEnv} — configure the Stripe price for "${sku.label}".`,
    );
  }
  return priceId;
}
