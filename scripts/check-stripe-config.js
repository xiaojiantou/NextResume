// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Verifies that a set of Stripe env vars is internally consistent before you
// trust it in production. Catches the failure modes that cost us a morning:
// a price id from the wrong account, a price created in the wrong mode, a
// recurring price where the code sends mode=payment, and a display amount in
// lib/pricing.ts that no longer matches what Stripe will actually charge.
//
//   node scripts/check-stripe-config.js                    # reads .env.local
//   node scripts/check-stripe-config.js .env.production.local
//   node scripts/check-stripe-config.js --env              # reads process.env
//
// Use --env for production values: Vercel marks them sensitive and refuses to
// hand them back, so `vercel env pull` returns placeholders. Export the real
// ones into a subshell instead and nothing touches disk.
//
// Secrets are never printed — only prefixes and pass/fail.


const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const envFile = process.argv[2] || ".env.local";
const APP_URL_KEY = "NEXT_PUBLIC_APP_URL";

function readEnv(file) {
  if (file === "--env") return process.env;
  const full = path.resolve(ROOT, file);

  if (!fs.existsSync(full)) {
    console.error(`✗ ${file} not found`);
    process.exit(1);
  }
  return Object.fromEntries(
    fs
      .readFileSync(full, "utf8")
      .split("\n")
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf("=");
        return [
          line.slice(0, i),
          line.slice(i + 1).trim().replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

// Expected amounts come from the SKU table itself, so this check fails loudly
// if someone edits one side without the other.
function expectedSkus() {
  const src = fs.readFileSync(path.join(ROOT, "lib/pricing.ts"), "utf8");
  const re =
    /amount:\s*"\$([\d.]+)"[\s\S]*?priceEnv:\s*"([A-Z0-9_]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    out.push({ cents: Math.round(Number(m[1]) * 100), envVar: m[2] });
  }
  return out;
}

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  ✗ ${msg}`);
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

async function main() {
  const env = readEnv(envFile);
  const key = env.STRIPE_SECRET_KEY;
  console.log(
    `\nChecking ${envFile === "--env" ? "process environment" : envFile}\n`,
  );


  if (!key) {
    console.log("  ✗ STRIPE_SECRET_KEY missing");
    process.exit(1);
  }
  const live = key.startsWith("sk_live");
  console.log(`Key: ${key.slice(0, 8)}…  mode=${live ? "LIVE" : "TEST"}\n`);

  const api = async (p) => {
    const res = await fetch(`https://api.stripe.com/v1${p}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    return [res.ok, await res.json()];
  };

  const [accountOk, account] = await api("/account");
  if (!accountOk) {
    console.log(`  ✗ account lookup failed: ${account.error?.message}`);
    process.exit(1);
  }
  const name = account.settings?.dashboard?.display_name ?? "(unnamed)";
  console.log(`Account: ${account.id}  ${name}`);
  // The middle segment of every Stripe object id is the account suffix, so it
  // is the cheapest way to spot an id that came from a different account.
  const suffix = account.id.replace(/^acct_1[^A-Za-z]*/, "").slice(-10);
  if (live) {
    account.charges_enabled
      ? pass("charges_enabled")
      : fail("charges_enabled is false — this account cannot take live payments");
  }
  console.log("");

  console.log("Prices:");
  for (const sku of expectedSkus()) {
    const id = env[sku.envVar];
    if (!id) {
      fail(`${sku.envVar} missing`);
      continue;
    }
    const [ok, price] = await api(`/prices/${id}`);
    if (!ok) {
      fail(`${sku.envVar} — ${price.error?.message}`);
      continue;
    }
    const problems = [];
    if (price.type !== "one_time")
      problems.push(`type=${price.type} (code sends mode=payment)`);
    if (!price.active) problems.push("inactive");
    if (price.currency !== "usd") problems.push(`currency=${price.currency}`);
    if (price.unit_amount !== sku.cents)
      problems.push(
        `charges $${(price.unit_amount / 100).toFixed(2)} but lib/pricing.ts shows $${(sku.cents / 100).toFixed(2)}`,
      );
    if (price.livemode !== live)
      problems.push(`livemode=${price.livemode} but key is ${live ? "live" : "test"}`);
    if (!id.includes(suffix)) problems.push("belongs to a different account");

    problems.length
      ? fail(`${sku.envVar} — ${problems.join("; ")}`)
      : pass(
          `${sku.envVar} $${(price.unit_amount / 100).toFixed(2)} one_time`,
        );
  }
  console.log("");

  console.log("Webhook:");
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_")) {
    fail("STRIPE_WEBHOOK_SECRET missing or malformed");
  } else {
    pass(`STRIPE_WEBHOOK_SECRET ${env.STRIPE_WEBHOOK_SECRET.slice(0, 11)}…`);
  }

  const [hooksOk, hooks] = await api("/webhook_endpoints?limit=20");
  const wanted = ["checkout.session.completed", "checkout.session.expired"];
  const appUrl = env[APP_URL_KEY];
  if (!hooksOk) {
    console.log(`  · endpoint list unavailable (${hooks.error?.message})`);
  } else if (!hooks.data.length) {
    // The CLI's `stripe listen` secret has no registered endpoint, which is
    // expected locally but never right in production.
    live
      ? fail("no webhook endpoint registered in this account")
      : console.log("  · no registered endpoint (fine when using stripe listen)");
  } else {
    for (const hook of hooks.data) {
      const missing = wanted.filter((e) => !hook.enabled_events.includes(e));
      const events = hook.enabled_events.includes("*")
        ? "all events"
        : `${hook.enabled_events.length} events`;
      const matchesApp = appUrl && hook.url.startsWith(appUrl);
      const note = [
        hook.status === "enabled" ? null : hook.status,
        missing.length && !hook.enabled_events.includes("*")
          ? `missing ${missing.join(", ")}`
          : null,
      ].filter(Boolean);
      note.length
        ? fail(`${hook.url} — ${note.join("; ")}`)
        : pass(`${hook.url} (${events})${matchesApp ? "" : " — not under " + appUrl}`);
    }
  }

  console.log(
    failures ? `\n${failures} problem(s) found\n` : "\nAll checks passed\n",
  );
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("check failed:", e.message);
  process.exit(1);
});
