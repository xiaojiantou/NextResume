import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, validateCorpus, makeBlindPacket, validatePacketKey, summarizeHumanReviews } from '../scripts/lib/uplift-evaluation.mjs';
const corpus = JSON.parse(readFileSync('eval/uplift/cases.json', 'utf8'));
const rows = [0, 1, 2, 3].map(i => ({ id: 'case-' + i, roleFamily: i % 2 ? 'data' : 'engineering', evidenceLevel: 'qualitative', ok: true, source: ['Was responsible for writing API tests ' + i + '.'], candidate: ['Wrote API tests ' + i + '.'], sourceFacts: ['Wrote API tests.'], target: { title: 'Engineer', seniority: 'mid', responsibilities: [] }, trace: { model: 'HIDDEN_MODEL', outcome: 'completed' } }));
const run = { runId: 'private-run-id', corpusHash: digest(corpus), cases: [...rows, { id: 'failed', ok: false }] };
const create = () => makeBlindPacket(run, 'test-seed');
function votes(packet, key, name, preference = 'candidate') {
  return { version: 1, packetId: packet.packetId, reviewer: name, attested: true, ratings: packet.items.map(item => ({ itemId: item.id, preference: ['tie', 'neither'].includes(preference) ? preference : preference === 'candidate' ? key.items[item.id].candidateSide : key.items[item.id].candidateSide === 'A' ? 'B' : 'A', factualConcerns: [], criteria: ['clarity'], reason: 'Clearer documented action.' })) };
}
test('authored corpus covers all families and keeps validation separate', () => {
  validateCorpus(corpus);
  const dev = corpus.filter(c => c.split === 'development'), validation = corpus.filter(c => c.split === 'validation');
  assert.equal(dev.length, 12); assert.equal(validation.length, 6);
  assert.equal(new Set(dev.slice(0, 6).map(c => c.roleFamily)).size, 6);
  assert.equal(new Set(validation.map(c => c.roleFamily)).size, 6);
  assert.equal(new Set(corpus.map(c => c.id)).size, corpus.length);
  assert.equal(corpus.some(c => 'candidate' in c || 'expected' in c), false);
});
test('packet balances positions and excludes generation metadata, failures and source labels', () => {
  const { packet, key } = create();
  assert.equal(packet.items.length, 4);
  assert.equal(Object.values(key.items).filter(m => m.candidateSide === 'A').length, 2);
  for (const hidden of ['private-run-id', 'HIDDEN_MODEL', 'candidateSide', 'case-0', 'contentReview', 'failed']) assert.equal(JSON.stringify(packet).includes(hidden), false);
  assert.equal(key.attemptedCases, 5);
  assert.deepEqual(key.failedCases, ['failed']);
  assert.deepEqual(create(), create());
  assert.notEqual(makeBlindPacket(run, 'different-seed').packet.packetId, packet.packetId);
});
test('empty reviews stay pending; no percentage is fabricated', () => {
  const { packet, key } = create();
  const summary = summarizeHumanReviews(packet, key, []);
  assert.equal(summary.status, 'pending_human_review');
  assert.equal(summary.overall.decisiveCandidateWinRate, null);
  assert.equal(summary.ratings, 0);
  assert.deepEqual(summary.failedCases, ['failed']);
});
test('explicit votes are unblinded only after import and insufficient coverage is visible', () => {
  const { packet, key } = create();
  const a = votes(packet, key, 'Reviewer One'), b = votes(packet, key, 'Reviewer Two');
  assert.equal(summarizeHumanReviews(packet, key, [a]).status, 'insufficient_coverage');
  const summary = summarizeHumanReviews(packet, key, [a, b]);
  assert.equal(summary.overall.candidateWins, 4);
  assert.equal(summary.overall.decisiveCandidateWinRate, 1);
  assert.equal(summary.status, 'generation_failures_need_review');
  assert.equal(summary.byRole.data.candidateWins, 2);
});
test('ties, disagreements and factual concerns stay separate from preference', () => {
  const { packet, key } = create();
  const a = votes(packet, key, 'one'), b = votes(packet, key, 'two', 'source');
  assert.equal(summarizeHumanReviews(packet, key, [a, b]).overall.mixed, 4);
  const ties = summarizeHumanReviews(packet, key, [votes(packet, key, 'one', 'tie'), votes(packet, key, 'two', 'tie')]);
  assert.equal(ties.overall.ties, 4); assert.equal(ties.overall.decisiveCandidateWinRate, null);
  b.ratings[0].factualConcerns = [key.items[b.ratings[0].itemId].candidateSide];
  assert.equal(summarizeHumanReviews(packet, key, [a, b]).status, 'factual_concerns_need_review');
});
test('duplicate reviewers, forged item IDs, absent attestation and stale packets are rejected', () => {
  const { packet, key } = create();
  const valid = votes(packet, key, 'one');
  assert.throws(() => summarizeHumanReviews(packet, key, [valid, { ...valid, reviewer: ' ONE ' }]));
  for (const mutate of [v => v.attested = false, v => v.packetId = 'stale', v => v.ratings[0].itemId = 'unknown', v => v.ratings.push(v.ratings[0]), v => v.ratings[0].preference = 'improved', v => v.ratings[0].criteria = ['made-up']]) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.throws(() => summarizeHumanReviews(packet, key, [invalid]));
  }
});
test('text and mapping hashes bind imported votes to the exact compared versions', () => {
  const { packet, key } = create();
  const altered = structuredClone(packet); altered.items[0].A[0] = 'Different text.';
  assert.throws(() => validatePacketKey(altered, key));
  const swapped = structuredClone(key); const m = swapped.items[packet.items[0].id]; m.candidateSide = m.candidateSide === 'A' ? 'B' : 'A';
  assert.throws(() => validatePacketKey(packet, swapped));
});
test('identical copies cannot create a directional uplift vote', () => {
  const identical = { ...run, cases: [{ ...rows[0], candidate: rows[0].source }] };
  const { packet, key } = makeBlindPacket(identical, 'test');
  assert.throws(() => summarizeHumanReviews(packet, key, [votes(packet, key, 'one')]));
  assert.equal(summarizeHumanReviews(packet, key, [votes(packet, key, 'one', 'tie')], { minReviewersPerItem: 1 }).overall.ties, 1);
});
test('balanced side assignment is randomized independently of visible item order', () => {
  const patterns = new Set();
  for (let seed = 0; seed < 10; seed++) {
    const { packet, key } = makeBlindPacket(run, 'seed-' + seed);
    const sides = packet.items.map(item => key.items[item.id].candidateSide);
    assert.equal(sides.filter(side => side === 'A').length, 2);
    patterns.add(sides.join(''));
  }
  assert.ok(patterns.size > 2);
  const one = { ...run, cases: [rows[0]] };
  const singleSides = new Set(Array.from({ length: 10 }, (_, i) => Object.values(makeBlindPacket(one, 'seed-' + i).key.items)[0].candidateSide));
  assert.equal(singleSides.size, 2);
});
test('packet commits to side provenance and failed-case metadata as well as visible text', () => {
  const { packet, key } = create();
  const altered = structuredClone(key), mapping = altered.items[packet.items[0].id];
  mapping.candidateSide = mapping.candidateSide === 'A' ? 'B' : 'A';
  [mapping.sourceHash, mapping.candidateHash] = [mapping.candidateHash, mapping.sourceHash];
  assert.throws(() => validatePacketKey(packet, altered));
  assert.throws(() => validatePacketKey(packet, { ...key, attemptedCases: 4, failedCases: [], failedMetadata: [] }));
});
test('decisive win rate and share of all covered comparisons have distinct denominators', () => {
  const { packet, key } = create();
  const a = votes(packet, key, 'one', 'tie'), b = votes(packet, key, 'two', 'tie');
  a.ratings[0].preference = b.ratings[0].preference = key.items[packet.items[0].id].candidateSide;
  const summary = summarizeHumanReviews(packet, key, [a, b]);
  assert.equal(summary.overall.decisiveCandidateWinRate, 1);
  assert.equal(summary.overall.decisiveComparisons, 1);
  assert.equal(summary.overall.candidatePreferredShareOfCovered, 0.25);
  assert.equal(summary.byRole.unknown.failedCases.length, 1);
  assert.equal(summary.byRole.unknown.attemptedCases, 1);
});
test('technical summary includes failures and missing usage and computes an even-sample median correctly', async () => {
  const { summarizeTechnicalRun } = await import('../scripts/lib/uplift-evaluation.mjs');
  const summary = summarizeTechnicalRun({ cases: [
    { ...rows[0], trace: { elapsedMs: 100, outcome: 'completed' }, calls: [{ inputTokens: 12, outputTokens: 2 }] },
    { id: 'failed', ok: false, trace: { elapsedMs: 300 }, calls: [{ inputTokens: null, outputTokens: null }] },
  ] });
  assert.equal(summary.medianElapsedMs, 200);
  assert.equal(summary.completed, 1); assert.equal(summary.attempted, 2);
  assert.equal(summary.callsWithoutUsage, 1); assert.equal(summary.knownInputTokens, 12);
});
