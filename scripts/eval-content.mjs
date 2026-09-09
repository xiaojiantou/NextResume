// Compare saved baseline and production writing prompts on authored cases.
// No customer data is used. --live calls the configured Novita model.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildChunkPrompt, mapWithConcurrency } from '../lib/optimizeChunks.ts';
import { reviewContentQuality, parseContentReviews, CONTENT_REVIEW_SYSTEM } from '../lib/contentQuality.ts';
import { DEFAULT_MODEL_ID } from '../lib/models.ts';
const cases = JSON.parse(readFileSync('eval/content/cases.json', 'utf8'));
if (!process.argv.includes('--live')) {
  console.log(`${cases.length} authored cases: ${[...new Set(cases.map(c => c.category))].join(', ')}. Use --live for baseline/revised model comparison.`);
  process.exit(0);
}
process.loadEnvFile('.env.local');
if (!process.env.NOVITA_API_KEY) throw new Error('NOVITA_API_KEY is required');
const model = process.env.NOVITA_MODEL || DEFAULT_MODEL_ID;
const base = process.env.NOVITA_BASE_URL || 'https://api.novita.ai/v3/openai';
const calls = [];
async function complete({ system, user, maxTokens, signal }, phase = 'review', attempt = 0) {
  const start = performance.now();
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NOVITA_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.4, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
    signal: signal || AbortSignal.timeout(75_000),
  });
  if (response.status === 429 && attempt < 3) {
    await new Promise(resolve => setTimeout(resolve, 20_000));
    return complete({ system, user, maxTokens, signal }, phase, attempt + 1);
  }
  if (!response.ok) throw new Error(`Model request failed (${response.status})`);
  const data = await response.json();
  calls.push({ phase, ms: Math.round(performance.now() - start), usage: data.usage });
  const raw = data.choices?.[0]?.message?.content || '';
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
}
if (process.argv.includes('--calibrate')) {
  const raw = await complete({ system: CONTENT_REVIEW_SYSTEM, user: JSON.stringify({ bullets: cases.map(c => ({ id: c.id, source: c.source, candidate: c.candidate, job: c.job })) }), maxTokens: 3000 });
  const reviews = parseContentReviews(raw, cases.map(c => ({ id: c.id, source: c.source, candidate: c.candidate })));
  const disagreements = cases.filter(c => (reviews.get(c.id)?.status === 'improved' ? 'improved' : 'retain') !== c.expected || reviews.get(c.id)?.status === 'unreviewed' || (c.needsEvidence && !reviews.get(c.id)?.question)).map(c => c.id);
  writeFileSync('eval/content/calibration.json', JSON.stringify({ at: new Date().toISOString(), model, disagreements, reviews: Object.fromEntries(reviews), calls }, null, 2) + '\n');
  console.log(`${cases.length - disagreements.length}/${cases.length} calibration cases passed. Disagreements: ${disagreements.join(', ') || 'none'}`);
  process.exit(disagreements.length ? 1 : 0);
}
const baselinePath = resolve(`lib/.content-baseline-${process.pid}.ts`);
writeFileSync(baselinePath, readFileSync('eval/content/baseline-prompts.txt'));
try {
  const baseline = await import(pathToFileURL(baselinePath).href);
  const completed = [];
  const rows = await mapWithConcurrency(cases, 1, async c => {
    const resume = { name: 'Example Candidate', title: '', summary: '', skills: [], experience: [{ id: 'role', company: 'Example', title: '', bullets: [{ id: c.id, text: c.source }] }], projects: [], education: [] };
    const job = { title: c.job, requiredKeywords: [], niceToHaveKeywords: [] };
    const args = { chunk: { kind: 'role', id: 'role' }, resume, job, report: { missingKeywords: [] }, structureMode: 'optimize', lockedContentIds: [], baselineOptimization: null };
    const before = await complete(baseline.buildChunkPrompt(args), 'baseline');
    let after = await complete(buildChunkPrompt(args), 'revised');
    const judge = async text => (await reviewContentQuality({ pairs: [{ id: c.id, source: c.source, candidate: text }], job, complete, timeoutMs: 45_000 })).get(c.id);
    const baselineText = before.bullets?.[0]?.text;
    let revisedText = after.bullets?.[0]?.text;
    if (!baselineText || !revisedText) throw new Error(`Missing bullet for ${c.id}`);
    const baselineReview = await judge(baselineText);
    let revisedReview = await judge(revisedText);
    if (revisedReview.status === 'retained' && revisedText !== c.source) {
      after = await complete(buildChunkPrompt({ ...args, feedback: [`Content quality: ${revisedReview.reason} Previous candidate: ${revisedText}. Improve with original evidence or return the original verbatim.`] }), 'revision');
      revisedText = after.bullets?.[0]?.text || c.source;
      revisedReview = await judge(revisedText);
    }
    console.log(`${c.id}: baseline=${baselineReview.status}, revised=${revisedReview.status}`);
    const row = { ...c, baseline: baselineText, baselineReview, proposed: revisedText, final: revisedReview.status === 'improved' ? revisedText : c.source, revisedReview, humanPreference: null };
    completed.push(row);
    writeFileSync('eval/content/partial.json', JSON.stringify({ model, completed, calls }, null, 2) + '\n');
    return row;
  });
  const calibrationRaw = await complete({ system: CONTENT_REVIEW_SYSTEM, user: JSON.stringify({ bullets: cases.map(c => ({ id: c.id, source: c.source, candidate: c.candidate, job: c.job })) }), maxTokens: 2500 });
  const calibration = parseContentReviews(calibrationRaw, cases.map(c => ({ id: c.id, source: c.source, candidate: c.candidate })));
  const disagreements = cases.filter(c => (calibration.get(c.id)?.status === 'improved' ? 'improved' : 'retain') !== c.expected || calibration.get(c.id)?.status === 'unreviewed' || (c.needsEvidence && !calibration.get(c.id)?.question)).map(c => c.id);
  const output = { at: new Date().toISOString(), model, corpus: 'authored regression cases, not customer resumes', scope: 'writing + quality selection; full route safety validators covered separately by tests', disagreements, calibration: Object.fromEntries(calibration), calls, rows };
  writeFileSync('eval/content/latest.json', JSON.stringify(output, null, 2) + '\n');
  console.log(`Saved eval/content/latest.json; ${calls.length} calls; calibration disagreements: ${disagreements.join(', ') || 'none'}. Human preferences remain unfilled.`);
  unlinkSync('eval/content/partial.json');
  if (disagreements.length) process.exitCode = 1;
} finally { unlinkSync(baselinePath); }
