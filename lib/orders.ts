// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Order store — durable across serverless cold starts + concurrent webhooks.
//
// Backends (auto-selected by env):
//   • Redis (via @upstash/redis SDK) — works with:
//     - Native Upstash: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//     - Vercel Marketplace Redis: KV_REST_API_URL + KV_REST_API_TOKEN
//     Per-order keys + a session→order index, so concurrent Stripe webhooks
//     can't clobber each other.
//   • Dev: single JSON file at .nextresume-orders.json (gitignored).

import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";
import type {
  JobAnalysis,
  AtsReport,
  ContentStructureMode,
  Optimization,
  OptimizationVariant,
  Resume,
  ResumeStyleProfile,
  ResumeStyleSource,
} from "./types";
import type { PdfStyle, TargetPages } from "./pdf/config";
import type { ResumeFitVariant } from "./resumeFit";

type OrderStatus = "pending" | "paid" | "expired";

export type OrderSource = "stripe" | "promo" | "credits";

// "resume" orders unlock one rewrite. "credits" orders buy a pack and unlock
// nothing themselves — the webhook turns them into a credit balance, and each
// credit later mints its own paid "resume" order.
export type OrderKind = "resume" | "credits";


export type Order = {
  id: string;
  // Null for promo-code orders, which never touch Stripe.
  stripeSessionId: string | null;
  status: OrderStatus;
  paymentStatus?: string;
  email?: string;
  // Clerk user, when the buyer happened to be signed in. Checkout works
  // signed-out by design, so this is best-effort attribution — never the
  // thing that grants access.
  userId?: string | null;
  source?: OrderSource;
  kind?: OrderKind;
  sku?: string;
  creditsPurchased?: number;
  createdAt: string;

  updatedAt: string;
};


// The buyer's data attached to an order — hydrated on the /result page when
// they click through from the email on a new device.
export type OrderSnapshot = {
  resume: Resume;
  job: JobAnalysis | null;
  report?: AtsReport | null;
  optimization: Optimization | null;
  optimizationModel: string | null;
  optimizationStructureMode?: ContentStructureMode | null;
  optimizationVariants?: OptimizationVariant[];
  contentStructure?: ContentStructureMode;
  lockedContentIds?: string[];
  resumeStyleSource?: ResumeStyleSource | null;
  personalizedStyleProfile?: ResumeStyleProfile | null;
  pdfStyle?: PdfStyle;
  pdfPalette?: string;
  targetPages?: TargetPages;
  fitVariants?: ResumeFitVariant[];
  fitKeepIds?: string[];
  updatedAt: string;
};

const STORE_PATH = path.join(process.cwd(), ".nextresume-orders.json");
const ORDER_KEY = (id: string) => `nextresume:order:${id}`;
const SESSION_KEY = (sid: string) => `nextresume:session:${sid}`;
const SNAPSHOT_KEY = (id: string) => `nextresume:snapshot:${id}`;
const PROMO_KEY = (code: string) => `nextresume:promo:${code}`;
const CREDITS_KEY = (userId: string) => `nextresume:credits:${userId}`;
const GRANT_KEY = (orderId: string) => `nextresume:grant:${orderId}`;



export function hasRedis() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN) ||
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
  );
}

let _redis: Redis | null = null;
export function getRedis(): Redis {
  if (_redis) return _redis;
  // The SDK reads either UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN.
  // If neither is set, alias KV_* → UPSTASH_* so fromEnv() finds them.
  if (
    !process.env.UPSTASH_REDIS_REST_URL &&
    process.env.KV_REST_API_URL
  ) {
    process.env.UPSTASH_REDIS_REST_URL = process.env.KV_REST_API_URL;
  }
  if (
    !process.env.UPSTASH_REDIS_REST_TOKEN &&
    process.env.KV_REST_API_TOKEN
  ) {
    process.env.UPSTASH_REDIS_REST_TOKEN = process.env.KV_REST_API_TOKEN;
  }
  _redis = Redis.fromEnv();
  return _redis;
}

function guardProd() {
  if (process.env.NODE_ENV === "production" && !hasRedis()) {
    throw new Error(
      "Missing production order store. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL + KV_REST_API_TOKEN).",
    );
  }
}

// --- file-backed helpers (dev only) --------------------------------------
type FileStore = { orders: Record<string, Order> };

async function readFileStore(): Promise<FileStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as FileStore;
  } catch (e) {
    if (
      typeof e === "object" &&
      e &&
      "code" in e &&
      (e as { code?: string }).code === "ENOENT"
    ) {
      return { orders: {} };
    }
    throw e;
  }
}

