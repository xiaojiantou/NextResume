import assert from 'node:assert/strict';
import test from 'node:test';
import { agentTargets, runResumeAgent } from '../lib/resumeAgent.ts';
const bullet = { id: 'b1', text: 'Built React dashboards.', evidence: ['b1'], matchedKeywords: [], rationale: '' };
const resume = { experience: [{ id: 'r1', company: 'Example', bullets: [{ id: 'b1', text: 'Built React dashboards.' }] }], projects: [] };
const optimization = { roles: [{ id: 'r1', bullets: [bullet] }], projects: [] };
const targets = agentTargets(resume, optimization, []);

test('agent excludes locked entries and bullets without source evidence', () => {
  assert.equal(targets.length, 1);
  assert.deepEqual(agentTargets(resume, optimization, ['b1']), []);
  assert.deepEqual(agentTargets(resume, optimization, ['r1']), []);
  assert.deepEqual(agentTargets({ experience: [] }, optimization, []), []);
});
test('agent observes tool results before finishing and returns proposals without mutating input', async () => {
  let calls = 0;
  const result = await runResumeAgent({ instruction: 'Make it concise', job: {}, targets }, {
    complete: async args => {
      calls++;
      if (calls === 1) return { action: 'refine', id: 'b1' };
      assert.match(args.user, /Created dashboards/);
      return { action: 'finish', message: 'One proposed change.' };
    },
    refine: async () => ({ ok: true, bullet: { ...bullet, text: 'Created dashboards.' } }),
  });
  assert.equal(result.changes.length, 1);
  assert.equal(result.message, 'One proposed change.');
  assert.equal(optimization.roles[0].bullets[0].text, 'Built React dashboards.');
});
test('failed verification cannot become a proposal and repeated tool calls are bounded', async () => {
  let refinements = 0;
  let plans = 0;
  const result = await runResumeAgent({ instruction: 'Add invented numbers', job: {}, targets }, {
    complete: async () => { plans++; return { action: 'refine', id: 'b1' }; },
    refine: async () => { refinements++; return { ok: false, error: 'Unsupported claim' }; },
  });
  assert.equal(refinements, 1);
  assert.equal(plans, 4);
  assert.deepEqual(result.changes, []);
});
test('unknown tool targets never execute', async () => {
  const result = await runResumeAgent({ instruction: 'Change it', job: {}, targets }, {
    complete: async () => ({ action: 'refine', id: 'unknown' }),
    refine: async () => { assert.fail('unknown target executed'); },
  });
  assert.deepEqual(result.changes, []);
});
