# Resume optimization harness

## Assessment

Before the first delivery, the implementation had useful components but the optimize route owned
orchestration and the evaluation script reimplemented it. Candidate history was
lost on selection; factual and writing decisions were collapsed into one status;
confirmed estimates became free-form text; user acceptance and restoration were
not recorded as decisions. These gaps made regressions difficult to diagnose.

## First delivery

1. Extract the existing production optimization loop into a framework-independent
   runner with injected model and semantic-review adapters. Keep entitlement and
   request validation in the HTTP route.
2. Return a versioned trace with actual model-call timing, attempts, per-bullet
   original/candidate history, review decisions, and selected candidate. Separate
   factual audit flags from improvement dimensions; reasonable inference remains
   allowed. Record unavailable reviews explicitly.
3. Persist confirmed estimates as structured evidence (metric, inputs, formula,
   confirmation time). Recompute estimates server-side before prompt inclusion;
   drafts and model-suggested numbers are not evidence. Preserve compatibility
   with existing free-form answers and optimized resumes.
4. Record acceptance, manual edits, and restoration for comparison bullets.
5. Evaluate the production runner directly with deterministic regression cases
   and optional live completions. Compare model behavior separately from harness
   correctness; no synthetic output is presented as human preference data.

Acceptance criteria: current tests still pass; rejected sibling retries cannot
erase approved text; outages produce a trace explaining fallback; user-locked
text remains unchanged; estimates cannot be promoted without confirmation;
formula tampering is rejected; user actions are bound to the exact text; offline
and online optimization use the same orchestration function.

## Follow-up milestones

- Expand calibration of per-claim refinement review beyond the first authored
  corpus; quality grading remains independent from grounding.
- Richer evidence questions and alternative framing at entry/document level.
- A consented real-resume/job corpus, blind human preferences, and configurable
  release gates for quality, latency, and provider cost.

No automatic deployment, prompt promotion, or background model experimentation
is part of this delivery. Trace storage follows the existing resume persistence;
no new third-party analytics destination is added.

## Delivered validation and next priorities

- `npm run eval:harness` exercises four deterministic scenarios through the
  same runner used by the optimize API, including the shared semantic reviewer.
- `npm run eval:harness -- --live` runs an authored one-bullet smoke case using
  the configured Novita model. It writes a separate live artifact and records
  provider-reported token usage. This is not a quality benchmark.
- The first live smoke completed in 10.2 seconds with four calls. Its selected
  rewrite clarified the purpose of API tests without inventing a measured
  result. Review labels are model judgments, not human preference scores.
- Traces contain model-call timing and validation results; production token
  usage/currency accounting remains a follow-up. Decision histories persist
  with accepted bullets; a trace inspection UI is also a follow-up.
- Confirmation means the user attested to the supplied inputs; recomputation
  verifies arithmetic, not whether their real-world inputs are accurate.

Next implementation order: (1) independently review refinement outputs against
the original plus confirmed evidence, including estimate qualifiers and user
corrections; (2) expand a held-out corpus across roles and evidence availability,
with blind human preferences; (3) use those results to decide whether additional
framing candidates improve quality enough to justify latency/cost. Do not add
more model rounds solely because the harness can run them.

## Second delivery: independent refinement review

The single-bullet API now runs generation and a separate factual review through
`runRefinementHarness`. The reviewer sees ordered user evidence; current and past
model drafts are context only. Each approved claim must quote an exact span and
cite known evidence IDs, and all words in the candidate must be covered. This
review does not claim the writing is better; writing preference needs separate
evaluation.

The runner uses a 25-second generation deadline and 14-second review deadline
inside the route's 45-second limit. A malformed, incomplete, unavailable, or
rejected review returns no bullet for acceptance. The current text stays in
place. No extra repair call is added in this delivery.

Confirmed estimate results, free-form facts, and user instructions persist as
distinct records. Reopening a refinement replays this evidence without promoting
a previous model draft. Later corrections take precedence. Repeated unchanged
notes do not undo corrections, and deliberate changes back to an earlier value
remain newest. Removing an estimate persists a retraction until reconfirmed.

