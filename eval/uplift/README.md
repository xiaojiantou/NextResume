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
