import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateImpact, normalizeImpactMetrics } from '../lib/resumeImpact.ts';
import { parseContentReviews } from '../lib/contentQuality.ts';
import { normalizeConfirmedEstimates, normalizePriorEvidence } from '../lib/evidenceLedger.ts';

test('blank or invalid inputs never become an estimated achievement', () => {
  for (const values of [{}, { before: '', after: '1', runs: '4' }, { before: '10', after: '12', runs: '4' }, { before: '10', after: '1', runs: '-4' }, { before: 'Infinity', after: '1', runs: '4' }]) {
    assert.equal(estimateImpact('hours_saved', values), null);
  }
  assert.equal(estimateImpact('cost_reduction', { before: '0', after: '1' }), null);
});
test('estimates carry their assumptions and retain approximate language', () => {
  const estimate = estimateImpact('hours_saved', { before: '60', after: '15', runs: '40' });
  assert.equal(estimate.value, 30);
  assert.match(estimate.description, /^Approximately 30 hours saved per month$/);
  assert.match(estimate.basis, /Minutes per task before: 60/);
});
test('token scale counts input and output and requires an explicit monthly period', () => {
  const values = { requests: '1000', input: '800', output: '200', days: '20' };
  assert.equal(estimateImpact('monthly_tokens', values).value, 20_000_000);
  assert.equal(estimateImpact('monthly_tokens', { ...values, days: '32' }), null);
  assert.equal(estimateImpact('monthly_tokens', { ...values, days: '' }), null);
});
test('quality percentage points are not confused with relative percentage change', () => {
  assert.equal(estimateImpact('quality_points', { before: '60', after: '75' }).value, 15);
  assert.equal(estimateImpact('quality_points', { before: '60', after: '101' }), null);
  assert.equal(estimateImpact('latency_reduction', { before: '200', after: '150' }).value, 25);
});
test('token metrics require AI evidence in the source and unknown metrics are ignored', () => {
  assert.deepEqual(normalizeImpactMetrics(['monthly_tokens', 'hours_saved', 'made_up'], 'Maintained warehouse records.'), ['hours_saved']);
  assert.deepEqual(normalizeImpactMetrics(['monthly_tokens', 'monthly_tokens'], 'Built an LLM gateway.'), ['monthly_tokens']);
});
test('metric suggestions remain separate from resume text and cannot insert a model estimate', () => {
  const source = 'Built an LLM gateway.';
  const review = parseContentReviews({ reviews: [{ id: 'b', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Scale could be clarified.', dimensions: [], nextStep: 'ask', question: 'How much traffic?', impactMetrics: ['monthly_tokens'], estimatedTokens: 9999999 }] }, [{ id: 'b', source, candidate: source }]).get('b');
  assert.equal(review.text, source);
  assert.deepEqual(review.impactMetrics, ['monthly_tokens']);
  assert.equal('estimatedTokens' in review, false);
});

test('monthly workload estimates count a specified unit without inventing a performance gain', () => {
  const inputs = { unit: 'shipment records', perRun: '25', runs: '20' };
  const estimate = estimateImpact('monthly_workload', inputs);
  assert.equal(estimate.value, 500);
  assert.equal(estimate.description, 'Approximately 500 shipment records per month');
  assert.match(estimate.basis, /What you counted: shipment records/);
  assert.match(estimate.basis, /Times per month: 20/);
  assert.doesNotMatch(estimate.description, /saved|reduc|improv|unique/i);
  assert.equal(estimateImpact('monthly_workload', { unit: 'campaigns', perRun: '1.5', runs: '4' }).value, 6);
  assert.deepEqual(normalizeImpactMetrics(['monthly_tokens', 'monthly_workload'], 'Updated shipment records.'), ['monthly_workload']);
});

test('workload requires a count unit and every input; unknowns and arbitrary unit claims stay invalid', () => {
  const inputs = { unit: 'interview notes', perRun: '3', runs: '4' };
  for (const bad of [{ unit: '' }, { perRun: '' }, { runs: '' }, { unit: '60% revenue growth' }, { unit: 'unique customers' }, { perRun: '-1' }, { runs: 'Infinity' }, { perRun: '0' }]) {
    assert.equal(estimateImpact('monthly_workload', { ...inputs, ...bad }), null);
  }
});

test('confirmed workload preserves the counted unit and rejects changing it without recomputation', () => {
  const inputs = { unit: 'shipment records', perRun: '25', runs: '20' };
  const estimate = { metric: 'monthly_workload', inputs, ...estimateImpact('monthly_workload', inputs), confirmedAt: '2026-09-10T12:00:00Z' };
  assert.equal(normalizeConfirmedEstimates([estimate])[0].description, 'Approximately 500 shipment records per month');
  assert.throws(() => normalizeConfirmedEstimates([{ ...estimate, inputs: { ...inputs, unit: 'orders' } }]));
  assert.throws(() => normalizeConfirmedEstimates([{ ...estimate, confirmedAt: undefined }]));
  const replay = normalizePriorEvidence([{ kind: 'confirmed_estimate', text: 'Claimed huge savings', estimate }]);
  assert.equal(replay[0].text, estimate.description);
  assert.equal(replay[0].estimate.inputs.unit, 'shipment records');
});
