// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, unlinkSync } from "node:fs";
import {
  claimCreditGrant,
  consumeCredit,
  createOrder,
  getCredits,
  grantCredits,
  incrementPromoUse,
  markOrderFromCheckoutSession,
} from "../lib/orders.ts";

// These exercise the file-backed dev store, which is what runs whenever no
// Redis credentials are configured.
const STORE = new URL("../.nextresume-orders.json", import.meta.url).pathname;
const cleanup = () => {
  if (existsSync(STORE)) unlinkSync(STORE);
};

test("credits: grant, spend down to zero, then refuse to go negative", async (t) => {
  t.after(cleanup);
  const user = "user_spend";

  assert.equal(await getCredits(user), 0);
  assert.equal(await grantCredits(user, 5), 5);

  for (const expected of [4, 3, 2, 1, 0]) {
    assert.equal(await consumeCredit(user), expected);
  }

  // Empty balance returns null rather than a negative balance.
  assert.equal(await consumeCredit(user), null);
  assert.equal(await getCredits(user), 0);
});

test("credits: a non-positive grant leaves the balance untouched", async (t) => {
  t.after(cleanup);
  const user = "user_zero";
  await grantCredits(user, 3);
  assert.equal(await grantCredits(user, 0), 3);
  assert.equal(await grantCredits(user, -2), 3);
});

test("credits: a grant lock can only be claimed once", async (t) => {
  t.after(cleanup);
  assert.equal(await claimCreditGrant("order_lock"), true);
  assert.equal(await claimCreditGrant("order_lock"), false);
  assert.equal(await claimCreditGrant("order_other"), true);
});

test("credits: a paid pack credits the buyer exactly once", async (t) => {
  t.after(cleanup);
  const user = "user_pack";
  const orderId = "order_pack";

  await createOrder({
    id: orderId,
    stripeSessionId: "cs_pack",
    userId: user,
    kind: "credits",
    sku: "pack5",
    creditsPurchased: 5,
  });
  assert.equal(await getCredits(user), 0);

  const paid = {
    orderId,
    stripeSessionId: "cs_pack",
    status: "complete",
    paymentStatus: "paid",
  };

  // The Stripe webhook and the success page's session lookup both land here.
  await markOrderFromCheckoutSession(paid);
  await markOrderFromCheckoutSession(paid);

  assert.equal(await getCredits(user), 5);
});

test("credits: an unpaid pack credits nothing", async (t) => {
  t.after(cleanup);
  const user = "user_unpaid";
  const orderId = "order_unpaid";

  await createOrder({
    id: orderId,
    stripeSessionId: "cs_unpaid",
    userId: user,
    kind: "credits",
    sku: "pack5",
    creditsPurchased: 5,
  });
  await markOrderFromCheckoutSession({
    orderId,
    stripeSessionId: "cs_unpaid",
    status: "open",
    paymentStatus: "unpaid",
  });

  assert.equal(await getCredits(user), 0);
});

test("credits: a paid single unlock is not a pack and credits nothing", async (t) => {
  t.after(cleanup);
  const user = "user_single";
  const orderId = "order_single";

  await createOrder({
    id: orderId,
    stripeSessionId: "cs_single",
    userId: user,
    kind: "resume",
    sku: "single",
  });
  await markOrderFromCheckoutSession({
    orderId,
    stripeSessionId: "cs_single",
    status: "complete",
    paymentStatus: "paid",
  });

  assert.equal(await getCredits(user), 0);
});

test("promo codes: redemptions are counted so a cap can retire a code", async (t) => {
  t.after(cleanup);
  assert.equal(await incrementPromoUse("LAUNCH"), 1);
  assert.equal(await incrementPromoUse("LAUNCH"), 2);
  assert.equal(await incrementPromoUse("OTHER"), 1);
});
