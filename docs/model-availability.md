# Model availability

DeepSeek V4.1 Flash is the default. Llama 3.3 70B is the explicitly vetted
Novita fallback. Change these in `lib/models.ts` after checking output quality.
Catalog discovery never upgrades models automatically.

`jsonCompletion` resolves stale browser selections and retired environment
overrides centrally. An explicit `MODEL_NOT_FOUND` or `MODEL_NOT_AVAILABLE`
from Novita triggers at most one call to the fallback. It never switches
providers, retries itself, or switches models for authentication, rate limits,
generic HTTP errors, invalid JSON or canceled requests. Both models being
unavailable yields a readable error; job parsing returns HTTP 503.

The daily `/api/cron/model-watch` job probes Novita registry models, the active
default and fallback with synthetic JSON requests. It requires a completed,
valid answer, not just HTTP 200. Catalog or Redis failure does not suppress
model health probes. Failed models, delistings and new model candidates use the
existing email alert path. Missing email configuration and unhealthy checks
produce HTTP 503 and structured server logs. Check Vercel cron execution/logs:
the job cannot detect that its own scheduler has stopped running.

Configure `CRON_SECRET`, `NOVITA_API_KEY`, `MAILERSEND_API_KEY`,
`EMAIL_FROM_EMAIL`, and optionally `MODEL_ALERT_EMAIL` (defaults to sender).
The production build gate rejects missing monitoring configuration.

Run `npm run check:models` to verify the primary and fallback independently.
The Vercel build command runs this before building, using that deployment's
environment. Either model failing blocks the build/promotion. Tests use small
synthetic prompts, consume a small number of billed tokens, and send no resume
data. Offline `npm run build` remains available. Deploying prebuilt artifacts
or overriding Vercel's build command bypasses this gate and requires running
the check explicitly in the target environment.

Fallback events log `model_unavailable`, `model_fallback`, and
`model_fallback_failed`, including model/provider identifiers without prompts
or credentials. Fallback availability is checked daily and at deployment,
not guaranteed indefinitely; no fallback can guarantee upstream uptime.
