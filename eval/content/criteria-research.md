# Resume content criteria and estimated impact

Researched 2026-09-09. User direction: permit reasonable inference and use
explicit estimates or fill-in prompts to develop impact, rather than rejecting
all value that was not literally stated in the source.

## Evidence and criteria

| Criterion | What to look for | Source |
| --- | --- | --- |
| Impact | The result, benefit, or capability enabled by the work | [MIT PAR guidance](https://capd.mit.edu/resources/resumes-writing-about-your-skills/) |
| Contribution and scope | The candidate's specific action and responsibility | [Princeton accomplishment statements](https://careerdevelopment.princeton.edu/advanced-degree-resume-guide/accomplishment-statements) |
| Scale | People, data, workload, teams, or resources; quantitative or qualitative | [Princeton](https://careerdevelopment.princeton.edu/advanced-degree-resume-guide/accomplishment-statements) |
| Relevance and method | Evidence of skills the target employer values, expressed through actual work | [Harvard resume guide](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/) |
| Readability | Specific, active, concise wording and clear organization | [Harvard](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/) |
| Measurement | Useful metrics and defensible approximations; improve data collection over time | [MIT early-career guide](https://capd.mit.edu/blog/2023/09/01/enhance-your-resume-a-guide-for-first-year-undergraduates/) |

These sources support an accomplishment-oriented approach; they do not prescribe
our application's exact rubric, weights, or confirmation workflow. Those are
product decisions. Do not equate more numbers with a better resume.

## AI-specific metrics

Current [OpenAI inference performance roles](https://openai.com/careers/software-engineer-inference-performance-optimization-san-francisco/)
and [Anthropic inference systems roles](https://job-boards.greenhouse.io/anthropic/jobs/5224564008)
value performance, capacity, and efficient serving. [NVIDIA's metric definitions](https://docs.nvidia.com/nim/benchmarking/llm/latest/metrics.html)
distinguish TTFT, end-to-end latency, output token throughput, and request throughput.

Our resulting metric menu should depend on the actual role and source:
- LLM application work: adoption, completed tasks, evaluation success, cost per
  successful task, latency, and workload volume.
- Inference infrastructure: token throughput with concurrency/hardware conditions,
  TTFT or percentile latency, utilization, and cost at comparable quality.
- RAG/evaluation: retrieval/evaluation quality on a stated dataset and sample size,
  grounded-answer rate, latency, and task completion.
- Other roles: revenue/conversion when attributable, time saved, error/rework
  reduction, coverage, adoption, throughput, and users or teams served.

There is no verified evidence here of a universal hiring preference for resumes
with larger token counts. Monthly token volume describes scale, not value by
itself. Input/output tokens, served traffic/training corpus, system/per-user
throughput, time period, and workload should not be conflated. Lower token cost
at comparable quality can be more impressive than higher consumption.

## Product policy

1. Direct facts may enter the rewritten bullet.
2. Reasonable qualitative purpose/capability inference is allowed: a shared guide
   supports onboarding; a runbook supports incident response. Avoid upgrading
   participation into leadership or claiming a measured gain from a purpose.
3. When a useful metric is absent, propose it separately and ask for the inputs.
4. Calculate an explicitly approximate draft from supplied values, show its
   formula and assumptions, and let the user correct or confirm those inputs.
5. Only a confirmed estimate enters refinement evidence. The proposed wording
   must retain its approximate status and is accepted separately by the user.
6. Missing values stay blank; no industry-average or invented number is used as
   a candidate accomplishment. If no defensible estimate is available, keep a
   qualitative statement or a fill-in suggestion outside the export.

Example (illustrative inputs, not candidate facts): 1,000 requests/day ×
(800 input + 200 output tokens/request) × 20 active days gives approximately
20 million input + output tokens/month. A time-saving estimate might use
(60 − 15 minutes/task) × 40 tasks/month ÷ 60 = approximately 30 hours/month.
The calculator's arithmetic does not establish causality or verify the inputs.

Implementation: `lib/resumeImpact.ts` holds the criteria and deterministic
calculators; reviewer metadata can suggest at most two metrics; the refinement
panel collects and confirms inputs. These estimates never change resume text
merely by opening or filling the form.

The earlier `v2` exploratory runs tested a stricter policy and uncovered both
unsupported expansions and excessive retention. Preserve them as diagnostic
history, not evidence that the updated policy has been validated by those runs.

## Validation limits

A small live check of four candidate pairs accepted the guide/onboarding
inference, suggested monthly token scale for LLM work, and rejected a token
count that the source did not supply. The remaining paraphrase was accepted as
reasonable in the review's reasoning but retained for lack of a meaningful
writing gain; this differed from its preferred-output label. That is a style
judgment disagreement, and the recorded run is 3/4, not a perfect quality claim.
Automated arithmetic and browser tests verify the confirmation flow separately.
