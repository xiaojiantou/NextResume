import assert from 'node:assert/strict';
import test from 'node:test';
import { IncompleteCompletionError, withCompletionRetry } from '../lib/completionRetry.ts';

test('incomplete output retries once with a larger output budget', async () => {
  const budgets = [];
  const result = await withCompletionRetry(1500, async budget => {
    budgets.push(budget);
    if (budgets.length === 1) throw new IncompleteCompletionError();
    return { title: 'Engineer' };
  });
  assert.deepEqual(budgets, [1500, 3000]);
  assert.deepEqual(result, { title: 'Engineer' });
});

test('repeated incomplete output stops after two attempts', async () => {
  let calls = 0;
  await assert.rejects(withCompletionRetry(1500, async () => {
    calls++;
    throw new IncompleteCompletionError();
  }), IncompleteCompletionError);
  assert.equal(calls, 2);
});

test('successful output and unrelated failures do not retry', async () => {
  for (const error of [null, Object.assign(new Error('quota'), { status: 429 }), new SyntaxError('invalid JSON')]) {
    let calls = 0;
    const result = withCompletionRetry(1500, async () => {
      calls++;
      if (error) throw error;
      return 'ok';
    });
    if (error) await assert.rejects(result, e => e === error);
    else assert.equal(await result, 'ok');
    assert.equal(calls, 1);
  }
});

test('cancellation prevents a second attempt', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(withCompletionRetry(1500, async () => {
    calls++;
    controller.abort();
    throw new IncompleteCompletionError();
  }, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});
