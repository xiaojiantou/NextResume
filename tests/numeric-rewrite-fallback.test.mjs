import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreUnsupportedNumericText } from '../lib/numericRewriteFallback.ts';
const resume = { summary: 'Built a reporting tool.', experience: [{ id: 'r', bullets: [{ id: 'a', text: 'Tested the flow with 10 participants.' }, { id: 'b', text: 'Wrote SQL reports.' }] }], projects: [] };
const candidate = { summary: 'Built a reporting tool used by 900 people.', roles: [{ id: 'r', bullets: [{ id: 'a', text: 'Tested with 100 participants.', evidence: ['a'], matchedKeywords: [], rationale: '' }, { id: 'b', text: 'Prepared reports in SQL.', evidence: ['b'], matchedKeywords: [], rationale: '' }] }], projects: [] };
test('numeric fallback preserves approved siblings, summary source, and locks', () => {
  const { optimization, restoredIds } = restoreUnsupportedNumericText(resume, candidate);
  assert.deepEqual(restoredIds, ['a', 'summary']);
  assert.equal(optimization.roles[0].bullets[1].text, candidate.roles[0].bullets[1].text);
  assert.equal(optimization.summary, resume.summary);
  assert.equal(candidate.roles[0].bullets[0].text, 'Tested with 100 participants.');
  assert.deepEqual(restoreUnsupportedNumericText(resume, candidate, ['r', 'summary']).restoredIds, []);
});
test('fallback cannot resolve nonnumeric grounding errors; those require normal validation', () => {
  const unsupported = structuredClone(candidate);
  unsupported.summary = resume.summary;
  unsupported.roles[0].bullets[0].text = 'Led the design department.';
  assert.deepEqual(restoreUnsupportedNumericText(resume, unsupported).restoredIds, []);
});
test('numeric fallback uses valid cited entry evidence and does not repair invalid citations', () => {
  const value = structuredClone(candidate);
  value.summary = resume.summary;
  value.roles[0].bullets[0] = { ...value.roles[0].bullets[0], text: 'Wrote 10 SQL reports.', evidence: ['a', 'b'] };
  assert.deepEqual(restoreUnsupportedNumericText(resume, value).restoredIds, []);
  value.roles[0].bullets[0].text = 'Wrote 100 SQL reports.';
  value.roles[0].bullets[0].evidence = ['another-role-bullet'];
  assert.deepEqual(restoreUnsupportedNumericText(resume, value).restoredIds, []);
});
