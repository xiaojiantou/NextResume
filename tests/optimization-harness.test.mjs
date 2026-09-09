import test from 'node:test';
import assert from 'node:assert/strict';
import { runOptimizationHarness } from '../lib/optimizationHarness.ts';
import { reviewSemanticGrounding } from '../lib/semanticGrounding.ts';
import { recordBulletDecision } from '../lib/harnessTrace.ts';
import { normalizeConfirmedEstimates, buildEvidenceLedger, confirmedEvidenceText } from '../lib/evidenceLedger.ts';
import { estimateImpact } from '../lib/resumeImpact.ts';
import { input, completion } from './harness-fixtures.mjs';

for (const [scenario, state, outcome] of [
  ['improved', 'ready', 'completed'], ['ask', 'needs_evidence', 'completed'],
  ['outage', 'review_unavailable', 'completed'], ['fallback', 'ready', 'fallback'],
]) test('runner traces ' + scenario, async () => {
  const result = await runOptimizationHarness(input, { complete: completion(scenario), reviewGrounding: reviewSemanticGrounding, runId: scenario });
  assert.equal(result.ok, true);
  const trace = result.optimization.harness;
  assert.equal(trace.id, scenario);
  assert.equal(trace.outcome, outcome);
  assert.equal(trace.bullets[0].state, state);
  const selected = trace.bullets[0].candidates.find(c => c.id === trace.bullets[0].selectedId);
  assert.equal(selected.text, result.optimization.roles[0].bullets[0].text);
  assert.ok(trace.calls.some(c => c.stage === 'grounding'));
  assert.ok(trace.validation.some(v => v.stage === 'selected' && !v.issues.length));
  assert.ok(trace.bullets[0].candidates.length >= 2);
  if (scenario === 'improved') assert.equal(selected.review.audit.supported, true);
  if (scenario === 'fallback') assert.ok(trace.calls.some(c => c.outcome === 'failed'));
});
test('failed generation has a failed trace without a selected candidate', async () => {
  const result = await runOptimizationHarness(input, { complete: async () => { throw new Error('offline'); }, reviewGrounding: reviewSemanticGrounding });
  assert.equal(result.ok, false);
  assert.equal(result.trace.outcome, 'failed');
  assert.equal(result.trace.bullets[0].selectedId, undefined);
});
test('confirmed estimates are recomputed and reject tampering or absent confirmation', () => {
  const inputs = { before: '60', after: '15', runs: '40' };
  const estimate = { metric: 'hours_saved', inputs, ...estimateImpact('hours_saved', inputs), confirmedAt: '2026-09-09T12:00:00Z' };
  const confirmed = normalizeConfirmedEstimates([estimate]);
  assert.equal(confirmed[0].value, 30);
  for (const changed of [{ value: 300 }, { confirmedAt: undefined }, { basis: 'made up' }, { inputs: { ...inputs, before: '600' } }]) {
    assert.throws(() => normalizeConfirmedEstimates([{ ...estimate, ...changed }]));
  }
  assert.throws(() => normalizeConfirmedEstimates([estimate, estimate]));
  const ledger = buildEvidenceLedger('Automated reporting.', 'I implemented the scheduler.', confirmed, estimate.confirmedAt);
  assert.deepEqual(ledger.map(e => e.kind), ['source', 'user_confirmed', 'confirmed_estimate']);
  assert.match(confirmedEvidenceText(ledger), /retain approximate wording/);
});
test('manual edits coalesce without erasing acceptance or restoration', () => {
  const initial = { id: 'b1', text: 'Original', evidence: ['b1'], matchedKeywords: [], rationale: '' };
  let bullet = recordBulletDecision(initial, { ...initial, text: 'Accepted' }, 'accept', 't1');
  bullet = recordBulletDecision(bullet, { ...bullet, text: 'Edit' }, 'edit', 't2');
  bullet = recordBulletDecision(bullet, { ...bullet, text: 'Edited' }, 'edit', 't3');
  bullet = recordBulletDecision(bullet, initial, 'restore', 't4');
  assert.deepEqual(bullet.decisionHistory.map(d => d.action), ['accept', 'edit', 'restore']);
  assert.equal(bullet.decisionHistory[1].before, 'Accepted');
  assert.equal(bullet.decisionHistory[1].after, 'Edited');
});
test('locked accepted text and evidence survive regeneration with a locked trace', async () => {
  const first = await runOptimizationHarness(input, { complete: completion(), reviewGrounding: reviewSemanticGrounding });
  const baseline = first.optimization;
  const accepted = baseline.roles[0].bullets[0];
  accepted.evidenceLedger = [{ kind: 'source', text: input.resume.experience[0].bullets[0].text }];
  accepted.decisionHistory = [{ action: 'accept', before: input.resume.experience[0].bullets[0].text, after: accepted.text, at: '2026-09-09T12:00:00Z' }];
  const result = await runOptimizationHarness({ ...input, lockedContentIds: ['b1'], baselineOptimization: baseline }, { complete: completion('ask'), reviewGrounding: reviewSemanticGrounding });
  assert.equal(result.ok, true);
  assert.equal(result.optimization.roles[0].bullets[0].text, accepted.text);
  assert.deepEqual(result.optimization.roles[0].bullets[0].evidenceLedger, accepted.evidenceLedger);
  assert.deepEqual(result.optimization.roles[0].bullets[0].decisionHistory, accepted.decisionHistory);
  assert.equal(result.optimization.harness.bullets[0].state, 'locked');
});
