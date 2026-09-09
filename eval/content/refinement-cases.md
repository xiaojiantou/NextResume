# Refinement grounding calibration cases

`refinement-cases.json` contains 14 independently authored cases: seven supported
and seven unsupported candidates. They use fictional work descriptions, with no
customer data. They are calibration and regression examples, not a held-out
quality benchmark or measured evidence of customer uplift.

The labels answer whether the candidate's claims are supported. A supported
candidate need not be the best rewrite. A stylistic improvement cannot make an
unsupported fact acceptable.

The cases cover:

- Reasonable qualitative purpose inferences in English and Chinese.
- Proposed plausible numbers that were never confirmed.
- Confirmed estimates with approximate wording, and estimates falsely described
  as measured outcomes.
- Latest corrections that override both prior instructions and stale saved
  evidence.
- Invented facts surviving in previous model outputs and the current draft.
- Requests for a senior tone that do not establish leadership or ownership.
- New measured evidence explicitly supplied in the latest user instruction.
- Token volume as workload scale, without inferring cost savings.
- Percentage points versus relative percentages, with the same evaluation set.

The structured estimate records were generated using `estimateImpact` and
validated using `normalizeConfirmedEstimates`. Their confirmation times are
fixed fixture values, not records of real user actions. All cases carry a
source ledger entry; where present, `user_confirmed` entries can still be
superseded by a later explicit correction.

Paired cases intentionally share evidence and differ in the disputed claim.
This helps distinguish a reviewer that checks provenance and meaning from one
that merely rejects all numbers or all inferences. A model run should report
false acceptance and false rejection separately, and preserve malformed or
unavailable judgments as a distinct result. Agreement with these labels does
not establish writing quality or broad factual reliability.
