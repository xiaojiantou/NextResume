// Authored factual-calibration cases, not writing-quality or human-preference data.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseRefinementReview, reviewRefinement } from '../lib/refinementReview.ts';
import { normalizePriorEvidence, refinementEvidenceLedger } from '../lib/evidenceLedger.ts';
import { runRefinementHarness } from '../lib/refinementHarness.ts';
import { DEFAULT_MODEL_ID } from '../lib/models.ts';

const cases = JSON.parse(readFileSync('eval/content/refinement-cases.json', 'utf8'));
const live = process.argv.includes('--live');
const replay = process.argv.includes('--replay') ? JSON.parse(readFileSync('eval/content/refinement-calibration-initial.json', 'utf8')) : null;
const filterIndex = process.argv.indexOf('--case');
const selected = filterIndex < 0 ? cases : cases.filter(c => c.id === process.argv[filterIndex + 1]);
if (!selected.length) throw new Error('No matching case.');
const inputs = selected.map(c => ({
  ...c,
  ledger: refinementEvidenceLedger({ source: c.originalBullet, prior: normalizePriorEvidence(c.evidenceLedger),
    notes: '', estimates: [], instructions: [...c.turns.map(t => t.instruction), c.instruction], now: '2026-09-09T12:00:00Z' }),
}));
if (!live && !replay) {
  console.log(`${inputs.length} authored cases validated. Use --live to calibrate the production reviewer.`);
  process.exit(0);
}
if (live) process.loadEnvFile('.env.local');
if (live && !process.env.NOVITA_API_KEY) throw new Error('NOVITA_API_KEY is required');
const model = replay?.model || process.env.NOVITA_MODEL || DEFAULT_MODEL_ID;
const calls = [];
const complete = async ({ system, user, maxTokens, signal }) => {
  const start = performance.now();
  const response = await fetch((process.env.NOVITA_BASE_URL || 'https://api.novita.ai/v3/openai') + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.NOVITA_API_KEY },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.4, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
    signal,
  });
  if (!response.ok) throw new Error('Provider status ' + response.status);
  const data = await response.json();
  calls.push({ ms: Math.round(performance.now() - start), usage: data.usage ?? null });
  const raw = data.choices?.[0]?.message?.content || '';
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
};
if (process.argv.includes('--smoke')) {
  if (!live) throw new Error('--smoke requires --live');
  const c = inputs[0];
  const result = await runRefinementHarness({ instruction: c.instruction, originalBullet: c.originalBullet, originalBulletId: c.id, turns: c.turns, current: c.current, job: null, ledger: c.ledger, model }, complete);
  writeFileSync('eval/content/refinement-smoke.json', JSON.stringify({ model, at: new Date().toISOString(), scope: 'single authored case through production refinement runner; not a quality benchmark', calls, result }, null, 2) + '\n');
  console.log(result.ok ? 'Production refinement runner completed generation and independent review.' : result.error);
  process.exit(result.ok ? 0 : 1);
}
const results = [];
for (const c of inputs) {
  const saved = replay?.results.find(r => r.id === c.id)?.review;
  const review = replay ? parseRefinementReview(saved?.audit ? { ...saved.audit, reason: saved.reason, claims: saved.claims } : null, c.candidate, c.ledger) : await reviewRefinement({ candidate: c.candidate, ledger: c.ledger, current: c.current, turns: c.turns, complete, signal: AbortSignal.timeout(14_000) });
  results.push({ id: c.id, expected: c.expected, review });
  console.log(`${c.id}: ${review.status} (expected ${c.expected})`);
}
const counts = {
  total: results.length,
  falseAcceptance: results.filter(r => r.expected === 'unsupported' && r.review.status === 'approved').length,
  falseRejection: results.filter(r => r.expected === 'supported' && r.review.status === 'rejected').length,
  unavailable: results.filter(r => r.review.status === 'unavailable').length,
};
writeFileSync('eval/content/refinement-calibration.json', JSON.stringify({ model, at: new Date().toISOString(), mode: replay ? 'reparse-saved-judgments-no-new-model-calls' : 'live', scope: 'authored factual calibration; not human preference or a held-out benchmark', counts, calls, results }, null, 2) + '\n');
console.log(JSON.stringify(counts));
if (counts.falseAcceptance || counts.falseRejection || counts.unavailable) process.exitCode = 1;