The review parser also checks numeric claims against their cited evidence using
the shared numeric validator. Chinese 万/亿 magnitudes and percent spacing are
normalized. Calculation inputs are excluded as output achievements. Estimate
clauses must retain approximate wording. Numeric checks help catch missing
values and percent/percentage-point confusion; semantic unit, ownership and
causality judgments still rely on the model and may be wrong.

Validation commands and scope:

- `npm test`: deterministic runner, API, parser, provenance, timeout and correction
  regression tests alongside the existing suite.
- `npm run test:content-ui`: mocked browser test for rejected rewrites preserving
  current text, accepted evidence replay, removal corrections and mobile layout.
- `npm run eval:refinement`: validates 14 authored bilingual calibration cases.
- `npm run eval:refinement -- --live`: calls the production reviewer. The initial
  DeepSeek V3.2 run agreed on 12/14 cases and falsely accepted two: invented 40%
  cost savings from token volume, and 15 percentage points written as 15%.
  The original judgments are retained in `refinement-calibration-initial.json`.
- `npm run eval:refinement -- --replay`: reparses those saved judgments through
  the strengthened numeric checks, with no new model calls. All 14 now match the
  authored labels; this is regression replay, not fresh blind evaluation.
- `npm run eval:refinement -- --live --smoke`: exercises generation and review
  together. The authored runbook example completed in about 8.2 seconds.

Next: collect broader examples across role levels and evidence completeness,
reserve a held-out split, and obtain blind human preferences on actual content
uplift. The current authored set is factual calibration and must not be used to
claim a customer quality improvement rate. Production token accounting, cost
gates and a trace viewer remain open.

## Third delivery: cross-role uplift comparisons and human review

`eval/uplift` now contains 18 fictional cases across six role families and three
evidence levels, split into 12 development and six reserved validation cases.
The evaluator uses the production optimization runner and saves completed and
failed attempts, exact outputs, model-call usage, latency and code/corpus hashes.
Six development cases were evaluated; validation remains unused.

The standalone offline review page compares full experience bullet lists under
masked A/B labels. Side assignment is balanced and independently randomized;
model judgments are omitted. Human exports require explicit choices and
attestation, and aggregation verifies text/mapping commitments, duplicate codes,
coverage and separate factual concerns. No human preference is fabricated from
model output. With zero human exports, uplift metrics remain null.

The first run completed 5/6 and left two complete entries unchanged. A measured
sample-count example exposed a numeric rewrite loop; extra prompt guidance did
not resolve it. The production fix restores only numerically invalid source
text after the last retry and then runs every normal validator. The separate
live regression completed as a fallback, preserving the measurement and the
other reviewed bullet. This is recovery evidence, not measured writing uplift.

See `eval/uplift/README.md` for commands, artifacts, denominators, review protocol
and the next content-quality hypotheses. Production cost gates, consented real
resume examples, blind human judgments and broader validation remain open.

## Fourth delivery: rubric-aware acceptance and an honest projection

Replaying the seven completed uplift traces through the deterministic ATS
rubric showed why customers saw little difference before and after: 9 of 14
bullets shipped as source text. The content reviewer is instructed to ignore
verb strength and keyword counts, so a rewrite whose only change was removing
responsibility scaffolding or naming the posting's term came back "retain" as
cosmetic, while "Action verbs" and "Keyword match" are exactly those changes.
The pre-purchase projection compounded this: it promised a 30% close on
"Quantified impact", which the rewrite prompt forbids, and 90 on verbs for
bullets the scorer could not classify. On the corpus it overshot the re-scored
result by 9.9 points.

Three changes, all deterministic and covered by tests:

1. `lib/bulletAtsGain.ts` accepts a reviewer-retained rewrite only when the
   reviewer's own audit flags (supported, details preserved, causality
   preserved) are all true and the rewrite measurably moves the rubric: a
   stronger opener that is not an ownership verb the source never used, or a
   posting keyword the source lacked (aliases such as K8s/Kubernetes do not
   count). The reviewer's evidence question survives; its revision instruction
   does not. Replayed on the corpus, 2 of the 5 retained-but-audited candidates
   would now ship, both result-first restructures of a "responsible for" bullet.
