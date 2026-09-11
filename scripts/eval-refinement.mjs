// Authored factual-calibration cases, not writing-quality or human-preference data.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseRefinementReview, reviewRefinement } from '../lib/refinementReview.ts';
import { normalizePriorEvidence, refinementEvidenceLedger } from '../lib/evidenceLedger.ts';
import { runRefinementHarness } from '../lib/refinementHarness.ts';
import { DEFAULT_MODEL_ID } from '../lib/models.ts';

const option = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
  return value;
};
const corpusPath = option('--cases', 'eval/content/refinement-cases.json');
const corpusText = readFileSync(corpusPath, 'utf8');
const cases = JSON.parse(corpusText);
const live = process.argv.includes('--live');
const smoke = process.argv.includes('--smoke');
const explicitOutput = option('--out', null);
const outputPath = resolve(explicitOutput ?? (smoke ? 'eval/content/refinement-smoke.json' : 'eval/content/refinement-calibration.json'));
if (explicitOutput && existsSync(outputPath)) throw new Error('Output already exists; choose a new --out path to preserve prior results.');
const replay = process.argv.includes('--replay') ? JSON.parse(readFileSync('eval/content/refinement-calibration-initial.json', 'utf8')) : null;
const caseId = option('--case', null);
const selected = caseId === null ? cases : cases.filter(c => c.id === caseId);
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
const digest = value => createHash('sha256').update(value).digest('hex');
const codeFiles = ['lib/refinementHarness.ts', 'lib/refinementReview.ts', 'lib/refineBullet.ts', 'lib/evidenceLedger.ts', 'lib/resumeImpact.ts', 'lib/contentQuality.ts', 'lib/resumeStructure.ts', 'lib/models.ts', 'scripts/eval-refinement.mjs'];
let codeRevision = null;
try { codeRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* File hashes still identify the code outside a Git checkout. */ }
const provenance = {
  corpusPath, corpusHash: digest(corpusText), selectedCases: (smoke ? inputs.slice(0, 1) : inputs).map(c => c.id),
  codeRevision, codeHashes: Object.fromEntries(codeFiles.map(file => [file, digest(readFileSync(file))])),
};
const save = result => {
  mkdirSync(dirname(outputPath), { recursive: true });
  // An exclusive create also protects against another process writing during a live run.
  writeFileSync(outputPath, JSON.stringify({ ...provenance, ...result }, null, 2) + '\n', { flag: explicitOutput ? 'wx' : 'w' });
};
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
if (smoke) {
  if (!live) throw new Error('--smoke requires --live');
  const c = inputs[0];
  const result = await runRefinementHarness({ instruction: c.instruction, originalBullet: c.originalBullet, originalBulletId: c.id, turns: c.turns, current: c.current, job: null, ledger: c.ledger, model }, complete);
  save({ model, at: new Date().toISOString(), scope: 'single authored case through production refinement runner; not a quality benchmark', calls, result });
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
save({ model, at: new Date().toISOString(), mode: replay ? 'reparse-saved-judgments-no-new-model-calls' : 'live', scope: 'authored factual calibration; not human preference or a held-out benchmark', counts, calls, results });
console.log(JSON.stringify(counts));
if (counts.falseAcceptance || counts.falseRejection || counts.unavailable) process.exitCode = 1;
