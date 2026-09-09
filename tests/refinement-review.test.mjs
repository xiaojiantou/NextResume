import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRefinementReview } from '../lib/refinementReview.ts';
import { runRefinementHarness } from '../lib/refinementHarness.ts';
import { normalizePriorEvidence, refinementEvidenceLedger } from '../lib/evidenceLedger.ts';
import { estimateImpact } from '../lib/resumeImpact.ts';

const source = 'Automated reporting.';
const now = '2026-09-09T12:00:00Z';
const inputs = { before: '60', after: '15', runs: '40' };
const estimate = { metric: 'hours_saved', inputs, ...estimateImpact('hours_saved', inputs), confirmedAt: now };
const ledger = refinementEvidenceLedger({ source, prior: [], notes: '', estimates: [estimate], instructions: ['Use my confirmed estimate.'], now });
const input = { originalBullet: source, originalBulletId: 'b1', instruction: 'Use my confirmed estimate.', ledger, turns: [], job: null };
function approved(text, evidenceIds = ['e0', 'e1']) {
  return { supported: true, correctionsRespected: true, estimatesPreserved: true, reason: 'Supported by user evidence.', claims: [{ text, verdict: 'supported', evidenceIds, reason: 'The user confirmed this.' }] };
}
test('a properly qualified estimate can pass without a measured outcome', () => {
  const text = 'Automated reporting, saving about 30 hours per month.';
  assert.equal(parseRefinementReview(approved(text), text, ledger).status, 'approved');
});
test('estimate qualifiers are checked even when the reviewer incorrectly approves', () => {
  const text = 'Automated reporting, saving 30 hours per month.';
  const review = parseRefinementReview(approved(text), text, ledger);
  assert.equal(review.status, 'rejected');
  assert.equal(review.audit.estimatesPreserved, false);
});
test('review cannot cover only the safe prefix or cite nonexistent evidence', () => {
  assert.equal(parseRefinementReview(approved(source), source + ' Cut costs by 99%.', ledger).status, 'unavailable');
  assert.equal(parseRefinementReview(approved(source, ['draft1']), source, ledger).status, 'unavailable');
  assert.equal(parseRefinementReview(approved(source, []), source, ledger).status, 'unavailable');
});
test('unsupported claims or disregarded corrections cannot be overruled by overall approval', () => {
  const raw = approved(source);
  raw.claims[0].verdict = 'unsupported';
  assert.equal(parseRefinementReview(raw, source, ledger).status, 'rejected');
  assert.equal(parseRefinementReview({ ...approved(source), correctionsRespected: false }, source, ledger).status, 'rejected');
});
test('evidence replay preserves corrections, excludes model drafts, and recomputes estimates', () => {
  const prior = refinementEvidenceLedger({ source, prior: [], notes: 'The tool served 20 engineers.', estimates: [estimate], instructions: ['Correction: it served 8 engineers.'], now });
  const replay = refinementEvidenceLedger({ source, prior: normalizePriorEvidence(prior), notes: 'The tool served 20 engineers.', estimates: [estimate], instructions: ['Make it shorter.'], now });
  assert.equal(replay.filter(r => r.text === 'The tool served 20 engineers.').length, 1);
  assert.ok(replay.findIndex(r => r.text.includes('20 engineers')) < replay.findIndex(r => r.text.includes('8 engineers')));
  assert.throws(() => normalizePriorEvidence([{ kind: 'model', text: 'Led 20 engineers.', confirmedAt: now }]));
  assert.throws(() => normalizePriorEvidence([{ kind: 'confirmed_estimate', text: 'Estimate', estimate: { ...estimate, value: 900 } }]));
  const reasserted = refinementEvidenceLedger({ source, prior: normalizePriorEvidence(prior), notes: '', estimates: [], instructions: ['Correction: it served 8 engineers.', 'The tool served 20 engineers.'], now });
  assert.equal(reasserted.at(-1).text, 'The tool served 20 engineers.');
});
test('successful refinement returns exact reviewed text with server-owned provenance', async () => {
  const text = 'Automated reporting, saving approximately 30 hours per month.';
  let calls = 0;
  const result = await runRefinementHarness(input, async () => ++calls === 1
    ? { text, id: 'fake', evidence: ['invented'], refinementReview: { status: 'approved' } } : approved(text));
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.equal(result.bullet.id, 'b1');
  assert.deepEqual(result.bullet.evidence, ['b1', 'voice-transcript']);
  assert.equal(result.bullet.refinementReview.text, text);
  assert.deepEqual(result.bullet.refinementTrace.calls.map(c => c.stage), ['generate', 'review']);
});
for (const mode of ['rejected', 'invalid', 'outage', 'timeout']) test('runner does not expose an acceptable bullet on review ' + mode, async () => {
  let calls = 0;
  const result = await runRefinementHarness(input, async () => {
    if (++calls === 1) return { text: source };
    if (mode === 'outage') throw new Error('Provider down');
    if (mode === 'timeout') return new Promise(() => {});
    if (mode === 'invalid') return { supported: true };
    return { ...approved(source), supported: false };
  }, { reviewTimeoutMs: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.status, mode === 'rejected' ? 422 : 503);
  assert.equal(result.bullet, undefined);
  assert.equal(result.trace.calls.length, 2);
});
test('generation timeout cannot consume the request deadline indefinitely', async () => {
  const result = await runRefinementHarness(input, async () => new Promise(() => {}), { generationTimeoutMs: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.trace.calls.length, 1);
});

test('numeric gates reject invented inference and preserve metric units even when the model approves', () => {
  const tokenInputs = { requests: '1000', input: '800', output: '200', days: '20' };
  const tokens = { metric: 'monthly_tokens', inputs: tokenInputs, ...estimateImpact('monthly_tokens', tokenInputs), confirmedAt: now };
  const evidence = refinementEvidenceLedger({ source: 'Built an LLM gateway.', prior: [], notes: '', estimates: [tokens], instructions: ['Show business value.'], now });
  const valid = 'Processed about 2,000 万 tokens per month.';
  assert.equal(parseRefinementReview(approved(valid, ['e1']), valid, evidence).status, 'approved');
  const invented = 'Reduced costs by 40%.';
  const raw = approved(invented, ['e2']);
  raw.claims[0].verdict = 'inferred';
  assert.equal(parseRefinementReview(raw, invented, evidence).status, 'rejected');
  const pointsInputs = { before: '60', after: '75' };
  const points = { metric: 'quality_points', inputs: pointsInputs, ...estimateImpact('quality_points', pointsInputs), confirmedAt: now };
  const pointEvidence = refinementEvidenceLedger({ source, prior: [], notes: '', estimates: [points], instructions: [], now });
  const incorrect = 'Improved success by approximately 15% relative to baseline.';
  assert.equal(parseRefinementReview(approved(incorrect, ['e1']), incorrect, pointEvidence).status, 'rejected');
  const correct = 'Improved success by approximately 15 percentage points.';
  assert.equal(parseRefinementReview(approved(correct, ['e1']), correct, pointEvidence).status, 'approved');
});
test('calculation inputs cannot become output metrics with the same numeric value', () => {
  const text = 'Saved approximately 60 hours per month.';
  assert.equal(parseRefinementReview(approved(text), text, ledger).status, 'rejected');
});
test('saved estimate removal survives reopening and a deliberate evidence reversion stays newest', () => {
  const replay = refinementEvidenceLedger({ source, prior: normalizePriorEvidence(ledger), notes: '', estimates: [], removedEstimates: ['hours_saved'], instructions: ['Make it shorter.'], now });
  assert.ok(replay.some(record => record.kind === 'instruction' && record.text.includes('I no longer want to claim it')));
  const older = [{ kind: 'user_confirmed', text: 'Served 20 engineers.', confirmedAt: now }, { kind: 'user_confirmed', text: 'Served 8 engineers.', confirmedAt: now }];
  const reverted = refinementEvidenceLedger({ source, prior: older, notes: 'Served 20 engineers.', estimates: [], instructions: [], now });
  assert.equal(reverted.at(-1).text, 'Served 20 engineers.');
});
test('reconfirming the same estimate after retraction creates newer evidence', () => {
  const removed = refinementEvidenceLedger({ source, prior: normalizePriorEvidence(ledger), notes: '', estimates: [], removedEstimates: ['hours_saved'], instructions: ['Remove the estimate.'], now });
  const reconfirmed = { ...estimate, confirmedAt: '2026-09-10T12:00:00Z' };
  const replay = refinementEvidenceLedger({ source, prior: normalizePriorEvidence(removed), notes: '', estimates: [reconfirmed], instructions: ['Use my newly confirmed estimate.'], now });
  const lastEstimate = replay.findLastIndex(record => record.kind === 'confirmed_estimate');
  const removal = replay.findLastIndex(record => record.text.includes('I no longer want to claim it'));
  assert.ok(lastEstimate > removal);
  assert.equal(replay[lastEstimate].estimate.confirmedAt, reconfirmed.confirmedAt);
});