async function writeFileStore(store: FileStore) {
  await fs.writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

// --- public API ----------------------------------------------------------

export async function createOrder({
  id,
  stripeSessionId = null,
  status = "pending",
  source = "stripe",
  userId = null,
  kind = "resume",
  sku,
  creditsPurchased,
}: {
  id: string;
  stripeSessionId?: string | null;
  // Promo redemptions and spent credits mint an already-paid order; Stripe
  // orders start pending and are flipped by the webhook.
  status?: OrderStatus;
  source?: OrderSource;
  userId?: string | null;
  kind?: OrderKind;
  sku?: string;
  creditsPurchased?: number;
}): Promise<Order> {
  guardProd();
  const now = new Date().toISOString();
  const order: Order = {
    id,
    stripeSessionId,
    status,
    source,
    userId,
    kind,
    ...(sku ? { sku } : {}),
    ...(creditsPurchased ? { creditsPurchased } : {}),
    createdAt: now,
    updatedAt: now,
  };


  if (hasRedis()) {
    const redis = getRedis();
    // Two atomic writes: the order + the session→order index.
    await Promise.all([
      redis.set(ORDER_KEY(id), JSON.stringify(order)),
      ...(stripeSessionId
        ? [redis.set(SESSION_KEY(stripeSessionId), id)]
        : []),
    ]);
    return order;
  }


  const store = await readFileStore();
  store.orders[id] = order;
  await writeFileStore(store);
  return order;
}

function coerceOrder(raw: unknown): Order | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Order;
    } catch {
      return null;
    }
  }
  return raw as Order;
}

export async function getOrder(id: string): Promise<Order | null> {
  guardProd();
  if (hasRedis()) {
    const raw = await getRedis().get(ORDER_KEY(id));
    return coerceOrder(raw);
  }
  const store = await readFileStore();
  return store.orders[id] ?? null;
}

export async function findOrderBySessionId(
  stripeSessionId: string,
): Promise<Order | null> {
  guardProd();
  if (hasRedis()) {
    const id = await getRedis().get<string>(SESSION_KEY(stripeSessionId));
    if (!id) return null;
    return getOrder(id);
  }
  const store = await readFileStore();
  return (
    Object.values(store.orders).find(
      (o) => o.stripeSessionId === stripeSessionId,
    ) ?? null
  );
}

export async function markOrderFromCheckoutSession({
  orderId,
  stripeSessionId,
  status,
  paymentStatus,
  email,
}: {
  orderId?: string | null;
  stripeSessionId: string;
  status: string;
  paymentStatus: string;
  email?: string | null;
}): Promise<Order | null> {
  guardProd();

  const order = orderId
    ? await getOrder(orderId)
    : await findOrderBySessionId(stripeSessionId);
  if (!order) return null;

  const paid =
    status === "complete" &&
    (paymentStatus === "paid" || paymentStatus === "no_payment_required");
  order.status = paid ? "paid" : status === "expired" ? "expired" : "pending";
  if (email) order.email = email;
  order.paymentStatus = paymentStatus;
  order.updatedAt = new Date().toISOString();

  if (hasRedis()) {
    await getRedis().set(ORDER_KEY(order.id), JSON.stringify(order));
  } else {
    const store = await readFileStore();
    store.orders[order.id] = order;
    await writeFileStore(store);
  }

  // A paid pack turns into a balance. Guarded by a one-shot lock because the
  // webhook and the success page both land here for the same order.
  if (
    paid &&
    order.kind === "credits" &&
    order.userId &&
    order.creditsPurchased
  ) {
    if (await claimCreditGrant(order.id)) {
      await grantCredits(order.userId, order.creditsPurchased);
    }
  }

  return order;
}


// --- promo codes ---------------------------------------------------------

// Counts one redemption and returns the new total, so a code carrying a
// max-uses cap can be retired once it's been spent.
export async function incrementPromoUse(code: string): Promise<number> {
  guardProd();
  if (hasRedis()) {
    return getRedis().incr(PROMO_KEY(code));
  }
  const store = await readFileStore();
  const anyStore = store as unknown as {
    orders: Record<string, Order>;
    promoUses?: Record<string, number>;
  };
  anyStore.promoUses = anyStore.promoUses || {};
  const next = (anyStore.promoUses[code] ?? 0) + 1;
  anyStore.promoUses[code] = next;
  await writeFileStore(anyStore as FileStore);
  return next;
}

// --- credits -------------------------------------------------------------

type CreditStore = {
  orders: Record<string, Order>;
  credits?: Record<string, number>;
  grants?: Record<string, true>;
};

