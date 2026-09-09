// Evaluation plumbing only: model verdicts never become human preferences.
import { createHash, createHmac, randomBytes } from 'node:crypto';
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const CRITERIA = [
  { id: 'value', label: 'Value / impact', description: 'Explains what the work changed or enabled. Relevant qualitative value counts; a number is not required.' },
  { id: 'contribution', label: 'Contribution', description: 'Makes the person’s own action clear without upgrading participation to leadership.' },
  { id: 'specificity', label: 'Specificity', description: 'Keeps useful methods, scope and evidence; avoids generic claims.' },
  { id: 'relevance', label: 'Role relevance', description: 'Highlights evidence that matters for this role without adding job-description facts.' },
  { id: 'clarity', label: 'Clarity', description: 'Communicates the work directly and reads naturally; extra length is not automatically better.' },
];
export function validateCorpus(cases) {
  if (!Array.isArray(cases) || !cases.length) throw new Error('The corpus must contain cases.');
  const ids = new Set();
  for (const c of cases) {
    if (!c || typeof c.id !== 'string' || ids.has(c.id) || !['development', 'validation'].includes(c.split) ||
        !['measured', 'qualitative', 'sparse'].includes(c.evidenceLevel) || typeof c.roleFamily !== 'string' ||
        typeof c.seniority !== 'string' || !Array.isArray(c.sourceFacts) || !c.sourceFacts.length || c.sourceFacts.some(f => typeof f !== 'string' || !f.trim()) ||
        !c.input?.resume || !c.input?.job || !Array.isArray(c.input?.report?.missingKeywords)) throw new Error('Invalid or duplicate corpus case: ' + c?.id);
    ids.add(c.id);
    const source = [...c.input.resume.experience, ...(c.input.resume.projects ?? [])].flatMap(e => e.bullets);
    if (!source.length || new Set(source.map(b => b.id)).size !== source.length || source.some(b => typeof b.text !== 'string' || !b.text.trim())) throw new Error('Invalid source bullets: ' + c.id);
  }
  return cases;
}

