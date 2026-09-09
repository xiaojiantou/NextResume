# Resume content quality

Baseline: commit 62a7dbb, with the pre-change rewrite implementation saved in
baseline-prompts.txt. The only checked-in resume is example-platform.json; it
is explicitly an example, not a collection of customer resumes. No real
before/after corpus is available in this workspace. The cases here are authored
regression examples, not evidence of measured customer uplift.

Baseline findings:
- Optimize mode prioritizes keyword naming and a fixed list of ownership verbs.
- Preserve mode says to preserve content exactly but barely defines better writing.
- Semantic review accepts weaker claims and explicitly ignores missing details.
- Refinement imposes 240 characters, which can remove meaningful evidence.

Quality standard (compare original and candidate for the target job):
1. Clarity: the action and object are immediately understandable.
2. Specificity: preserve meaningful methods, tools, scope, and constraints.
3. Contribution: state the candidate's actual participation without upgrading
   assistance to ownership, leadership, or sole credit.
4. Impact: foreground an existing result and keep its causal attribution intact.
   A qualitative result is valid; missing results require a question, not invention.
5. Relevance: make demonstrated job-relevant experience easy to recognize.

Accept only a concrete gain in at least one dimension without material regression
in another. Cosmetic synonym swaps are not gains. Retain already strong originals.
Factual correctness is a gate, not a score to trade against writing quality.
Questions must ask for missing evidence, without suggesting an invented answer.

Release evaluation: use the same source/job pairs for baseline and revised
prompts, retain the actual outputs and timing/token usage, and collect blind
human preferences (original / baseline / revised / tie). Report unsupported
claims and lost details separately from preference. Automated model judgments
are provisional; they do not substitute for human review or customer data.

## Implementation and checks

- Production entry prompts share `CONTENT_WRITING_STANDARD` in
  `lib/contentQuality.ts`, including preserve mode and single-bullet refinement.
- The full optimize route independently reviews work/project bullets in batches
  of eight, with two workers and a shared 30-second deadline. It requests at
  most one quality-driven revision per rejected bullet within the existing
  three-attempt request budget. The final deliverable passes the existing
  factual, structural, lock, and keyword checks again after source restoration.
- The reviewer must explicitly check support, detail preservation, and causal
  attribution. Malformed, missing, or unavailable judgments keep source wording
  and receive an unavailable label. Locked content is excluded from selection.
- Review metadata is bound to the exact text reviewed; edits stop displaying
  stale improvement labels. The existing comparison UI shows the reason and
  optional evidence question. Answers persist locally and are included in the
  refinement request; accepting a suggestion uses the existing edit/lock flow.
- Optimization cache keys include a content-quality revision. Existing open
  results remain visible and can be regenerated using the updated workflow.

Run `npm test`, `npx tsc --noEmit`, and (with the dev server on port 3000)
`npm run test:content-ui`. Browser checks mock APIs and test questions, persisted
answers across reloads, refinement request content, acceptance, locks, and mobile
width without purchasing or calling a model.

Run `npm run eval:content` for a paid model comparison using the configured
Novita credentials. `node --experimental-strip-types scripts/eval-content.mjs
--live --calibrate` checks only the reviewer against fixed labeled candidates.
Provider usage and elapsed time are recorded separately by phase. Token usage
is a cost input, not a quoted currency price. No customer data is sent by this
corpus. Partial runs are saved separately and are not a successful evaluation.

## Findings from development runs

`initial-findings.json` records why the first reviewer was insufficient: it
accepted an invented onboarding benefit and gave logging causal credit for a
latency reduction. Those exact failures were added to the regression cases.
`latest.json` records the subsequent baseline/revised comparison: its selected
outputs retained the originals for those cases. That run also identified an
incorrect rejection of a faithful onboarding paraphrase. The reviewer was
updated to check equivalent meaning before declaring a detail missing;
`calibration.json` records the follow-up check of that adjustment.

These are deliberately small, authored calibration/regression examples, some
also represented in prompt guidance. They are not held-out evidence of broad
quality gains. Human preference fields remain unfilled. Real resume/job pairs,
blind preference review, and representative latency/cost measurements remain
necessary before claiming measured customer uplift. The implementation is
local; these checks do not deploy it.
