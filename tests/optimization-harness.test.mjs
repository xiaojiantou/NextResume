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

test('repeated numeric rewrite violations restore source only after retries and still validate the deliverable', async () => {
  const source = structuredClone(input);
  source.resume.experience[0].bullets[0].text = 'Redesigned form errors; 6 of 10 participants completed the task before and 9 of 10 after in the same test.';
  let writes = 0;
  const result = await runOptimizationHarness(source, { reviewGrounding: reviewSemanticGrounding, complete: async ({ system, user }) => {
    if (system.includes('ONE entry')) { writes++; return { id: 'r1', bullets: [{ id: 'b1', text: 'Redesigned form errors, raising task success from 60% to 90%.', evidence: ['b1'], matchedKeywords: [], rationale: '' }] }; }
    if (system.includes('independently compare')) return { reviews: JSON.parse(user).bullets.map(b => ({ id: b.id, decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Keeps sample size and counts.', dimensions: [], nextStep: 'keep' })) };
    if (system.includes('conservative resume evidence reviewer')) return { valid: true, issues: [] };
    return { title: source.resume.title, summary: '', skills: [] };
  } });
  assert.equal(result.ok, true);
  assert.equal(writes, 3);
  assert.equal(result.optimization.roles[0].bullets[0].text, source.resume.experience[0].bullets[0].text);
  assert.equal(result.optimization.structureIntegrity.valid, true);
  assert.equal(result.optimization.harness.outcome, 'fallback');
  assert.deepEqual(result.optimization.harness.sourceRestorations[0].ids, ['b1']);
  assert.ok(result.optimization.harness.validation.some(v => v.stage === 'selected' && !v.issues.length));
});

test('dense source repair replaces a rejected rewrite while preserving an approved sibling', async () => {
  const data = structuredClone(input);
  const source = 'I was responsible for adding prompt caching to an internal LLM assistant; measured input-token processing cost fell from $12 to $9 per 1,000 requests in a replay of the same request set, with the model and cache-hit mix held fixed.';
  const faithful = 'Added prompt caching to an internal LLM assistant; measured input-token processing cost fell from $12 to $9 per 1,000 requests in a replay of the same request set, with the model and cache-hit mix held fixed.';
  data.resume.experience[0].bullets = [{ id: 'b1', text: source }, { id: 'b2', text: 'Was responsible for documenting the request-failure escalation process.' }];
  let writes = 0;
  const reviewed = [];
  const result = await runOptimizationHarness(data, { reviewGrounding: reviewSemanticGrounding, complete: async ({ system, user }) => {
    if (system.includes('ONE entry')) {
      writes++;
      if (writes === 2) assert.match(user, /original source/);
      return { id: 'r1', bullets: [
        { id: 'b1', text: 'Reduced input-token processing cost from $12 to $9 per 1,000 requests by adding prompt caching in a replay test.', evidence: ['b1'], matchedKeywords: [], rationale: '' },
        { id: 'b2', text: writes === 2 ? 'Led 100 engineers.' : 'Documented the request-failure escalation process.', evidence: ['b2'], matchedKeywords: [], rationale: '' },
      ] };
    }
    if (system.includes('independently compare')) {
      const pairs = JSON.parse(user).bullets; reviewed.push(pairs.map(p => p.id));
      if (writes === 2) assert.equal(pairs[0].candidate, faithful);
      return { reviews: pairs.map(p => ({ id: p.id, decision: p.id === 'b1' && writes === 1 ? 'retain' : 'improved', supported: true, detailsPreserved: p.id !== 'b1' || writes !== 1, causalityPreserved: true, reason: p.id === 'b1' && writes === 1 ? 'The same request set and fixed mix are missing.' : 'Names the documented task directly, preserving the rest.', dimensions: ['clarity'], nextStep: 'keep' })) };
    }
    if (system.includes('conservative resume evidence reviewer')) return { valid: true, issues: [] };
    return { title: data.resume.title, summary: '', skills: [] };
  } });
  assert.equal(result.ok, true);
  assert.equal(writes, 2);
  assert.equal(result.optimization.roles[0].bullets[0].text, faithful);
  assert.equal(result.optimization.roles[0].bullets[1].text, 'Documented the request-failure escalation process.');
  assert.deepEqual(reviewed, [['b1', 'b2'], ['b1']]);
  assert.equal(result.optimization.structureIntegrity.valid, true);
});

for (const decision of ['improved', 'retain', 'unavailable']) test('numeric failure offers a reviewed source edit on the existing retry: ' + decision, async () => {
  const data = structuredClone(input);
  const tail = ' prompt caching to an internal assistant; measured input-token processing cost fell from $12 to $9 per 1,000 requests on the same request set with the model and cache-hit mix fixed.';
  const source = 'I was responsible for adding' + tail, proposal = 'Added' + tail;
  data.resume.experience[0].bullets[0].text = source;
  let writes = 0, grounding = 0, reviews = 0;
  const result = await runOptimizationHarness(data, { reviewGrounding: async ({ candidate }) => {
    grounding++;
    assert.equal(candidate.roles[0].bullets[0].text, proposal);
    return [];
  }, complete: async ({ system, user }) => {
    if (system.includes('ONE entry')) { writes++; return { id: 'r1', bullets: [{ id: 'b1', text: 'Reduced total inference costs by 25%.', evidence: ['b1'], matchedKeywords: [], rationale: '' }] }; }
    if (system.includes('independently compare')) {
      reviews++; assert.equal(JSON.parse(user).bullets[0].candidate, proposal);
      if (decision === 'unavailable') throw new Error('Review unavailable');
      return { reviews: [{ id: 'b1', decision, supported: decision !== 'retain', detailsPreserved: true, causalityPreserved: true, reason: decision === 'retain' ? 'The source does not establish execution.' : 'Compared source framing with direct action.', dimensions: ['clarity'], nextStep: 'keep' }] };
    }
    return { title: data.resume.title, summary: '', skills: [] };
  } });
  assert.equal(result.ok, true);
  assert.equal(writes, 2);
  assert.equal(grounding, 1);
  assert.equal(reviews, 1);
  const bullet = result.optimization.roles[0].bullets[0];
  assert.equal(bullet.text, decision === 'improved' ? proposal : source);
  assert.equal(bullet.contentReview.status, decision === 'improved' ? 'improved' : decision === 'retain' ? 'retained' : 'unreviewed');
  const trace = result.optimization.harness, run = trace.bullets[0];
  assert.equal(run.candidates.find(c => c.text === proposal).origin, 'source_edit');
  assert.ok(run.candidates.some(c => c.origin === 'model' && /25%/.test(c.text)));
  assert.equal(run.candidates.find(c => c.id === run.selectedId).text, bullet.text);
  assert.ok(trace.validation.find(v => v.stage === 'candidate' && v.attempt === 1).issues.length > 0);
  assert.deepEqual(trace.validation.find(v => v.stage === 'selected').issues, []);
});

test('an unrelated validation failure cannot consume a source proposal before review', async () => {
  const data = structuredClone(input);
  const source = 'Was responsible for adding prompt caching to the assistant; processing cost fell from $12 to $9 per 1,000 requests in the same replay.';
  const proposal = source.replace('Was responsible for adding', 'Added');
  const sibling = 'Tested form changes; 6 of 10 participants completed the task before and 9 of 10 after.';
  data.resume.experience[0].bullets = [{ id: 'b1', text: source }, { id: 'b2', text: sibling }];
  let writes = 0, reviews = 0;
  const result = await runOptimizationHarness(data, { reviewGrounding: reviewSemanticGrounding, complete: async ({ system, user }) => {
    if (system.includes('ONE entry')) {
      writes++;
      return { id: 'r1', bullets: [
        { id: 'b1', text: 'Reduced processing costs by 25%.', evidence: ['b1'], matchedKeywords: [], rationale: '' },
        { id: 'b2', text: writes === 2 ? 'Tested form changes; completion increased from 60% to 90%.' : sibling, evidence: ['b2'], matchedKeywords: [], rationale: '' },
      ] };
    }
    if (system.includes('independently compare')) {
      reviews++;
      const pairs = JSON.parse(user).bullets;
      assert.equal(writes, 3);
      assert.equal(pairs.find(b => b.id === 'b1').candidate, proposal);
      return { reviews: pairs.map(b => ({ id: b.id, decision: b.id === 'b1' ? 'improved' : 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Preserves the entire evidence clause.', dimensions: ['clarity'], nextStep: 'keep' })) };
    }
    if (system.includes('conservative resume evidence reviewer')) return { valid: true, issues: [] };
    return { title: data.resume.title, summary: '', skills: [] };
  } });
  assert.equal(result.ok, true);
  assert.equal(writes, 3);
  assert.equal(reviews, 1);
  assert.equal(result.optimization.roles[0].bullets[0].text, proposal);
  assert.equal(result.optimization.roles[0].bullets[1].text, sibling);
  const run = result.optimization.harness.bullets[0];
  const selected = run.candidates.find(c => c.id === run.selectedId);
  assert.equal(selected.origin, 'source_edit');
  assert.equal(selected.review.status, 'improved');
});
