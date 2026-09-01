// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Daily model watch. Novita retires models without an error surface — the
// 2026-08-31 incident: deepseek-v3-0324 kept appearing in GET /models while
// completions returned MODEL_NOT_AVAILABLE, so every parse and rewrite 500ed
// until someone noticed. This cron does two things:
//
//   1. Probes every registry model (plus NOVITA_MODEL) with a real one-token
//      completion — the catalog listing is NOT proof of servability.
//   2. Diffs the catalog against the last run (stored in Redis) and probes
//      newly listed models from vendors we already use, so upgrade candidates
//      arrive by email already verified as servable.
//
// It never changes the registry itself: model upgrades stay a human decision
// (a new model silently changes rewrite quality), this only automates the
// discovering and the checking.

import { NextRequest, NextResponse } from "next/server";
import { ENV_MODEL } from "@/lib/ai";
import { sendAlertEmail } from "@/lib/email";
import { MODELS } from "@/lib/models";
import { getRedis, hasRedis } from "@/lib/orders";

export const runtime = "nodejs";
export const maxDuration = 60;

const CATALOG_KEY = "nextresume:model-watch:catalog";
const PROBE_TIMEOUT_MS = 15_000;
const MAX_NEW_PROBES = 8;

const NOVITA_BASE =
  process.env.NOVITA_BASE_URL || "https://api.novita.ai/v3/openai";

type Probe = { id: string; alive: boolean; note: string };

async function fetchCatalog(apiKey: string): Promise<string[]> {
  const res = await fetch(`${NOVITA_BASE}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`catalog fetch failed (HTTP ${res.status})`);
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  return (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string");
}

async function probeModel(apiKey: string, id: string): Promise<Probe> {
  try {
    const res = await fetch(`${NOVITA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: id,
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 2,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) return { id, alive: true, note: "" };
    const body = await res.text().catch(() => "");
    const reason =
      (body.match(/"reason"\s*:\s*"([^"]+)"/)?.[1] ?? `HTTP ${res.status}`);
    return { id, alive: false, note: reason };
  } catch (e) {
    return {
      id,
      alive: false,
      note: e instanceof Error ? e.name : "fetch failed",
    };
  }
}

/** Sequential-ish with small batches — a dozen one-token calls, well under maxDuration. */
async function probeAll(apiKey: string, ids: string[]): Promise<Probe[]> {
  const out: Probe[] = [];
  for (let i = 0; i < ids.length; i += 3) {
    out.push(
      ...(await Promise.all(
        ids.slice(i, i + 3).map((id) => probeModel(apiKey, id)),
      )),
    );
  }
  return out;
}

export async function GET(req: NextRequest) {
  // Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` automatically
  // when the env var exists. Without a secret the route stays dev-only.
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret ? auth !== `Bearer ${secret}` : process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.NOVITA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "NOVITA_API_KEY not set" }, { status: 500 });
  }

  try {
    const catalog = await fetchCatalog(apiKey);
    const catalogSet = new Set(catalog);

    // 1. Health: every Novita model the app can actually route to.
    const registryIds = MODELS.filter((m) => m.provider === "novita").map(
      (m) => m.id,
    );
    const watched = [...new Set([...registryIds, ENV_MODEL])];
    const health = await probeAll(apiKey, watched);
    const dead = health.filter((p) => !p.alive);

    // 2. Discovery: newly listed models from vendors already in the registry,
    //    verified with a real completion before they're worth an email.
    const baselineRaw = hasRedis()
      ? await getRedis().get<string[]>(CATALOG_KEY)
      : null;
    const baseline = Array.isArray(baselineRaw) ? new Set(baselineRaw) : null;
    const vendors = new Set(registryIds.map((id) => id.split("/")[0]));
    const newInteresting = baseline
      ? catalog.filter(
          (id) => !baseline.has(id) && vendors.has(id.split("/")[0]),
        )
      : []; // First run has no baseline — seeding it as "154 new models" is noise.
    const newProbes = await probeAll(
      apiKey,
      newInteresting.slice(0, MAX_NEW_PROBES),
    );
    const upgrades = newProbes.filter((p) => p.alive);

    // Ghosts: still routed-to but vanished from the very catalog that lies in
    // the other direction — worth flagging even while completions still work.
    const delisted = watched.filter((id) => !catalogSet.has(id));

    if (hasRedis()) await getRedis().set(CATALOG_KEY, catalog);

    const to = process.env.MODEL_ALERT_EMAIL || process.env.EMAIL_FROM_EMAIL;
    let emailed = false;
    if (to && (dead.length > 0 || upgrades.length > 0)) {
      const lines: string[] = [];
      if (dead.length > 0) {
        lines.push("MODELS DOWN — the app routes to these and they no longer serve:");
        for (const p of dead) lines.push(`  ✗ ${p.id} (${p.note})`);
        lines.push("", "Fix: update lib/models.ts / NOVITA_MODEL and redeploy.", "");
      }
      if (upgrades.length > 0) {
        lines.push("New models from your vendors, verified servable:");
        for (const p of upgrades) lines.push(`  ✓ ${p.id}`);
        lines.push(
          "",
          "Upgrading stays manual: eval quality first, then edit lib/models.ts.",
          "",
        );
      }
      if (delisted.length > 0) {
        lines.push("Delisted from the catalog but still answering (retirement often follows):");
        for (const id of delisted) lines.push(`  ? ${id}`);
        lines.push("");
      }
      lines.push(`Catalog size: ${catalog.length} · ${new Date().toISOString()}`);
      const result = await sendAlertEmail({
        to,
        subject:
          dead.length > 0
            ? `⚠ NextResume: ${dead.length} model(s) down`
            : `NextResume: ${upgrades.length} new model(s) available`,
        text: lines.join("\n"),
      });
      emailed = result.ok;
    }

    return NextResponse.json({
      ok: true,
      watched: health,
      dead: dead.map((p) => p.id),
      newModels: newProbes,
      delisted,
      baseline: baseline ? baseline.size : null,
      emailed,
    });
  } catch (e) {
    console.error("model-watch failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "model-watch failed" },
      { status: 500 },
    );
  }
}
