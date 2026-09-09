import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as ledger from '../lib/evidenceLedger.ts';
import * as refine from '../lib/refineBullet.ts';
import { estimateImpact } from '../lib/resumeImpact.ts';
const code = ts.transpileModule(readFileSync('app/api/refine-bullet/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function route(complete) {
  const exports = {};
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/ai': { jsonCompletion: complete },
    '@/lib/evidenceLedger': ledger, '@/lib/refineBullet': refine,
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
  const POST = route(async ({ user }) => {
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
