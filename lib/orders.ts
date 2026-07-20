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
import type { JobAnalysis, Optimization, Resume } from "./types";

type OrderStatus = "pending" | "paid" | "expired";

export type Order = {
  id: string;
  stripeSessionId: string;
  status: OrderStatus;
  paymentStatus?: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
};

// The buyer's data attached to an order — hydrated on the /result page when
// they click through from the email on a new device.
export type OrderSnapshot = {
  resume: Resume;
  job: JobAnalysis | null;
  optimization: Optimization | null;
  optimizationModel: string | null;
  updatedAt: string;
};

const STORE_PATH = path.join(process.cwd(), ".nextresume-orders.json");
const ORDER_KEY = (id: string) => `nextresume:order:${id}`;
const SESSION_KEY = (sid: string) => `nextresume:session:${sid}`;
const SNAPSHOT_KEY = (id: string) => `nextresume:snapshot:${id}`;

function hasRedis() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN) ||
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
  );
}

let _redis: Redis | null = null;
function getRedis(): Redis {
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
  stripeSessionId,
}: {
  id: string;
  stripeSessionId: string;
}): Promise<Order> {
  guardProd();
  const now = new Date().toISOString();
  const order: Order = {
    id,
    stripeSessionId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  if (hasRedis()) {
    const redis = getRedis();
    // Two atomic writes: the order + the session→order index.
    await Promise.all([
      redis.set(ORDER_KEY(id), JSON.stringify(order)),
      redis.set(SESSION_KEY(stripeSessionId), id),
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
    return order;
  }

  const store = await readFileStore();
  store.orders[order.id] = order;
  await writeFileStore(store);
  return order;
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