export function makeBlindPacket(run, seed = randomBytes(32).toString('hex')) {
  if (new Set(run.cases.map(c => c.id)).size !== run.cases.length) throw new Error("Duplicate case IDs in run.");
  const eligible = run.cases.filter(c => c.ok);
  if (!eligible.length) throw new Error('No completed comparisons to review. Failed cases remain in the run report.');
  const order = id => createHmac('sha256', seed).update(id).digest('hex');
  const entries = [...eligible].sort((a, b) => order('order:' + a.id).localeCompare(order('order:' + b.id)));
  const aCount = Math.floor(entries.length / 2) + (entries.length % 2 ? parseInt(order('extra-side').slice(0, 2), 16) % 2 : 0);
  const aCases = new Set([...entries].sort((a, b) => order('side:' + a.id).localeCompare(order('side:' + b.id))).slice(0, aCount).map(row => row.id));
  const mapping = {};
  const items = entries.map(row => {
    if (!Array.isArray(row.source) || !Array.isArray(row.candidate) || !row.source.length || !row.candidate.length || [...row.source, ...row.candidate].some(t => typeof t !== 'string')) throw new Error('Incomplete comparison: ' + row.id);
    const id = order('item:' + row.id).slice(0, 24);
    const candidateSide = aCases.has(row.id) ? 'A' : 'B';
    const sourceHash = digest(row.source), candidateHash = digest(row.candidate);
    mapping[id] = { caseId: row.id, roleFamily: row.roleFamily, evidenceLevel: row.evidenceLevel, candidateSide, sourceHash, candidateHash, unchanged: sourceHash === candidateHash };
    return { id, target: row.target, sourceFacts: row.sourceFacts, A: candidateSide === 'A' ? row.candidate : row.source, B: candidateSide === 'B' ? row.candidate : row.source };
  });
  const keyContent = { version: 1, nonce: order('mapping-nonce'), runId: run.runId, corpusHash: run.corpusHash, attemptedCases: run.cases.length, failedCases: run.cases.filter(c => !c.ok).map(c => c.id), failedMetadata: run.cases.filter(c => !c.ok).map(c => ({ caseId: c.id, roleFamily: c.roleFamily || 'unknown', evidenceLevel: c.evidenceLevel || 'unknown' })), items: mapping };
  const content = { version: 1, title: 'Resume content review', criteria: CRITERIA, items, mappingDigest: digest(keyContent) };
  const packetId = digest(content);
  return { packet: { ...content, packetId }, key: { ...keyContent, packetId } };
}
export function validatePacketKey(packet, key) {
  const { packetId, ...content } = packet;
  const { packetId: keyPacketId, ...keyContent } = key;
  if (packet.version !== 1 || key.version !== 1 || packetId !== digest(content) || keyPacketId !== packetId || packet.mappingDigest !== digest(keyContent) || Object.keys(key.items).length !== packet.items.length || !Array.isArray(key.failedCases) || new Set(key.failedCases).size !== key.failedCases.length || key.attemptedCases !== packet.items.length + key.failedCases.length) throw new Error('Packet or mapping does not match this comparison.');
  for (const item of packet.items) {
    const m = key.items[item.id];
    if (!m || !['A', 'B'].includes(m.candidateSide) || digest(item[m.candidateSide]) !== m.candidateHash || digest(item[m.candidateSide === 'A' ? 'B' : 'A']) !== m.sourceHash || m.unchanged !== (m.candidateHash === m.sourceHash)) throw new Error('Comparison text or mapping changed.');
  }
}
export function validateReview(packet, review) {
  if (!review || review.version !== 1 || review.packetId !== packet.packetId || review.attested !== true ||
      typeof review.reviewer !== 'string' || !review.reviewer.trim() || review.reviewer.length > 80 || !Array.isArray(review.ratings) || !review.ratings.length) throw new Error('A matching packet, reviewer code, human attestation and explicit ratings are required.');
  const ids = new Set(), allowed = new Set(packet.items.map(item => item.id)), criteria = new Set(packet.criteria.map(c => c.id));
  for (const rating of review.ratings) {
    if (!rating || !allowed.has(rating.itemId) || ids.has(rating.itemId) || !['A', 'B', 'tie', 'neither'].includes(rating.preference) ||
        !Array.isArray(rating.factualConcerns) || new Set(rating.factualConcerns).size !== rating.factualConcerns.length || rating.factualConcerns.some(side => !['A', 'B'].includes(side)) ||
        !Array.isArray(rating.criteria) || new Set(rating.criteria).size !== rating.criteria.length || rating.criteria.some(id => !criteria.has(id)) || typeof rating.reason !== 'string' || rating.reason.length > 2000) throw new Error('Invalid, unknown or duplicated rating.');
    ids.add(rating.itemId);
  }
  return { ...review, reviewer: review.reviewer.trim() };
}

