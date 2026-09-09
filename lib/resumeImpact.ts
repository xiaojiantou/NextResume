// Copyright (c) 2026 HowBe LLC. All rights reserved.
// Research and sources: eval/content/criteria-research.md.
export const RESUME_IMPACT_GUIDANCE = `Assess achievement content using these criteria:
1. Outcome/value: explain what changed, who benefited, or what the work enabled. A reasonable qualitative purpose or capability inference is valid; it need not be quoted verbatim in the source.
2. Contribution: identify the candidate's actual action and responsibility without upgrading participation to leadership.
3. Method: name the relevant technical or operational approach, not a list of unrelated tools.
4. Scale: identify users, requests, documents, teams, data, or workload over a stated period.
5. Measurement: prefer a relevant baseline/comparison, period, and unit when known. Distinguish percentage points from relative percentages and measured results from estimates.
6. Relevance/readability: foreground the evidence the target employer values, with concise active wording.
For AI/LLM work, candidate metrics include monthly token volume (scale), token throughput (performance), latency/TTFT, cost per successful task, evaluation success, adoption, and reliability. Token consumption alone is not impact; fewer tokens at equal quality can be an improvement.
Do not require a metric in every bullet. If data is missing, recommend a metric to fill or estimate separately, rather than silently inserting a number in the deliverable.
Permitted impactMetrics identifiers (at most two relevant suggestions): hours_saved, monthly_tokens, cost_reduction, latency_reduction, quality_points. monthly_tokens is only appropriate when the SOURCE demonstrates LLM/token work, not merely because the job mentions AI. An already improved bullet can still have a useful metric suggestion.`;

export const IMPACT_METRICS = {
  hours_saved: {
    label: "Time saved per month",
    question: "How long did the task take before and after, and how often is it done?",
    formula: "(minutes before − minutes after) × runs per month ÷ 60",
    unit: "hours saved per month",
    inputs: [
      { id: "before", label: "Minutes per task before" },
      { id: "after", label: "Minutes per task after" },
      { id: "runs", label: "Runs per month" },
    ],
  },
  monthly_tokens: {
    label: "LLM workload scale",
    question: "How many requests run per day, with how many input and output tokens on average?",
    formula: "requests per day × (input + output tokens per request) × active days per month",
    unit: "input + output tokens per month",
    inputs: [
      { id: "requests", label: "Requests per day" },
      { id: "input", label: "Average input tokens per request" },
      { id: "output", label: "Average output tokens per request" },
      { id: "days", label: "Active days per month (1–31)" },
    ],
  },
  cost_reduction: {
    label: "Cost reduction",
    question: "What was the cost before and after for the same workload, currency, and period?",
    formula: "(cost before − cost after) ÷ cost before × 100",
    unit: "% cost reduction",
    inputs: [{ id: "before", label: "Cost before" }, { id: "after", label: "Cost after" }],
  },
  latency_reduction: {
    label: "Latency reduction",
    question: "What was the latency before and after using the same statistic, unit, and workload?",
    formula: "(latency before − latency after) ÷ latency before × 100",
    unit: "% latency reduction",
    inputs: [{ id: "before", label: "Latency before" }, { id: "after", label: "Latency after" }],
  },
  quality_points: {
    label: "Evaluation success improvement",
    question: "What were the before/after success percentages on the same evaluation set?",
    formula: "success percentage after − success percentage before",
    unit: "percentage-point improvement",
    inputs: [{ id: "before", label: "Success rate before (%)" }, { id: "after", label: "Success rate after (%)" }],
  },
} as const;
export type ImpactMetric = keyof typeof IMPACT_METRICS;

export function normalizeImpactMetrics(raw: unknown, source: string): ImpactMetric[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is ImpactMetric =>
    typeof id === "string" && Object.hasOwn(IMPACT_METRICS, id) &&
    (id !== "monthly_tokens" || /\b(?:LLMs?|tokens?|RAG|GPT|Claude|chatbots?)\b|language models?|语言模型/i.test(source)),
  ))].slice(0, 2);
}

export function estimateImpact(metric: ImpactMetric, inputs: Record<string, string>): {
  value: number; description: string; basis: string;
} | null {
  const definition = IMPACT_METRICS[metric];
  const values: Record<string, number> = {};
  for (const input of definition.inputs) {
    const raw = inputs[input.id]?.trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    values[input.id] = value;
  }
  let value: number;
  if (metric === "monthly_tokens") {
    if (values.days < 1 || values.days > 31 || !Number.isInteger(values.days)) return null;
    value = values.requests * (values.input + values.output) * values.days;
  } else if (metric === "hours_saved") {
    value = (values.before - values.after) * values.runs / 60;
  } else if (metric === "quality_points") {
    if (values.before > 100 || values.after > 100) return null;
    value = values.after - values.before;
  } else {
    if (values.before <= 0) return null;
    value = (values.before - values.after) / values.before * 100;
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  const display = Number(value.toPrecision(3)).toLocaleString("en-US", { maximumSignificantDigits: 3 });
  return {
    value,
    description: `Approximately ${display} ${definition.unit}`,
    basis: `${definition.formula}; ${definition.inputs.map(input => `${input.label}: ${values[input.id]}`).join("; ")}`,
  };
}
