// Order store — durable across serverless cold starts + concurrent webhooks.
//
// Backends:
//   • prod: Upstash Redis (REST). One key per order + a session→order index key.
//     No read-modify-write on a shared blob, so concurrent Stripe events don't
//     clobber each other.
//   • dev: a single JSON file at .nextresume-orders.json (gitignored).
//
// To enable prod: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.

import { promises as fs } from "fs";
import path from "path";

type OrderStatus = "pending" | "paid" | "expired";

export type Order = {
  id: string;
  stripeSessionId: string;
  status: OrderStatus;
  paymentStatus?: string;
  createdAt: string;
  updatedAt: string;
};

const STORE_PATH = path.join(process.cwd(), ".nextresume-orders.json");
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ORDER_KEY = (id: string) => `nextresume:order:${id}`;
const SESSION_KEY = (sid: string) => `nextresume:session:${sid}`;

function hasRedis() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

function guardProd() {
  if (process.env.NODE_ENV === "production" && !hasRedis()) {
    throw new Error(
      "Missing production order store. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }
}

async function redisCommand<T>(command: unknown[]): Promise<T> {
  const res = await fetch(REDIS_URL!, {
    method: "POST",
    headers: {
      authorization: `Bearer ${REDIS_TOKEN!}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const data = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || `Redis error (HTTP ${res.status})`);
  }
  return data.result as T;
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
    // Two atomic writes: the order + the session→order index.
    await redisCommand(["SET", ORDER_KEY(id), JSON.stringify(order)]);
    await redisCommand(["SET", SESSION_KEY(stripeSessionId), id]);
    return order;
  }

  const store = await readFileStore();
  store.orders[id] = order;
  await writeFileStore(store);
  return order;
}

export async function getOrder(id: string): Promise<Order | null> {
  guardProd();
  if (hasRedis()) {
    const raw = await redisCommand<string | null>(["GET", ORDER_KEY(id)]);
    return raw ? (JSON.parse(raw) as Order) : null;
  }
  const store = await readFileStore();
  return store.orders[id] ?? null;
}

export async function findOrderBySessionId(
  stripeSessionId: string,
): Promise<Order | null> {
  guardProd();
  if (hasRedis()) {
    const id = await redisCommand<string | null>([
      "GET",
      SESSION_KEY(stripeSessionId),
    ]);
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
}: {
  orderId?: string | null;
  stripeSessionId: string;
  status: string;
  paymentStatus: string;
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
  order.paymentStatus = paymentStatus;
  order.updatedAt = new Date().toISOString();

  if (hasRedis()) {
    await redisCommand(["SET", ORDER_KEY(order.id), JSON.stringify(order)]);
    return order;
  }

  const store = await readFileStore();
  store.orders[order.id] = order;
  await writeFileStore(store);
  return order;
}
