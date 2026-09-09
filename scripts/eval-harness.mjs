// Runs production orchestration with deterministic providers; these are regression
// scenarios, not measurements of model quality or human preference.
import { mkdirSync, writeFileSync } from 'node:fs';
import { runOptimizationHarness } from '../lib/optimizationHarness.ts';
import { reviewSemanticGrounding } from '../lib/semanticGrounding.ts';
import { input, completion } from '../tests/harness-fixtures.mjs';
const live = process.argv.includes('--live');
let liveComplete;
let model = input.model;
const usage = [];
if (live) {
  process.loadEnvFile('.env.local');
  if (!process.env.NOVITA_API_KEY) throw new Error('NOVITA_API_KEY is required');
  const { DEFAULT_MODEL_ID } = await import('../lib/models.ts');
  model = process.env.NOVITA_MODEL || DEFAULT_MODEL_ID;
  liveComplete = async ({ system, user, maxTokens, signal }) => {
    const response = await fetch((process.env.NOVITA_BASE_URL || 'https://api.novita.ai/v3/openai') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.NOVITA_API_KEY },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.4, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
      signal: signal || AbortSignal.timeout(75_000),
    });
    if (!response.ok) throw new Error('Provider status ' + response.status);
    const data = await response.json();
    usage.push(data.usage ?? null);
    const raw = data.choices?.[0]?.message?.content || '';
    return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  };
}
const cases = [];
for (const scenario of (live ? ['live-smoke'] : ['improved', 'ask', 'outage', 'fallback'])) {
  const result = await runOptimizationHarness({ ...input, model }, { complete: liveComplete || completion(scenario), reviewGrounding: reviewSemanticGrounding, runId: scenario });
  const trace = result.ok ? result.optimization.harness : result.trace;
  cases.push({ scenario, ok: result.ok, trace });
}
mkdirSync('eval/content', { recursive: true });
writeFileSync(live ? 'eval/content/harness-live.json' : 'eval/content/harness-regression.json', JSON.stringify({ mode: live ? 'live-smoke-not-human-preference' : 'deterministic-regression', model, usage, cases }, null, 2) + '\n');
console.log(JSON.stringify(cases.map(({ scenario, ok, trace }) => ({ scenario, ok, outcome: trace.outcome, state: trace.bullets[0].state, calls: trace.calls.length })), null, 2));
if (cases.some(c => !c.ok)) process.exitCode = 1;
