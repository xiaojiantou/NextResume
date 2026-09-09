import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { summarizeHumanReviews } from './lib/uplift-evaluation.mjs';
const args = process.argv.slice(2), options = {}, paths = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    if (!['--packet', '--key', '--out', '--min-reviewers'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid option: ' + args[i]);
    options[args[i]] = args[++i];
  } else paths.push(args[i]);
}
if (!options['--packet'] || !options['--key'] || !options['--out']) throw new Error('Supply --packet packet.json --key analysis-key.json --out summary.json followed by human export files.');
if ([options['--packet'], options['--key'], ...paths].map(resolvePath => resolve(resolvePath)).includes(resolve(options['--out']))) throw new Error('Output must not overwrite an input.');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const result = summarizeHumanReviews(read(options['--packet']), read(options['--key']), paths.map(read), { minReviewersPerItem: Number(options['--min-reviewers'] ?? 2) });
writeFileSync(options['--out'], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, reviewers: result.reviewers, coverage: result.overall.covered + '/' + result.overall.cases, attemptedCases: result.attemptedCases, failedCases: result.failedCases.length, decisiveComparisons: result.overall.decisiveComparisons, candidateWins: result.overall.candidateWins, sourceWins: result.overall.sourceWins, ties: result.overall.ties, decisiveCandidateWinRate: result.overall.decisiveCandidateWinRate, candidatePreferredShareOfCovered: result.overall.candidatePreferredShareOfCovered }, null, 2));
