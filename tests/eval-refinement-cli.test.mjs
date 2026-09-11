import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const corpus = 'eval/content/sparse-evidence-cases.json';
const run = args => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/eval-refinement.mjs', ...args], { encoding: 'utf8' });
test('custom refinement cases validate without model calls or creating output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextresume-evidence-cli-'));
  try {
    const output = join(dir, 'new', 'smoke.json');
    const result = run(['--cases', corpus, '--case', 'sparse-email-confirmed-tasks', '--out', output]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 authored cases validated/);
    assert.equal(existsSync(output), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('an existing explicit output is rejected before a live call and remains unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextresume-evidence-cli-'));
  try {
    const output = join(dir, 'preserved.json');
    writeFileSync(output, 'original evidence');
    const result = run(['--live', '--smoke', '--cases', corpus, '--out', output]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Output already exists/);
    assert.equal(readFileSync(output, 'utf8'), 'original evidence');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('missing option values and unknown case IDs fail before evaluation', () => {
  for (const [args, message] of [[['--cases'], /Missing value for --cases/], [['--cases', corpus, '--case', 'missing'], /No matching case/]]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
});