export function summarizeHumanReviews(packet, key, reviews, { minReviewersPerItem = 2 } = {}) {
  validatePacketKey(packet, key);
  if (!Number.isInteger(minReviewersPerItem) || minReviewersPerItem < 1) throw new Error('Invalid coverage requirement.');
  const reviewers = new Set(), ratings = [];
  for (const raw of reviews) {
    const review = validateReview(packet, raw);
    const identity = review.reviewer.toLocaleLowerCase();
    if (reviewers.has(identity)) throw new Error('Duplicate reviewer code; combine or replace that person’s export rather than counting it twice.');
    reviewers.add(identity);
    for (const rating of review.ratings) {
      const mapped = key.items[rating.itemId];
      if (mapped.unchanged && ['A', 'B'].includes(rating.preference)) throw new Error('Identical text was given a directional preference; recheck this rating.');
      ratings.push({ ...rating, reviewer: identity, preference: rating.preference === mapped.candidateSide ? 'candidate' : ['A', 'B'].includes(rating.preference) ? 'source' : rating.preference,
        candidateConcern: rating.factualConcerns.includes(mapped.candidateSide), sourceConcern: rating.factualConcerns.includes(mapped.candidateSide === 'A' ? 'B' : 'A') });
    }
  }
  const cases = packet.items.map(item => {
    const votes = ratings.filter(r => r.itemId === item.id);
    const counts = Object.fromEntries(['candidate', 'source', 'tie', 'neither'].map(p => [p, votes.filter(v => v.preference === p).length]));
    const majority = Object.entries(counts).find(([, count]) => count > votes.length / 2)?.[0];
    return { itemId: item.id, ...key.items[item.id], reviews: votes.length, counts, consensus: votes.length >= minReviewersPerItem ? majority ?? 'mixed' : 'pending', candidateConcerns: votes.filter(v => v.candidateConcern).length, sourceConcerns: votes.filter(v => v.sourceConcern).length };
  });
  const group = (subset, failed = []) => {
    const wins = subset.filter(c => c.consensus === 'candidate').length, losses = subset.filter(c => c.consensus === 'source').length;
    const covered = subset.filter(c => c.reviews >= minReviewersPerItem).length;
    return { cases: subset.length, attemptedCases: subset.length + failed.length, failedCases: failed.map(c => c.caseId), covered: subset.filter(c => c.reviews >= minReviewersPerItem).length, candidateWins: wins, sourceWins: losses, ties: subset.filter(c => c.consensus === 'tie').length, neither: subset.filter(c => c.consensus === 'neither').length, mixed: subset.filter(c => c.consensus === 'mixed').length, decisiveComparisons: wins + losses, decisiveCandidateWinRate: wins + losses ? wins / (wins + losses) : null, candidatePreferredShareOfCovered: covered ? wins / covered : null, candidateConcernRatings: subset.reduce((sum, c) => sum + c.candidateConcerns, 0) };
  };
  const overall = group(cases, key.failedMetadata);
  return { version: 1, packetId: packet.packetId, runId: key.runId,
    status: !ratings.length ? 'pending_human_review' : overall.covered < cases.length ? 'insufficient_coverage' : overall.candidateConcernRatings ? 'factual_concerns_need_review' : key.failedCases.length ? 'generation_failures_need_review' : 'ready_for_human_assessment',
    basis: 'Self-attested human exports; reviewer identity is not independently verified. Model scores are excluded.',
    coverageRequirement: minReviewersPerItem, reviewers: reviewers.size, ratings: ratings.length, attemptedCases: key.attemptedCases, failedCases: key.failedCases,
    overall, byRole: Object.fromEntries([...new Set([...cases, ...key.failedMetadata].map(c => c.roleFamily))].map(role => [role, group(cases.filter(c => c.roleFamily === role), key.failedMetadata.filter(c => c.roleFamily === role))])),
    byEvidence: Object.fromEntries([...new Set([...cases, ...key.failedMetadata].map(c => c.evidenceLevel))].map(level => [level, group(cases.filter(c => c.evidenceLevel === level), key.failedMetadata.filter(c => c.evidenceLevel === level))])), cases };
}

export function summarizeTechnicalRun(run) {
  const completed = run.cases.filter(c => c.ok);
  const times = run.cases.map(c => c.trace.elapsedMs).sort((a, b) => a - b);
  const calls = run.cases.flatMap(c => c.calls);
  return { attempted: run.cases.length, completed: completed.length, failed: run.cases.filter(c => !c.ok).map(c => c.id), unchanged: completed.filter(c => digest(c.source) === digest(c.candidate)).length,
    fallbacks: completed.filter(c => c.trace.outcome === 'fallback').map(c => c.id),
    medianElapsedMs: times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null,
    maxElapsedMs: times.at(-1) ?? null, modelCalls: calls.length,
    knownInputTokens: calls.reduce((sum, c) => sum + (typeof c.inputTokens === 'number' ? c.inputTokens : 0), 0),
    knownOutputTokens: calls.reduce((sum, c) => sum + (typeof c.outputTokens === 'number' ? c.outputTokens : 0), 0),
    callsWithoutUsage: calls.filter(c => typeof c.inputTokens !== 'number' || typeof c.outputTokens !== 'number').length,
    scope: 'Experience/project content only. Technical completion and model review labels do not measure human preference or whole-document layout quality.' };
}
