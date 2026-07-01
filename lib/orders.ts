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

type OrderStore = {
  orders: Record<string, Order>;
};

const STORE_PATH = path.join(process.cwd(), ".nextresume-orders.json");
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY = process.env.ORDER_STORE_KEY || "nextresume:orders";

function hasRedisConfig() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

function requireProductionStore() {
  if (process.env.NODE_ENV === "production" && !hasRedisConfig()) {
    throw new Error(
      "Missing production order store. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }
}

async function redisCommand<T>(command: unknown[]): Promise<T> {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error("Redis order store is not configured.");
  }

  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${REDIS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  const data = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || data.error) {
    throw new Error(data.error || "Redis order store request failed.");
  }

  return data.result as T;
}

async function readStore(): Promise<OrderStore> {
  requireProductionStore();

  if (hasRedisConfig()) {
    const raw = await redisCommand<string | null>(["GET", REDIS_KEY]);
    return raw ? (JSON.parse(raw) as OrderStore) : { orders: {} };
  }

  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as OrderStore;
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

async function writeStore(store: OrderStore) {
  requireProductionStore();

  if (hasRedisConfig()) {
    await redisCommand<"OK">(["SET", REDIS_KEY, JSON.stringify(store)]);
    return;
  }

  await fs.writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

export async function createOrder({
  id,
  stripeSessionId,
}: {
  id: string;
  stripeSessionId: string;
}): Promise<Order> {
  const store = await readStore();
  const now = new Date().toISOString();
  const order: Order = {
    id,
    stripeSessionId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  store.orders[id] = order;
  await writeStore(store);
  return order;
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
  const store = await readStore();
  const order =
    (orderId ? store.orders[orderId] : undefined) ??
    Object.values(store.orders).find(
      (o) => o.stripeSessionId === stripeSessionId,
    );

  if (!order) return null;

  const paid =
    status === "complete" &&
    (paymentStatus === "paid" || paymentStatus === "no_payment_required");
  order.status = paid ? "paid" : status === "expired" ? "expired" : "pending";
  order.paymentStatus = paymentStatus;
  order.updatedAt = new Date().toISOString();
  store.orders[order.id] = order;
  await writeStore(store);
  return order;
}

export async function findOrderBySessionId(
  stripeSessionId: string,
): Promise<Order | null> {
  const store = await readStore();
  return (
    Object.values(store.orders).find(
      (o) => o.stripeSessionId === stripeSessionId,
    ) ?? null
  );
}
