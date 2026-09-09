# Resume optimization harness

## Assessment

The current implementation has useful components but the optimize route owns
orchestration and the evaluation script reimplements it. Candidate history is
lost on selection; factual and writing decisions are collapsed into one status;
confirmed estimates become free-form text; user acceptance and restoration are
not recorded as decisions. These gaps make regressions difficult to diagnose.

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

- Calibrated per-claim review of refinement conversations, including corrections
  and accepted historical evidence; quality grading independent from grounding.
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
