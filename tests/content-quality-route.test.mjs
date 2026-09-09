import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as chunks from '../lib/optimizeChunks.ts';
import * as contract from '../lib/optimizeContract.ts';
import * as structure from '../lib/resumeStructure.ts';
import * as quality from '../lib/contentQuality.ts';

const resume = { name: 'Candidate', title: 'Engineer', summary: '', email: '', phone: '', location: '', skills: [], experience: [{ id: 'r1', company: 'Example', title: 'Engineer', start: '2020', end: 'Present', location: '', bullets: [{ id: 'b1', text: 'Built an API for invoice processing.' }] }], projects: [], education: [] };
const job = { title: 'Engineer', company: '', seniority: '', requiredKeywords: [], niceToHaveKeywords: [], responsibilities: [] };
const code = ts.transpileModule(readFileSync('app/api/optimize/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function loadRoute(complete) {
  const exports = {};
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/ai': { jsonCompletion: complete },
    '@/lib/optimizeChunks': chunks,
    '@/lib/optimizeContract': contract,
    '@/lib/resumeStructure': structure,
    '@/lib/contentQuality': quality,
    '@/lib/entitlement': { requirePaidOrder: async () => ({ ok: true }) },
    '@/lib/ratelimit': { LIMITS: {}, rateLimitGuard: () => null },
    '@/lib/semanticResumeValidation': { reviewSemanticGrounding: async () => [] },
  };
  vm.runInNewContext(code, { exports, require: id => { if (!(id in modules)) throw new Error(id); return modules[id]; }, console: { info() {}, warn() {}, error() {} }, setTimeout, clearTimeout, AbortController });
  return exports.POST;
}
for (const structureMode of ['optimize', 'preserve']) {
  test(`${structureMode}: cosmetic candidate gets one revision, then retains source with actual final validation`, async () => {
    let writes = 0;
    const POST = loadRoute(async ({ system, user }) => {
      if (system.includes('independently compare')) return { reviews: [{ id: 'b1', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Only a synonym changed.', dimensions: [] }] };
      if (system.includes('ONE entry')) { writes++; if (writes === 2) assert.match(user, /Only a synonym changed/); return { id: 'r1', bullets: [{ id: 'b1', text: 'Developed an API for invoice processing.', evidence: ['b1'], matchedKeywords: [], rationale: 'More polished.' }] }; }
      return { title: resume.title, summary: '', skills: [] };
    });
    const result = await POST({ json: async () => ({ resume, job, report: { missingKeywords: [] }, structureMode }) });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(writes, 2);
    const final = result.body.optimization;
    assert.equal(final.roles[0].bullets[0].text, resume.experience[0].bullets[0].text);
    assert.equal(final.roles[0].bullets[0].contentReview.status, 'retained');
    assert.equal(final.structureIntegrity.valid, true);
    assert.equal(typeof final.atsScore, 'number');
  });
}
test('reviewer outage returns original wording with an explicit unavailable status', async () => {
  const POST = loadRoute(async ({ system }) => {
    if (system.includes('independently compare')) throw new Error('review unavailable');
    if (system.includes('ONE entry')) return { id: 'r1', bullets: [{ id: 'b1', text: 'Developed an API for invoice processing.', evidence: ['b1'], matchedKeywords: [], rationale: '' }] };
    return { title: resume.title, summary: '', skills: [] };
  });
  const result = await POST({ json: async () => ({ resume, job, report: { missingKeywords: [] } }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.optimization.roles[0].bullets[0].contentReview.status, 'unreviewed');
});
