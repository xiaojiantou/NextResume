import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_BATCH_SIZE, REVIEW_WORKERS, contentRevisionIssues, parseContentReviews, qualityPairs, selectReviewedContent, currentContentReview, reviewContentQuality } from '../lib/contentQuality.ts';
const source = { experience: [{ id: 'r1', bullets: [{ id: 'b1', text: 'Assisted with weekly supplier reviews.' }] }], projects: [] };
const candidate = { roles: [{ id: 'r1', bullets: [{ id: 'b1', text: 'Owned supplier strategy.', evidence: ['b1'], matchedKeywords: ['strategy'], rationale: 'Strong ownership' }] }], projects: [] };
const pair = qualityPairs(source, candidate);
test('lost detail or inflated ownership keeps the source and clears claimed keyword gains', () => {
  const reviews = parseContentReviews({ reviews: [{ id: 'b1', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Assistance does not establish ownership.', dimensions: [], question: 'What did you personally do during the reviews?' }] }, pair);
  const result = selectReviewedContent(candidate, reviews).roles[0].bullets[0];
  assert.equal(result.text, source.experience[0].bullets[0].text);
  assert.deepEqual(result.matchedKeywords, []);
  assert.equal(result.contentReview.status, 'retained');
  assert.match(result.contentReview.question, /personally/);
  assert.equal(currentContentReview({ ...result, text: 'Manual edit' }), undefined);
});
test('missing, duplicate and malformed review decisions cannot endorse output', () => {
  for (const raw of [null, { reviews: [] }, { reviews: [{ id: 'b1', decision: 'improved', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'better', dimensions: [] }] }, { reviews: [{ id: 'b1' }, { id: 'b1' }] }]) {
    const result = selectReviewedContent(candidate, parseContentReviews(raw, pair)).roles[0].bullets[0];
    assert.equal(result.text, pair[0].source);
    assert.equal(result.contentReview.status, 'unreviewed');
  }
});
test('concrete improvement survives with its explanation; stale review never changes a new candidate', () => {
  const reviews = parseContentReviews({ reviews: [{ id: 'b1', decision: 'improved', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Makes action clearer.', dimensions: ['clarity'] }] }, pair);
  assert.equal(selectReviewedContent(candidate, reviews).roles[0].bullets[0].contentReview.status, 'improved');
  const next = structuredClone(candidate); next.roles[0].bullets[0].text = 'Different text';
  assert.equal(selectReviewedContent(next, reviews).roles[0].bullets[0].contentReview, undefined);
});
test('entry and bullet locks are excluded from quality replacement', () => {
  assert.deepEqual(qualityPairs(source, candidate, ['r1']), []);
  assert.deepEqual(qualityPairs(source, candidate, ['b1']), []);
});
test('reviewer outage keeps originals and reports unavailable rather than claiming improvement', async () => {
  const reviews = await reviewContentQuality({ pairs: pair, job: {}, complete: async () => { throw new Error('offline'); } });
  assert.equal(selectReviewedContent(candidate, reviews).roles[0].bullets[0].contentReview.status, 'unreviewed');
});
test('unchanged originals cannot be labeled improved even if the judge says so', () => {
  const same = [{ ...pair[0], candidate: pair[0].source }];
  const reviews = parseContentReviews({ reviews: [{ id: 'b1', decision: 'improved', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Clear.', dimensions: ['clarity'] }] }, same);
  assert.equal(reviews.get('b1').status, 'retained');
});

test('factual audit overrides a contradictory improvement decision', () => {
  for (const flag of ['supported', 'detailsPreserved', 'causalityPreserved']) {
    const review = { id: 'b1', decision: 'improved', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'New outcome is not in the source.', dimensions: ['impact'], [flag]: false };
    const result = selectReviewedContent(candidate, parseContentReviews({ reviews: [review] }, pair));
    assert.equal(result.roles[0].bullets[0].text, pair[0].source);
  }
});

test('long resumes use bounded batches and preserve reviews when another batch fails', async () => {
  const pairs = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, source: 'Original', candidate: 'Revised' }));
  let active = 0, peak = 0;
  const reviews = await reviewContentQuality({ pairs, job: {}, complete: async ({ user }) => {
    const { bullets } = JSON.parse(user);
    assert.ok(bullets.length <= REVIEW_BATCH_SIZE);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (bullets.some(b => b.id === 'b8')) throw new Error('one batch failed');
    return { reviews: bullets.map(b => ({ id: b.id, decision: 'improved', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Clarifies the action.', dimensions: ['clarity'] })) };
  } });
  assert.equal(peak, REVIEW_WORKERS);
  assert.equal(reviews.size, 20);
  assert.equal(reviews.get('b0').status, 'improved');
  assert.equal(reviews.get('b8').status, 'unreviewed');
  assert.equal(reviews.get('b19').status, 'improved');
});


test('revision planning requires current evidence, a concrete direction, and an unused retry', () => {
  const pair = { id: 'b1', source: 'Weak original', candidate: 'Weak original' };
  const review = { text: pair.candidate, sourceText: pair.source, status: 'retained', reason: 'Task is buried.', dimensions: [], nextStep: 'revise', revisionInstruction: 'Lead with the documented task.' };
  const plan = next => contentRevisionIssues([pair], new Map([['b1', next]]), new Set());
  assert.equal(plan(review).length, 1);
  assert.equal(plan({ ...review, sourceText: 'Different source' }).length, 0);
  assert.equal(plan({ ...review, text: 'Different candidate' }).length, 0);
  assert.equal(plan({ ...review, revisionInstruction: '' }).length, 0);
  assert.equal(plan({ ...review, nextStep: 'ask' }).length, 0);
  assert.equal(contentRevisionIssues([pair], new Map([['b1', review]]), new Set(['b1'])).length, 0);
});


test('a narrow grammar check catches unchanged explicit tasks the reviewer incorrectly calls strong', () => {
  const source = 'I was responsible for the task of reviewing pull requests for the mobile team.';
  const rows = { reviews: [{ id: 'b1', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, dimensions: [], reason: 'Already strong.', nextStep: 'keep' }] };
  const review = parseContentReviews(rows, [{ id: 'b1', source, candidate: source }]).get('b1');
  assert.equal(review.nextStep, 'revise');
  assert.match(review.revisionInstruction, /reviewing task/);
  const generic = 'Responsible for sales.';
  assert.equal(parseContentReviews(rows, [{ id: 'b1', source: generic, candidate: generic }]).get('b1').nextStep, 'keep');
});

test('a changed but rejected dense bullet gets a source-based retry without approval or loss of its rejection reason', () => {
  const source = 'I was responsible for adding prompt caching to an internal LLM assistant; cost fell from $12 to $9 per 1,000 requests on the same request set with the model and cache-hit mix fixed.';
  const candidateText = 'Reduced costs from $12 to $9 per 1,000 requests using prompt caching and a fixed model.';
  const pairs = [{ id: 'b1', source, candidate: candidateText }];
  const reviews = parseContentReviews({ reviews: [{ id: 'b1', decision: 'retain', supported: true, detailsPreserved: false, causalityPreserved: true, reason: 'Drops the same request set and fixed cache-hit mix.', dimensions: [], nextStep: 'keep' }] }, pairs);
  const review = reviews.get('b1');
  assert.equal(review.status, 'retained');
  assert.equal(review.audit.detailsPreserved, false);
  assert.match(review.reason, /same request set/);
  assert.equal(review.nextStep, 'revise');
  assert.match(review.revisionInstruction, /original source/);
  assert.equal(contentRevisionIssues(pairs, reviews, new Set()).length, 1);
  assert.equal(contentRevisionIssues(pairs, reviews, new Set(['b1'])).length, 0);
});
test('task repair never forces acceptance or overrides assistance, future work, evidence questions or approved content', () => {
  const row = { id: 'b1', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Keep.', dimensions: [], nextStep: 'keep' };
  for (const source of [
    'Responsible for sales.',
    'Assisted with adding caching for the team.',
    'Was responsible for implementing a migration planned for next quarter.',
    'Was responsible for building a system that was not yet completed.',
    'Maintained monitoring for approximately 18 million input tokens per month.',
  ]) {
    const review = parseContentReviews({ reviews: [row] }, [{ id: 'b1', source, candidate: source }]).get('b1');
    assert.equal(review.nextStep, 'keep');
  }
  const source = 'Was responsible for implementing report validation in Python.';
  const pair = [{ id: 'b1', source, candidate: 'Implemented report validation in Python.' }];
  assert.equal(parseContentReviews({ reviews: [{ ...row, nextStep: 'ask', question: 'Which validation did you implement?' }] }, pair).get('b1').nextStep, 'ask');
  const improved = parseContentReviews({ reviews: [{ ...row, decision: 'improved', dimensions: ['clarity'] }] }, pair).get('b1');
  assert.equal(improved.status, 'improved');
  assert.equal(improved.nextStep, 'keep');
});

test('an ask without a question stays actionable and preserves the source instead of retrying without evidence', () => {
  const sourceText = 'Helped prepare email campaigns for course launches.';
  const pairs = [{ id: 'b1', source: sourceText, candidate: 'Owned course launch campaigns.' }];
  for (const question of [undefined, null, '', '   ', 42]) {
    const reviews = parseContentReviews({ reviews: [{ id: 'b1', decision: 'retain', supported: false, detailsPreserved: true, causalityPreserved: true, reason: 'The personal contribution is unclear.', dimensions: [], nextStep: 'ask', question }] }, pairs);
    const review = reviews.get('b1');
    assert.equal(review.nextStep, 'ask');
    assert.equal(review.question, 'What did you personally do as part of this work?');
    assert.equal(review.audit.supported, false);
    assert.deepEqual(contentRevisionIssues(pairs, reviews, new Set()), []);
    const output = selectReviewedContent({ roles: [{ id: 'r1', bullets: [{ id: 'b1', text: pairs[0].candidate }] }] }, reviews).roles[0].bullets[0];
    assert.equal(output.text, sourceText);
    assert.equal(currentContentReview(output).question, review.question);
  }
});

test('fallback questions use the source language and distinguish participation from explicit work', () => {
  const row = { id: 'b1', decision: 'retain', supported: false, detailsPreserved: true, causalityPreserved: true, reason: 'More evidence is needed.', dimensions: [], nextStep: 'ask' };
  for (const sourceText of ['Assisted with inventory counts.', 'Worked on a delivery dashboard.', 'I helped prepare the weekly report.']) {
    const review = parseContentReviews({ reviews: [row] }, [{ id: 'b1', source: sourceText, candidate: 'Built the whole reporting system.' }]).get('b1');
    assert.equal(review.question, 'What did you personally do as part of this work?');
  }
  for (const sourceText of ['参与配送数据看板的开发。', '协助整理客户访谈记录。']) {
    const review = parseContentReviews({ reviews: [row] }, [{ id: 'b1', source: sourceText, candidate: 'Built a reporting system.' }]).get('b1');
    assert.equal(review.question, '这项工作中，你具体做了什么？');
  }
  for (const [sourceText, expected] of [
    ['Updated the marketing team’s event calendar.', 'If this work was used, how was it used?'],
    ['更新了市场团队的活动日历。', '如果这项工作被实际使用了，它是如何被使用的？'],
  ]) {
    const review = parseContentReviews({ reviews: [row] }, [{ id: 'b1', source: sourceText, candidate: 'Helped with events.' }]).get('b1');
    assert.equal(review.question, expected);
  }
});

test('provided evidence questions survive and strong or unavailable reviews do not gain fallback questions', () => {
  const sourceText = 'Updated the scheduling product backlog.';
  const pairs = [{ id: 'b1', source: sourceText, candidate: sourceText }];
  const row = { id: 'b1', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'The task is clear.', dimensions: [], nextStep: 'ask' };
  const question = 'Which backlog items did you personally update?';
  assert.equal(parseContentReviews({ reviews: [{ ...row, question: `  ${question}  ` }] }, pairs).get('b1').question, question);
  assert.equal(parseContentReviews({ reviews: [{ ...row, nextStep: 'keep' }] }, pairs).get('b1').question, undefined);
  assert.equal(parseContentReviews({ reviews: [{ ...row, nextStep: 'revise', revisionInstruction: 'Lead with the documented task.' }] }, pairs).get('b1').question, undefined);
  const approved = parseContentReviews({ reviews: [{ ...row, decision: 'improved', dimensions: ['clarity'], nextStep: 'keep' }] }, [{ ...pairs[0], candidate: 'Kept the scheduling product backlog updated.' }]).get('b1');
  assert.equal(approved.status, 'improved');
  assert.equal(approved.question, undefined);
  for (const raw of [null, { reviews: [{ ...row, supported: undefined }] }, { reviews: [row, row] }]) {
    const review = parseContentReviews(raw, pairs).get('b1');
    assert.equal(review.status, 'unreviewed');
    assert.equal(review.question, undefined);
  }
});

test('an ATS-selected rewrite still has an actionable optional ask when the reviewer omits its question', () => {
  const sourceText = 'Implemented REST endpoints for the invoice service.';
  const pairs = [{ id: 'b1', source: sourceText, candidate: 'Implemented API development for the invoice service’s REST endpoints.' }];
  const review = parseContentReviews({ reviews: [{ id: 'b1', decision: 'retain', supported: true, detailsPreserved: true, causalityPreserved: true, reason: 'Only uses the job’s equivalent terminology.', dimensions: [], nextStep: 'ask', question: '' }] }, pairs, { requiredKeywords: ['API development'], niceToHaveKeywords: [] }).get('b1');
  assert.equal(review.status, 'improved');
  assert.equal(review.selectionBasis, 'ats_rubric');
  assert.equal(review.nextStep, 'ask');
  assert.equal(review.question, 'If this work was used, how was it used?');
});
