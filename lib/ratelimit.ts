// Lightweight per-IP rate limiter. Zero infra — lives in the function process.
//
// Caveats:
// - On serverless (Vercel), each cold-started instance has its own Map, so a
//   determined attacker can get more throughput by spraying across regions.
//   Still catches the common cases (one script hammering from one IP).
// - Upgrade path when you outgrow this: swap the Map for `@upstash/ratelimit`
//   backed by Redis. The route wrappers below don't have to change.

import { NextRequest, NextResponse } from "next/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

export type RateLimitOptions = {
  key: string; // e.g. "optimize" — combined with IP
  limit: number; // max requests per window
  windowMs: number; // window in ms
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  resetAt: number;
};

export function checkRateLimit(
  ip: string,
  { key, limit, windowMs }: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  const bucketKey = `${key}:${ip}`;
  const b = buckets.get(bucketKey);

  if (!b || b.resetAt < now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    sweep(now);
    return { ok: true, remaining: limit - 1, retryAfterSec: 0, resetAt: now + windowMs };
  }

  if (b.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
      resetAt: b.resetAt,
    };
  }

  b.count += 1;
  return {
    ok: true,
    remaining: limit - b.count,
    retryAfterSec: 0,
    resetAt: b.resetAt,
  };
}

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

// Per-endpoint policies. Tuned for a paid-conversion product where
// a normal user runs each endpoint at most a handful of times per session.
export const LIMITS = {
  parseResume: { key: "parse-resume", limit: 5, windowMs: 60_000 },
  parseJob:    { key: "parse-job",    limit: 20, windowMs: 60_000 },
  analyze:     { key: "analyze",      limit: 10, windowMs: 60_000 },
  optimize:    { key: "optimize",     limit: 6,  windowMs: 60_000 },
  redeem:      { key: "redeem",       limit: 10, windowMs: 60_000 },
  importJobUrl:{ key: "import-job-url", limit: 10, windowMs: 60_000 },
  voiceRewrite:{ key: "voice-rewrite",  limit: 10, windowMs: 60_000 },
} as const;

/** Guard an API route. Returns a 429 response if over quota, else null. */
export function rateLimitGuard(
  req: NextRequest,
  opts: RateLimitOptions,
): NextResponse | null {
  const ip = getClientIp(req);
  const r = checkRateLimit(ip, opts);
  if (r.ok) return null;
  return NextResponse.json(
    {
      error: `Too many requests. Try again in ${r.retryAfterSec}s.`,
      retryAfterSec: r.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(r.retryAfterSec),
        "X-RateLimit-Limit": String(opts.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(r.resetAt / 1000)),
      },
    },
  );
}
