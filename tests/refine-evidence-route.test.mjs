import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as ledger from '../lib/evidenceLedger.ts';
import * as refine from '../lib/refineBullet.ts';
import * as harness from '../lib/refinementHarness.ts';
import { estimateImpact } from '../lib/resumeImpact.ts';
const code = ts.transpileModule(readFileSync('app/api/refine-bullet/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function route(complete) {
  const exports = {};
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/ai': { jsonCompletion: complete },
    '@/lib/evidenceLedger': ledger, '@/lib/refineBullet': refine, '@/lib/refinementHarness': harness,
    '@/lib/entitlement': { requirePaidOrder: async () => ({ ok: true }) },
    '@/lib/ratelimit': { LIMITS: {}, rateLimitGuard: () => null },
  };
  vm.runInNewContext(code, { exports, require: id => { if (!(id in modules)) throw new Error(id); return modules[id]; }, console });
  return exports.POST;
}
const inputs = { before: '60', after: '15', runs: '40' };
const estimate = { metric: 'hours_saved', inputs, ...estimateImpact('hours_saved', inputs), confirmedAt: '2026-09-09T12:00:00Z' };
const request = { instruction: 'Use my confirmed estimate.', originalBullet: 'Automated reporting.', originalBulletId: 'b1', job: null,
  confirmedEvidence: { sourceText: 'Automated reporting.', notes: 'I wrote the scheduler.', estimates: [estimate] } };
test('refinement includes recomputed evidence and returns its provenance', async () => {
  const POST = route(async ({ system, user }) => {
    if (system.includes('independently audit')) {
      const { candidate, evidence } = JSON.parse(user);
      return { supported: true, correctionsRespected: true, estimatesPreserved: true, reason: 'Supported by the confirmed calculation.', claims: [{ text: candidate, verdict: 'supported', evidenceIds: evidence.map(e => e.id), reason: 'Confirmed evidence.' }] };
    }
    assert.match(user, /Approximately 30 hours saved per month/);
    assert.match(user, /retain approximate wording/);
    return { id: 'b1', text: 'Automated reporting, saving approximately 30 hours per month.', evidence: ['b1'] };
  });
  const result = await POST({ json: async () => request });
  assert.equal(result.status, 200);
  assert.equal(result.body.bullet.evidenceLedger[2].estimate.value, 30);
  assert.equal(result.body.bullet.evidenceLedger[0].text, request.originalBullet);
});
for (const kind of ['source', 'number', 'confirmation']) test('refinement rejects invalid ' + kind + ' before model call', async () => {
  const body = structuredClone(request);
  if (kind === 'source') body.confirmedEvidence.sourceText = 'A different bullet.';
  if (kind === 'number') body.confirmedEvidence.estimates[0].value = 999;
  if (kind === 'confirmation') delete body.confirmedEvidence.estimates[0].confirmedAt;
  let calls = 0;
  const result = await route(async () => { calls++; return {}; })({ json: async () => body });
  assert.equal(result.status, 400);
  assert.equal(calls, 0);
});

test('refinement audit rejection cannot return a bullet for acceptance', async () => {
  let calls = 0;
  const POST = route(async ({ system, user }) => {
    calls++;
    if (!system.includes('independently audit')) return { text: 'Saved exactly 900 hours per month.' };
    const { candidate } = JSON.parse(user);
    return { supported: false, correctionsRespected: true, estimatesPreserved: false, reason: 'The claimed result contradicts the estimate.', claims: [{ text: candidate, verdict: 'unsupported', evidenceIds: [], reason: 'Invented result.' }] };
  });
  const result = await POST({ json: async () => request });
  assert.equal(calls, 2);
  assert.equal(result.status, 422);
  assert.equal(result.body.bullet, undefined);
  assert.equal(result.body.refinementTrace.outcome, 'rejected');
});
test('reopened refinement retains confirmed history without promoting a draft', async () => {
  const body = { ...request, current: 'Generated wording claimed 50 engineers.', priorEvidence: [
    { kind: 'source', text: request.originalBullet },
    { kind: 'instruction', text: 'I wrote the scheduler in Python.', confirmedAt: '2026-09-09T12:00:00Z' },
  ], instruction: 'Make it shorter.' };
  const POST = route(async ({ system, user }) => {
    if (!system.includes('independently audit')) return { text: 'Wrote the reporting scheduler in Python.' };
    const payload = JSON.parse(user);
    assert.ok(payload.evidence.some(e => e.text === 'I wrote the scheduler in Python.'));
    assert.ok(!payload.evidence.some(e => e.text.includes('50 engineers')));
    assert.equal(payload.contextOnly.current, body.current);
    return { supported: true, correctionsRespected: true, estimatesPreserved: true, reason: 'Confirmed method.', claims: [{ text: payload.candidate, verdict: 'supported', evidenceIds: ['e1'], reason: 'Prior user assertion.' }] };
  });
  const result = await POST({ json: async () => body });
  assert.equal(result.status, 200);
  assert.ok(result.body.bullet.evidenceLedger.some(e => e.kind === 'instruction' && e.text.includes('Python')));
});
