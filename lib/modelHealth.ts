import { structuredOutputOptions } from "./models.ts";

export type ModelProbe = { id: string; alive: boolean; note: string; status?: number };

// A rate-limited standby does not block shipping a healthy primary. Keep
// permanent failures and any primary failure blocking, including when the
// configured primary is itself the usual fallback model.
export function deploymentProbeLevel(probe: ModelProbe, primary: string): "PASS" | "WARN" | "FAIL" {
  if (probe.alive) return "PASS";
  if (probe.id !== primary && probe.status === 429) return "WARN";
  return "FAIL";
}

// Synthetic data only. Match the app's JSON mode, temperature and parsing
// requirements; reasoning models need room to produce their final answer.
export async function probeModel(
  apiKey: string,
  base: string,
  id: string,
  request: typeof fetch = fetch,
): Promise<ModelProbe> {
  const signal = AbortSignal.timeout(20_000);
  try {
    const call = (json: boolean) => request(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: id,
        ...structuredOutputOptions("novita", id),
        messages: [
          { role: "system", content: 'Return only JSON: {"ok":true}.' },
          { role: "user", content: "Run a service health check." },
        ],
        ...(json ? { response_format: { type: "json_object" } } : {}),
        temperature: 0.4,
        max_tokens: 1500,
      }),
      signal,
    });
    let response = await call(true);
    if (response.status === 400 || response.status === 422) response = await call(false);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { id, alive: false, status: response.status, note: String(data?.reason || data?.error?.code || `HTTP ${response.status}`) };
    }
    const choice = data?.choices?.[0];
    if (choice?.finish_reason !== "stop") return { id, alive: false, note: "Incomplete completion" };
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) return { id, alive: false, note: "Empty completion" };
    const raw = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(raw);
    return { id, alive: parsed?.ok === true, note: parsed?.ok === true ? "" : "Invalid health response" };
  } catch (error) {
    return { id, alive: false, note: error instanceof Error ? error.name : "Probe failed" };
  }
}
