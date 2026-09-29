import assert from 'node:assert/strict';
import test from 'node:test';
import OpenAI from 'openai';
import { DEFAULT_MODEL_ID, FALLBACK_MODEL_ID, resolveModelSelection } from '../lib/models.ts';
import { isModelUnavailable, ModelUnavailableError, normalizeNovitaError, withModelFallback } from '../lib/modelAvailability.ts';
import { probeModel } from '../lib/modelHealth.ts';

const missing = () => Object.assign(new Error('model not found'), { status: 404, code: 'MODEL_NOT_FOUND' });
const reply = (content = '{"ok":true}', finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message: { content } }] });

test('Novita retirement reason survives the SDK error parser', async () => {
  const client = new OpenAI({ apiKey: 'test', maxRetries: 0, fetch: async () => normalizeNovitaError(Response.json({ reason: 'MODEL_NOT_FOUND', message: 'model not found' }, { status: 404 })) });
  await assert.rejects(client.chat.completions.create({ model: 'retired', messages: [] }), error => isModelUnavailable(error) && error.code === 'MODEL_NOT_FOUND');
});

test('retired environment and browser selections converge; custom settings are preserved', () => {
  assert.equal(resolveModelSelection(undefined, 'deepseek/deepseek-v3.2'), DEFAULT_MODEL_ID);
  assert.equal(resolveModelSelection('deepseek/deepseek-v3.2', 'custom/model'), DEFAULT_MODEL_ID);
  assert.equal(resolveModelSelection('stale/browser', 'custom/model'), 'custom/model');
  assert.equal(resolveModelSelection('gpt-4o', 'custom/model'), 'gpt-4o');
});

test('unavailable Novita primary uses exactly one vetted fallback', async () => {
  const calls = [];
  const result = await withModelFallback(DEFAULT_MODEL_ID, async id => {
    calls.push(id);
    if (id === DEFAULT_MODEL_ID) throw missing();
    return { ok: true };
  });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [DEFAULT_MODEL_ID, FALLBACK_MODEL_ID]);
});

test('exhausted fallback returns safe error; selected fallback never retries itself', async () => {
  for (const model of [DEFAULT_MODEL_ID, FALLBACK_MODEL_ID, 'gpt-4o']) {
    let calls = 0;
    await assert.rejects(withModelFallback(model, async () => { calls++; throw missing(); }), ModelUnavailableError);
    assert.equal(calls, model === DEFAULT_MODEL_ID ? 2 : 1);
  }
});

test('auth, quota, generic 404, malformed JSON and network failures never switch models', async () => {
  for (const error of [
    ...[401, 403, 429, 404, 500].map(status => Object.assign(new Error('request failed'), { status })),
    new SyntaxError('bad JSON'), new TypeError('fetch failed'),
  ]) {
    let calls = 0;
    await assert.rejects(withModelFallback(DEFAULT_MODEL_ID, async () => { calls++; throw error; }), e => e === error);
    assert.equal(calls, 1);
  }
});

test('cancellation prevents fallback', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(withModelFallback(DEFAULT_MODEL_ID, async () => {
    calls++; controller.abort(); throw missing();
  }, controller.signal), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('health requires a complete, parseable JSON answer', async () => {
  for (const [content, finish, alive] of [
    ['{"ok":true}', 'stop', true], ['```json\n{"ok":true}\n```', 'stop', true],
    ['', 'stop', false], ['{"ok":true}', 'length', false], ['not JSON', 'stop', false], ['{"ok":false}', 'stop', false],
  ]) {
    const result = await probeModel('test', 'https://example.invalid/', 'test-model', async () => reply(content, finish));
    assert.equal(result.alive, alive);
  }
});

test('health mirrors JSON-mode retry and keeps a single shared timeout', async () => {
  const requests = [];
  const result = await probeModel('test', 'https://example.invalid/', 'test-model', async (url, init) => {
    assert.equal(url, 'https://example.invalid/chat/completions');
    requests.push(init);
    return requests.length === 1 ? Response.json({}, { status: 400 }) : reply();
  });
  assert.equal(result.alive, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].body).response_format, { type: 'json_object' });
  assert.equal(JSON.parse(requests[1].body).response_format, undefined);
  assert.equal(requests[0].signal, requests[1].signal);
});

test('health reports missing model and never retries 404', async () => {
  let calls = 0;
  const result = await probeModel('test', 'https://example.invalid', 'retired', async () => {
    calls++; return Response.json({ reason: 'MODEL_NOT_FOUND' }, { status: 404 });
  });
  assert.equal(calls, 1);
  assert.equal(result.alive, false);
  assert.equal(result.note, 'MODEL_NOT_FOUND');
});

test('DeepSeek health requests disable thinking so reasoning cannot consume the JSON budget', async () => {
  const { structuredOutputOptions } = await import('../lib/models.ts');
  assert.deepEqual(structuredOutputOptions('openai', DEFAULT_MODEL_ID), {});
  assert.deepEqual(structuredOutputOptions('novita', FALLBACK_MODEL_ID), {});
  const result = await probeModel('test', 'https://example.invalid', DEFAULT_MODEL_ID, async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body).thinking, { type: 'disabled' });
    return reply();
  });
  assert.equal(result.alive, true);
});
