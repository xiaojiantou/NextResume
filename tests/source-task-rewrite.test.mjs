import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTaskText, proposeSourceTaskEdits } from '../lib/sourceTaskRewrite.ts';

test('source proposal preserves the entire measurement and qualitative evidence tail', () => {
  for (const [gerund, verb, tail] of [
    ['adding', 'Added', ' prompt caching to an internal assistant; measured input-token processing cost fell from $12 to $9 per 1,000 requests in a replay of the same request set, with the model and cache-hit mix held fixed.'],
    ['documenting', 'Documented', ' the escalation process for new staff; the guide was used during onboarding.'],
    ['maintaining', 'Maintained', ' monitoring for ~18M input and ~3M output tokens monthly, based on request logs.'],
  ]) assert.equal(sourceTaskText('I was responsible for ' + gerund + tail), verb + tail);
  assert.equal(sourceTaskText('Was responsible for the task of writing API tests in Python.'), 'Wrote API tests in Python.');
});

test('ambiguous tense, completion, participation and coordination need model editing', () => {
  for (const source of [
    'Responsible for adding caching to the service.',
    'I am responsible for adding caching to the service.',
    'Was responsible for sales.',
    'Assisted with adding caching to the service.',
    'Was responsible for adding caching with help from the platform team.',
    'Was responsible for adding caching but had not started.',
    'Was responsible for adding caching planned for next quarter.',
    'Was responsible for adding caching pending design approval.',
    'Was responsible for adding caching and maintaining request logs.',
    'Was responsible for adding caching and also maintaining request logs.',
    'Was responsible for adding caching & maintaining request logs.',
    'Was responsible for adding caching, maintaining logs, and writing tests.',
    'Was responsible for adding caching while also maintaining request logs.',
    'Added caching to the service; cost fell from $12 to $9.',
    'Was responsible for adding caching to the service.\nAssisted with monitoring.',
  ]) assert.equal(sourceTaskText(source), undefined, source);
});

test('source proposals honor retry scope, citation validity, approvals and both lock levels', () => {
  const source = 'Was responsible for writing API tests in Python.';
  const resume = { experience: [{ id: 'r1', bullets: [{ id: 'b1', text: source }] }], projects: [{ id: 'p1', bullets: [{ id: 'b2', text: source }] }] };
  const bullet = id => ({ id, text: 'Wrote 200 tests.', evidence: [id], matchedKeywords: ['testing'], rationale: 'Strong', contentReview: { status: 'improved' } });
  const candidate = { roles: [{ id: 'r1', bullets: [bullet('b1')] }], projects: [{ id: 'p1', bullets: [bullet('b2')] }] };
  const eligible = new Set(['b1', 'b2']);
  const result = proposeSourceTaskEdits(resume, candidate, eligible);
  assert.deepEqual(result.proposedIds, ['b1', 'b2']);
  for (const b of [result.optimization.roles[0].bullets[0], result.optimization.projects[0].bullets[0]]) {
    assert.equal(b.text, 'Wrote API tests in Python.');
    assert.deepEqual(b.evidence, [b.id]);
    assert.deepEqual(b.matchedKeywords, []);
    assert.equal(b.contentReview, undefined);
  }
  for (const [ids, locks, approved] of [[new Set(), [], new Set()], [eligible, ['r1', 'b2'], new Set()], [eligible, ['b1', 'p1'], new Set()], [eligible, [], eligible]]) {
    assert.deepEqual(proposeSourceTaskEdits(resume, candidate, ids, locks, approved).optimization, candidate);
  }
  for (const evidence of [[], ['unknown'], ['b2']]) {
    const invalid = structuredClone(candidate); invalid.roles[0].bullets[0].evidence = evidence;
    assert.equal(proposeSourceTaskEdits(resume, invalid, eligible).optimization.roles[0].bullets[0].text, 'Wrote 200 tests.');
  }
});
