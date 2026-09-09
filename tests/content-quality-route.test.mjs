import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as chunks from '../lib/optimizeChunks.ts';
import * as contract from '../lib/optimizeContract.ts';
import * as structure from '../lib/resumeStructure.ts';
import * as quality from '../lib/contentQuality.ts';
import * as harness from '../lib/optimizationHarness.ts';

const resume = { name: 'Candidate', title: 'Engineer', summary: '', email: '', phone: '', location: '', skills: [], experience: [{ id: 'r1', company: 'Example', title: 'Engineer', start: '2020', end: 'Present', location: '', bullets: [{ id: 'b1', text: 'Built an API for invoice processing.' }] }], projects: [], education: [] };
const job = { title: 'Engineer', company: '', seniority: '', requiredKeywords: [], niceToHaveKeywords: [], responsibilities: [] };
const code = ts.transpileModule(readFileSync('app/api/optimize/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function loadRoute(complete) {
  const exports = {};
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/ai': { jsonCompletion: complete },
    '@/lib/optimizationHarness': harness,
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

test('an unchanged weak bullet is revised without overwriting an approved sibling', async () => {
  const source = structuredClone(resume);
  source.experience[0].bullets = [
    { id: 'b1', text: 'Was responsible for writing API tests in Python.' },
    { id: 'b2', text: 'Was responsible for writing documentation for the API.' },
  ];
  let writes = 0;
  const reviewedIds = [];
  const POST = loadRoute(async ({ system, user }) => {
    if (system.includes('independently compare')) {
      const pairs = JSON.parse(user).bullets;
      reviewedIds.push(pairs.map(b => b.id));
      return { reviews: pairs.map(b => ({
        id: b.id, supported: true, detailsPreserved: true, causalityPreserved: true,
        decision: b.candidate.startsWith('Was responsible') ? 'retain' : 'improved',
        dimensions: b.candidate.startsWith('Was responsible') ? [] : ['clarity'],
        reason: b.candidate.startsWith('Was responsible') ? 'The task is buried in weak scaffolding.' : 'Names the actual task directly.',
        nextStep: b.candidate.startsWith('Was responsible') ? 'revise' : 'keep',
        revisionInstruction: b.candidate.startsWith('Was responsible') ? 'Lead with writing API documentation; remove the responsibility scaffolding.' : '',
      })) };
    }
    if (system.includes('ONE entry')) {
      writes++;
      if (writes === 2) assert.match(user, /Lead with writing API documentation/);
      return { id: 'r1', bullets: [
        { id: 'b1', text: writes === 1 ? 'Wrote API tests in Python.' : 'Led 100 engineers.', evidence: ['b1'], matchedKeywords: [], rationale: '' },
        { id: 'b2', text: writes === 1 ? source.experience[0].bullets[1].text : 'Wrote documentation for the API.', evidence: ['b2'], matchedKeywords: [], rationale: '' },
      ] };
    }
    return { title: resume.title, summary: '', skills: [] };
  });
  const result = await POST({ json: async () => ({ resume: source, job, report: { missingKeywords: [] } }) });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(writes, 2);
  assert.deepEqual(result.body.optimization.roles[0].bullets.map(b => b.text), ['Wrote API tests in Python.', 'Wrote documentation for the API.']);
  assert.deepEqual(reviewedIds, [['b1', 'b2'], ['b2']]);
});

test('missing evidence prompts a question instead of repeated rewriting', async () => {
  let writes = 0;
  const POST = loadRoute(async ({ system }) => {
    if (system.includes('independently compare')) return { reviews: [{ id: 'b1', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'The scope is unspecified.', dimensions: [], nextStep: 'ask', question: 'What part did you implement?' }] };
    if (system.includes('ONE entry')) { writes++; return { id: 'r1', bullets: [{ id: 'b1', text: 'Developed an API for invoice processing.', evidence: ['b1'], matchedKeywords: [], rationale: '' }] }; }
    return { title: resume.title, summary: '', skills: [] };
  });
  const result = await POST({ json: async () => ({ resume, job, report: { missingKeywords: [] } }) });
  assert.equal(result.status, 200);
  assert.equal(writes, 1);
  assert.equal(result.body.optimization.roles[0].bullets[0].contentReview.question, 'What part did you implement?');
});

test('a failed optional revision returns the prior fully validated deliverable', async () => {
  let writes = 0;
  const POST = loadRoute(async ({ system }) => {
    if (system.includes('independently compare')) return { reviews: [{ id: 'b1', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Only a synonym changed.', dimensions: [] }] };
    if (system.includes('ONE entry')) {
      if (++writes > 1) throw new Error('provider unavailable');
      return { id: 'r1', bullets: [{ id: 'b1', text: 'Developed an API for invoice processing.', evidence: ['b1'], matchedKeywords: [], rationale: '' }] };
    }
    return { title: resume.title, summary: '', skills: [] };
  });
  const result = await POST({ json: async () => ({ resume, job, report: { missingKeywords: [] } }) });
  assert.equal(result.status, 200);
  assert.equal(writes, 2);
  assert.equal(result.body.optimization.roles[0].bullets[0].text, resume.experience[0].bullets[0].text);
  assert.equal(result.body.optimization.structureIntegrity.valid, true);
});