2. `lib/atsProjection.ts` replaces the inline formula: quantified impact is not
   projected to rise, verbs cap at 85 and only for bullets the scorer can
   classify, the total never drops below the source, and the UI calls the
   number "up to". Preserve mode now sets the headline to the posting's title
   like optimize mode, since "Title match" is 20 points of any projection.
3. `openerStrength` in `lib/atsScore.ts` classifies Chinese openers: "负责",
   "参与", "协助" score weak like "helped"; a listed action verb scores strong;
   anything else stays neutral. Before this every Chinese bullet was neutral, so
   the category could neither penalise scaffolding nor reward its removal.

After all three, the projection overshoots the re-scored corpus by 6.3 points
instead of 9.9. The remainder is the headline, which the bullet-only evaluator
does not emit, and English rewrites whose openers the reviewer's retained
version left unchanged. These are rubric measurements on an authored corpus,
not evidence of customer-perceived quality. Open: the keyword close rate (40%
of the gap) is uncalibrated and needs real before/after pairs; rewrites that
derive a number the source lacks still restore the whole bullet after retries;
the Chinese verb list is closed and will miss verbs.

## Dense measured task follow-up

The prompt-only experiment in `eval/uplift/runs/dense-measurement-followup`
still retained the weak AI-engineering source after three generation rounds.
Numeric retries introduced a derived 25% saving; the later rewrite generalized
input-token processing cost into inference cost. Merely preserving the figures
did not preserve the measurement's meaning.

The runner now offers a source edit on an existing retry after that bullet's
numeric check fails or its quality review requests revision. For a small set of
explicit past tasks, it changes only the responsibility prefix and leading verb,
preserving the entire remaining source verbatim. Ambiguous tense, plans,
assistance, negation and coordinated gerunds stay with ordinary generation.
Locked and approved bullets are excluded. A proposal still runs through all
normal validators and review; a sibling's validation failure cannot consume its
review opportunity. There are still at most three generation attempts and one
quality revision per bullet. Pipeline version 8 invalidates older saved results.

The separate live regression in `eval/uplift/runs/source-task-followup` completed
in 39.1 seconds with two generation rounds and five model calls. Its first model
candidate again introduced 25%; the second round selected a `source_edit`:

> Added prompt caching to an internal LLM assistant; measured input-token processing cost fell from $12 to $9 per 1,000 requests in a replay of the same request set, with the model and cache-hit mix held fixed.

Every character after the leading task verb matches the source. The factual
audit passed, but the writing reviewer chose retain; the existing ATS rule
selected it for its clearer action opener. This is not independent reviewer
endorsement or evidence of human preference. The other bullet preserves its
separate approximate monthly input/output quantities. Human reviews remain zero;
no latency improvement or general uplift rate is claimed from these two runs.

New review records now preserve the raw `reviewerDecision` separately from
`selectionBasis` (`quality_review`, `ats_rubric`, or `source`). Invalid reviews
invent neither field. This metadata does not change selection behavior. The
saved live run predates these fields; its reason records the ATS override and
the original artifact has not been rewritten.

The eight fictional dense-measurement calibration pairs agreed with all authored
labels in `eval/content/source-task-followup/calibration.json`, including lost
comparison conditions, dropped denominators, estimate qualification, token
category swaps and preparatory work. These are development calibration, not
reserved validation. The six reserved validation cases remain unused.

Deterministic regression tests cover exact evidence-tail preservation, unsafe
grammar skips, numeric retries, failed/unavailable factual review, locks,
approved siblings, and proposals surviving an unrelated validation failure.
Further content work should target richer framing from supported qualitative
facts and sparse evidence questions; replacing this particular weak opener is a
bounded clarity improvement, not new impact evidence.

Validation for this follow-up: 332 automated tests and `tsc --noEmit` passed.
