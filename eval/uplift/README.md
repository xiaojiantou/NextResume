# Cross-role resume uplift corpus

`cases.json` contains 18 authored, fictional scenarios for evaluating whether the shared optimization harness produces clearer and more useful resume content. It contains source inputs only: no candidate rewrites, preferred winners, grading prompts, or expected model decisions.

Each case supplies a complete `HarnessInput` with one work role and two source bullets. Contact fields are empty, candidate and employer identities are invented, and there are no real applicants' records. The numeric outcomes are fictional source evidence for the exercise; they are not benchmark results.

## Coverage and split

| Role family | Development cases | Reserved validation cases |
| --- | ---: | ---: |
| Backend / AI engineering | 2 | 1 |
| Data / analytics | 2 | 1 |
| Product | 2 | 1 |
| Design / research | 2 | 1 |
| Operations | 2 | 1 |
| Marketing / customer success | 2 | 1 |
| Total | 12 | 6 |

The first six development cases cover all six families, followed by another six-family round. A small development run therefore need not be limited to technical roles. Every family has one measured, one qualitative, and one sparse scenario across the complete corpus. Each evidence level appears four times in development and twice in validation. The cases span entry, mid, and senior roles. Two development cases have Chinese source bullets and job responsibilities; the others are English.

The validation scenarios involve different work from their development counterparts. They are reserved until an explicit validation evaluation. Do not include them in default runs, use their outputs for prompt tuning, or silently replace cases that perform poorly. If validation results inform an implementation change, record that exposure and create a new reserved set before describing a later assessment as independent.

This is an **authored, reserved validation set**, not an untouched real-world held-out sample. Its limited size and shared authorship cannot establish general effectiveness, hiring outcomes, or population-level improvement. Chinese validation coverage and long, multi-role resumes are also absent.

## Reading the source inputs

- `sourceFacts` gives reviewers atomic paraphrases of information present in the source bullets. These facts do not add evidence, establish an expected rewrite, or prescribe a winner. The original resume remains the source of truth if a paraphrase is unclear.
- `evidenceLevel: "measured"` means at least one bullet supplies an outcome or comparison. Denominators, observation windows, cohort scope, and approximate wording matter. A metric in one bullet must not be attributed to a separate action merely because both appear in the same role.
- `evidenceLevel: "qualitative"` supplies a method, audience, use, or context without a measured outcome. A useful rewrite can make that contribution and a reasonable purpose clearer without inventing a result.
- `evidenceLevel: "sparse"` provides deliberately limited support. Asking for a concrete detail can be useful; assigning leadership, tools, scale, or numerical impact is not evidence of uplift.
- Job keywords come from the described work or the source skills; nice-to-have lists are empty. This isolates content improvement from an unrelated keyword-gap exercise.
- ATS report scores are neutral schema placeholders (`0`), not baseline measurements. Category arrays are empty and `missingKeywords` is always empty. Do not count these placeholder scores as evaluation results.

The source set includes both weak phrasing with useful facts and already direct, quantified content. Review should allow ties and a preference for retaining a strong source. Additional words, numerical density, and token volume are not automatic evidence of better content. For example, an AI workload's input/output token counts describe scope, while a comparable cost measurement describes efficiency; those meanings should stay distinct.

Assess candidate and source versions against the supplied facts and target role. Useful dimensions include contribution clarity, appropriate ownership, concrete method and scope, supported impact, readability, and role relevance. Keep preference judgments separate from unsupported-claim findings. This corpus is a starting point for a blinded review workflow, not a substitute for actual human preference data.

## Run and review

The default command validates the corpus and lists six development cases. It
never calls a model or touches the reserved validation split.

```sh
npm run eval:uplift
npm run eval:uplift -- --live --limit 6 --out eval/uplift/runs/my-run
npm run eval:uplift -- --from eval/uplift/runs/my-run/run.json --out eval/uplift/reviews/my-run
```

Use `--case <id>` for a targeted development regression. Selecting validation
requires `--split validation`; after it has informed a change, it is no longer
untouched validation for that change. Each run records the corpus hash, model,
Git revision and file hashes of the evaluated code. Existing runs and packets
are never overwritten by the CLI. A run can return a failure exit status while
still saving its completed comparisons and failure details.

Share only `review.html` with reviewers. It is an offline file with no external
assets or network calls. Keep `analysis-key.json` and `run.json` out of their
review materials. A/B positions are balanced and shuffled independently of case
order. Reviewer packets exclude model verdicts, generation traces and variant
labels. Known facts remain visible to support factual checking; this masks
provenance, not every possible linguistic clue about which version was rewritten.

Reviewers choose A, B, equally strong, or neither is ready, and can separately
flag factual concerns and explain their criteria. There are no initial votes;
identical versions require an explicit tie/neither choice. A reviewer code and
self-attestation are required for export. Codes distinguish submissions; they
are not identity verification. Drafts stay in the browser under that packet ID.
Partial exports are allowed and coverage stays incomplete until enough reviews
arrive.

```sh
npm run eval:uplift:summary -- \
  --packet eval/uplift/reviews/my-run/packet.json \
  --key eval/uplift/reviews/my-run/analysis-key.json \
  --out eval/uplift/reviews/my-run/human-summary.json \
  /path/to/reviewer-one.json /path/to/reviewer-two.json
```

The importer binds votes to the visible text and the private mapping using the
packet ID and a salted mapping commitment. It rejects duplicate reviewer codes,
unknown items, stale packets, missing attestation and directional preferences
for identical versions. To update a review, replace that person's previous
export rather than supplying both exports. Do not combine votes from different
packets or code versions.

By default, each comparison needs at least two reviewer codes before it receives
a consensus. A strict majority chooses a winner/tie/neither; otherwise it is
mixed. Reports include failed generation cases, coverage, factual concerns, and
breakdowns by role and evidence level. `decisiveCandidateWinRate` uses only
candidate/source consensus outcomes; `candidatePreferredShareOfCovered` also
includes ties, neither and mixed outcomes in its denominator. Both stay null
when their denominator is empty. One candidate win plus five ties is not a
100% preference share. No output automatically approves a release.

## First development findings

The initial six-case run completed five cases, retained two entire entries,
and failed one measured usability case. Three successful entries changed some
wording. This describes execution and textual change, not human-rated uplift.
The Chinese usability case repeatedly converted participant counts into
percentages, which the current numeric validator does not accept as source
figures. Both the initial failure and the unsuccessful prompt-only experiment
are retained under `runs/`.

A last-attempt source recovery was then added to the production harness: restore
only numerically invalid work/project bullets (and an invalid summary) from the
original, preserve locked text and other candidates, then run all normal factual,
semantic, content and final validators. This does not approve calculated
percentages or bypass factual review. The targeted live rerun completed with
`fallback`, preserving the source's sample size and participant counts while
retaining a reviewed rewrite of the other bullet. It is a separate code version
and must not be pooled into the initial run's completion or preference rate.

Current review materials:

- `reviews/development-first/review.html`: five completed comparisons from the
  initial six-case development run. Human summary remains pending (0 reviews).
- `runs/numeric-fallback-followup/review.html`: the targeted recovery follow-up,
  separately versioned, with its own packet and pending human summary.

The remaining six development cases and all six validation cases have not been
run. Next content-quality work should address weak scaffolding in dense measured
bullets without losing comparison conditions, and judge whether sparse-source
rewrites add useful clarity while preserving participation. Use blind preferences
and factual concerns to choose changes; a model's improved label is insufficient.