export async function getCredits(userId: string): Promise<number> {
  guardProd();
  if (hasRedis()) {
    const raw = await getRedis().get<number | string>(CREDITS_KEY(userId));
    const value = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
    return Number.isFinite(value) && (value as number) > 0
      ? (value as number)
      : 0;
  }
  const store = (await readFileStore()) as unknown as CreditStore;
  return store.credits?.[userId] ?? 0;
}

export async function grantCredits(
  userId: string,
  amount: number,
): Promise<number> {
  guardProd();
  if (amount <= 0) return getCredits(userId);
  if (hasRedis()) {
    return getRedis().incrby(CREDITS_KEY(userId), amount);
  }
  const store = (await readFileStore()) as unknown as CreditStore;
  store.credits = store.credits || {};
  const next = (store.credits[userId] ?? 0) + amount;
  store.credits[userId] = next;
  await writeFileStore(store as FileStore);
  return next;
}

// Spends one credit, or returns null when the balance is empty. The Redis path
// decrements first and gives the credit back on underflow, so two concurrent
// spends can never both win the last one.
export async function consumeCredit(userId: string): Promise<number | null> {
  guardProd();
  if (hasRedis()) {
    const redis = getRedis();
    const remaining = await redis.decr(CREDITS_KEY(userId));
    if (remaining < 0) {
      await redis.incr(CREDITS_KEY(userId));
      return null;
    }
    return remaining;
  }
  const store = (await readFileStore()) as unknown as CreditStore;
  store.credits = store.credits || {};
  const current = store.credits[userId] ?? 0;
  if (current <= 0) return null;
  const remaining = current - 1;
  store.credits[userId] = remaining;
  await writeFileStore(store as FileStore);
  return remaining;
}

// One-shot lock per order. Both the Stripe webhook and the success page's
// session lookup mark an order paid, so exactly one of them may hand out the
// pack's credits.
export async function claimCreditGrant(orderId: string): Promise<boolean> {
  guardProd();
  if (hasRedis()) {
    const res = await getRedis().set(GRANT_KEY(orderId), "1", { nx: true });
    return res === "OK";
  }
  const store = (await readFileStore()) as unknown as CreditStore;
  store.grants = store.grants || {};
  if (store.grants[orderId]) return false;
  store.grants[orderId] = true;
  await writeFileStore(store as FileStore);
  return true;
}

// --- snapshot (buyer's data, hydrated when clicking through the email) ---



export async function saveOrderSnapshot(
  orderId: string,
  snapshot: Omit<OrderSnapshot, "updatedAt">,
): Promise<void> {
  guardProd();
  const full: OrderSnapshot = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
  };

  if (hasRedis()) {
    await getRedis().set(SNAPSHOT_KEY(orderId), JSON.stringify(full));
    return;
  }
  // Dev: store inline on the order file (small hack)
  const store = await readFileStore();
  const anyStore = store as unknown as {
    orders: Record<string, Order>;
    snapshots?: Record<string, OrderSnapshot>;
  };
  anyStore.snapshots = anyStore.snapshots || {};
  anyStore.snapshots[orderId] = full;
  await writeFileStore(anyStore as FileStore);
}

export async function patchOrderSnapshot(
  orderId: string,
  patch: Partial<Omit<OrderSnapshot, "updatedAt">>,
): Promise<OrderSnapshot | null> {
  guardProd();
  const existing = await getOrderSnapshot(orderId);
  if (!existing) return null;
  const merged: OrderSnapshot = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (hasRedis()) {
    await getRedis().set(SNAPSHOT_KEY(orderId), JSON.stringify(merged));
    return merged;
  }
  const store = await readFileStore();
  const anyStore = store as unknown as {
    orders: Record<string, Order>;
    snapshots?: Record<string, OrderSnapshot>;
  };
  anyStore.snapshots = anyStore.snapshots || {};
  anyStore.snapshots[orderId] = merged;
  await writeFileStore(anyStore as FileStore);
  return merged;
}

export async function getOrderSnapshot(
  orderId: string,
): Promise<OrderSnapshot | null> {
  guardProd();
  if (hasRedis()) {
    const raw = await getRedis().get(SNAPSHOT_KEY(orderId));
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as OrderSnapshot;
      } catch {
        return null;
      }
    }
    return raw as OrderSnapshot;
  }
  const store = await readFileStore();
  const anyStore = store as unknown as {
    orders: Record<string, Order>;
    snapshots?: Record<string, OrderSnapshot>;
  };
  return anyStore.snapshots?.[orderId] ?? null;
}
