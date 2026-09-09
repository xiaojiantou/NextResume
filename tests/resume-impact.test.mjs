import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateImpact, normalizeImpactMetrics } from '../lib/resumeImpact.ts';
import { parseContentReviews } from '../lib/contentQuality.ts';

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
