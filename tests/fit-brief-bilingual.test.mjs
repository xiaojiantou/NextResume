import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('app/api/fit-brief/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function route(complete) {
  const exports = {};
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/ai': { jsonCompletion: complete },
    '@/lib/ratelimit': { LIMITS: {}, rateLimitGuard: () => null },
  };
  vm.runInNewContext(code, { exports, require: id => modules[id], console });
  return exports.POST;
}
const request = { json: async () => ({ resume: { skills: [], experience: [], education: [] }, job: {}, jobDescription: 'Build AI products.' }) };
test('bilingual brief supplies current date and preserves English terms in bounded Chinese lists', async () => {
  const result = await route(async args => {
    assert.match(args.user, new RegExp(new Date().toISOString().slice(0, 10)));
    assert.match(args.system, /absence from a resume is NOT proof/);
    return { verdict: 'strong', headline: 'English conclusion', quickZh: { headline: ' 匹配 ', employerNeeds: '交付 AI agents', strengths: ['React', 'Plaid', 'LangGraph', 'extra'], gaps: [null, '简历未体现 evals'], actions: ['补充证据'] } };
  })(request);
  assert.equal(result.status, 200);
  assert.equal(result.body.brief.headline, 'English conclusion');
  assert.equal(result.body.brief.quickZh.headline, '匹配');
  assert.equal(result.body.brief.quickZh.strengths.join(','), 'React,Plaid,LangGraph');
  assert.equal(result.body.brief.quickZh.gaps.length, 1);
});
test('missing Chinese output keeps the English report usable', async () => {
  const result = await route(async () => ({ verdict: 'good', headline: 'Good fit', quickZh: { headline: '', employerNeeds: '' } }))(request);
  assert.equal(result.body.brief.headline, 'Good fit');
  assert.equal(result.body.brief.quickZh, undefined);
});
