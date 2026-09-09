// Cross-role source vs production comparisons. Human preferences remain unfilled.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runOptimizationHarness } from '../lib/optimizationHarness.ts';
import { reviewSemanticGrounding } from '../lib/semanticGrounding.ts';
import { DEFAULT_MODEL_ID } from '../lib/models.ts';
import { digest, validateCorpus, makeBlindPacket, summarizeHumanReviews } from './lib/uplift-evaluation.mjs';

const option = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error('Missing value for ' + flag);
  return process.argv[index + 1];
};
const corpus = validateCorpus(JSON.parse(readFileSync('eval/uplift/cases.json', 'utf8')));
const split = option('--split', 'development');
if (!['development', 'validation'].includes(split)) throw new Error('Use development or validation split.');
const limit = Number(option('--limit', '6'));
if (!Number.isInteger(limit) || limit < 1 || limit > corpus.length) throw new Error('Invalid case limit.');
const caseId = option('--case', null);
const selected = corpus.filter(c => c.split === split && (!caseId || c.id === caseId)).slice(0, limit);
if (!selected.length) throw new Error('No case matches this split and ID.');
const from = option('--from', null);
if (!process.argv.includes('--live') && !from) {
  console.log(JSON.stringify({ corpus: corpus.length, development: corpus.filter(c => c.split === 'development').length, reservedValidation: corpus.filter(c => c.split === 'validation').length, selected: selected.map(c => ({ id: c.id, role: c.roleFamily, evidence: c.evidenceLevel })), next: 'Use --live to run the production harness, or --from path/to/run.json to prepare blind review from a saved run.' }, null, 2));
  process.exit(0);
}
const dir = resolve(option('--out', 'eval/uplift/runs/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)));
if (existsSync(join(dir, 'run.json')) || existsSync(join(dir, 'packet.json'))) throw new Error('Output already contains a run or review packet; choose a new directory to preserve prior reviews.');
mkdirSync(dir, { recursive: true });
let run;
if (from) {
  run = JSON.parse(readFileSync(from, 'utf8'));
  if (run.version !== 1 || run.status !== 'completed' || !Array.isArray(run.cases)) throw new Error('Only completed version 1 runs can be packaged.');
} else {
  process.loadEnvFile('.env.local');
  if (!process.env.NOVITA_API_KEY) throw new Error('NOVITA_API_KEY is required');
  const model = process.env.NOVITA_MODEL || DEFAULT_MODEL_ID;
  const files = ['lib/optimizationHarness.ts', 'lib/numericRewriteFallback.ts', 'lib/contentQuality.ts', 'lib/optimizeChunks.ts', 'lib/optimizeContract.ts', 'lib/resumeStructure.ts', 'lib/semanticGrounding.ts', 'lib/resumeImpact.ts', 'scripts/eval-uplift.mjs', 'scripts/lib/uplift-evaluation.mjs'];
  run = { version: 1, runId: randomUUID(), createdAt: new Date().toISOString(), status: 'running', comparison: 'source_vs_production', split, corpusHash: digest(corpus), codeRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), codeHashes: Object.fromEntries(files.map(file => [file, digest(readFileSync(file, 'utf8'))])), model, cases: [] };
  for (const c of selected) {
    const calls = [];
    const complete = async ({ system, user, maxTokens, signal }) => {
      const started = performance.now();
      const call = { elapsedMs: 0, ok: false, inputTokens: null, outputTokens: null };
      try {
        const response = await fetch((process.env.NOVITA_BASE_URL || 'https://api.novita.ai/v3/openai') + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.NOVITA_API_KEY },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.4, max_tokens: maxTokens, response_format: { type: 'json_object' } }), signal,
        });
        if (!response.ok) throw new Error('Provider status ' + response.status);
        const data = await response.json();
        call.inputTokens = data.usage?.prompt_tokens ?? null;
        call.outputTokens = data.usage?.completion_tokens ?? null;
        const raw = data.choices?.[0]?.message?.content || '';
        const result = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        call.ok = true;
        return result;
      } finally { call.elapsedMs = Math.round(performance.now() - started); calls.push(call); }
    };
    const result = await runOptimizationHarness({ ...c.input, model }, { complete, reviewGrounding: reviewSemanticGrounding, runId: c.id });
    const source = [...c.input.resume.experience, ...(c.input.resume.projects ?? [])].flatMap(e => e.bullets.map(b => b.text));
    const candidate = result.ok ? [...result.optimization.roles, ...(result.optimization.projects ?? [])].flatMap(e => e.bullets.map(b => b.text)) : null;
    const trace = result.ok ? result.optimization.harness : result.trace;
    run.cases.push({ id: c.id, roleFamily: c.roleFamily, evidenceLevel: c.evidenceLevel, seniority: c.seniority, target: { title: c.input.job.title, seniority: c.seniority, responsibilities: c.input.job.responsibilities ?? [] }, sourceFacts: c.sourceFacts, source, candidate, ok: result.ok, error: result.ok ? undefined : result.error, trace, calls });
    writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
    console.log(c.id + ': ' + (result.ok ? trace.outcome : 'failed') + ', ' + trace.elapsedMs + ' ms, ' + calls.length + ' calls');
  }
  run.status = 'completed';
}
writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
const ok = run.cases.filter(c => c.ok), times = run.cases.map(c => c.trace.elapsedMs).sort((a, b) => a - b), calls = run.cases.flatMap(c => c.calls);
const technical = { attempted: run.cases.length, completed: ok.length, failed: run.cases.filter(c => !c.ok).map(c => c.id), unchanged: ok.filter(c => digest(c.source) === digest(c.candidate)).length,
  medianElapsedMs: times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null, maxElapsedMs: times.at(-1) ?? null, modelCalls: calls.length, knownInputTokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0), knownOutputTokens: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0), callsWithoutUsage: calls.filter(c => typeof c.inputTokens !== 'number' || typeof c.outputTokens !== 'number').length,
  scope: 'Experience/project content only. Technical completion and model review labels do not measure human preference or whole-document layout quality.' };
writeFileSync(join(dir, 'technical-summary.json'), JSON.stringify(technical, null, 2) + '\n');
if (!ok.length) { console.log('No completed comparison; saved failures to ' + dir); process.exitCode = 1; }
else {
  const { renderUpliftReview } = await import('./lib/uplift-review-html.mjs');
  const { packet, key } = makeBlindPacket(run);
  writeFileSync(join(dir, 'packet.json'), JSON.stringify(packet, null, 2) + '\n');
  writeFileSync(join(dir, 'analysis-key.json'), JSON.stringify(key, null, 2) + '\n');
  writeFileSync(join(dir, 'review.html'), renderUpliftReview(packet));
  writeFileSync(join(dir, 'human-summary.json'), JSON.stringify(summarizeHumanReviews(packet, key, []), null, 2) + '\n');
  console.log('Saved ' + dir + '/review.html. Share only that file with reviewers; keep the analysis key and run private until review is complete.');
  if (run.cases.some(c => !c.ok)) process.exitCode = 1;
}
