import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as models from '../lib/models.ts';

const code = ts.transpileModule(readFileSync('app/api/cron/model-watch/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load({ catalogFails = false, dead = [], env = {}, redisFails = false, emailOk = true, delisted = [] } = {}) {
  const probes = [], emails = [];
  const exports = {};
  const modules = {
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } },
    '@/lib/ai': { ENV_MODEL: models.DEFAULT_MODEL_ID },
    '@/lib/models': models,
    '@/lib/modelHealth': { probeModel: async (_key, _base, id) => { probes.push(id); return { id, alive: !dead.includes(id), note: dead.includes(id) ? 'MODEL_NOT_FOUND' : '' }; } },
    '@/lib/email': { sendAlertEmail: async message => { emails.push(message); return { ok: emailOk }; } },
    '@/lib/orders': { hasRedis: () => true, getRedis: () => ({ get: async () => { if (redisFails) throw new Error('Redis down'); return null; }, set: async () => { if (redisFails) throw new Error('Redis down'); } }) },
  };
  vm.runInNewContext(code, {
    exports, require: id => { if (!(id in modules)) throw new Error(id); return modules[id]; },
    process: { env: { NODE_ENV: 'production', CRON_SECRET: 'test', NOVITA_API_KEY: 'test', EMAIL_FROM_EMAIL: 'ops@example.invalid', MAILERSEND_API_KEY: 'test', ...env } },
    console: { error() {} }, AbortSignal,
    fetch: async () => { if (catalogFails) throw new Error('Catalog down'); return Response.json({ data: models.MODELS.filter(m => m.provider === 'novita' && !delisted.includes(m.id)) }); },
  });
  return { run: (auth = 'Bearer test') => exports.GET({ headers: new Headers({ authorization: auth }) }), probes, emails };
}

test('cron rejects unauthorized requests without probing or sending email', async () => {
  const h = load(); assert.equal((await h.run('bad')).status, 401);
  assert.equal(h.probes.length, 0); assert.equal(h.emails.length, 0);
});

test('catalog and Redis failures cannot suppress model-down alerts', async () => {
  const h = load({ catalogFails: true, redisFails: true, dead: [models.DEFAULT_MODEL_ID] });
  const result = await h.run();
  assert.equal(result.status, 503);
  assert.equal(result.body.catalogError, true);
  assert.ok(h.probes.includes(models.DEFAULT_MODEL_ID));
  assert.ok(h.probes.includes(models.FALLBACK_MODEL_ID));
  assert.equal(h.emails.length, 1);
  assert.match(h.emails[0].text, /MODEL_NOT_FOUND/);
});

test('healthy models do not hide absent alert credentials', async () => {
  const h = load({ env: { MAILERSEND_API_KEY: '' } });
  const result = await h.run();
  assert.equal(result.status, 503); assert.equal(result.body.alertConfigured, false);
});

test('failed alert delivery remains unhealthy', async () => {
  const h = load({ dead: [models.DEFAULT_MODEL_ID], emailOk: false });
  const result = await h.run();
  assert.equal(result.status, 503); assert.equal(result.body.emailed, false);
});

test('healthy, delisted model triggers early-warning email', async () => {
  const h = load({ delisted: [models.DEFAULT_MODEL_ID] });
  const result = await h.run();
  assert.equal(result.status, 200); assert.equal(h.emails.length, 1);
  assert.match(h.emails[0].text, /Delisted/);
});

test('healthy and configured watch succeeds without sending email', async () => {
  const h = load(); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  assert.equal(h.emails.length, 0);
});
