// Copyright (c) 2026 HowBe LLC. All rights reserved.
import { estimateImpact, IMPACT_METRICS, type ImpactMetric } from "./resumeImpact.ts";

export type ConfirmedEstimate = {
  metric: ImpactMetric;
  inputs: Record<string, string>;
  description: string;
  basis: string;
  value: number;
  confirmedAt: string;
};
export type EvidenceAnswer = {
  question: string;
  answer: string;
  sourceText?: string;
  estimates?: ConfirmedEstimate[];
};
export type EvidenceRecord = {
  kind: "source" | "user_confirmed" | "confirmed_estimate";
  text: string;
  confirmedAt?: string;
  estimate?: ConfirmedEstimate;
};

/** Never trust a submitted result or formula. Recompute from confirmed inputs. */
export function normalizeConfirmedEstimates(raw: unknown): ConfirmedEstimate[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 5) throw new Error("Invalid confirmed estimates.");
  const seen = new Set<string>();
  return raw.map(item => {
    if (!item || typeof item !== "object" || typeof item.metric !== "string" || !Object.hasOwn(IMPACT_METRICS, item.metric) || seen.has(item.metric)) throw new Error("Invalid estimate metric.");
    seen.add(item.metric);
    const metric = item.metric as ImpactMetric;
    if (!item.inputs || typeof item.inputs !== "object" ||
        !IMPACT_METRICS[metric].inputs.every(input => typeof item.inputs[input.id] === "string") ||
        typeof item.confirmedAt !== "string" || !Number.isFinite(Date.parse(item.confirmedAt))) throw new Error("Confirm the estimate inputs before using them.");
    const inputs = Object.fromEntries(IMPACT_METRICS[metric].inputs.map(input => [input.id, item.inputs[input.id] as string]));
    const estimate = estimateImpact(metric, inputs);
    if (!estimate) throw new Error("Estimate inputs must be valid and comparable.");
    if (item.value !== estimate.value || item.description !== estimate.description || item.basis !== estimate.basis) throw new Error("The estimate no longer matches its confirmed inputs. Recalculate and confirm it.");
    return { metric, inputs, ...estimate, confirmedAt: new Date(item.confirmedAt).toISOString() };
  });
}

export function buildEvidenceLedger(source: string, notes: string, estimates: ConfirmedEstimate[], now: string): EvidenceRecord[] {
  return [
    { kind: "source", text: source },
    ...(notes.trim() ? [{ kind: "user_confirmed" as const, text: notes.trim(), confirmedAt: now }] : []),
    ...estimates.map(estimate => ({ kind: "confirmed_estimate" as const, text: estimate.description, estimate, confirmedAt: estimate.confirmedAt })),
  ];
}

export function confirmedEvidenceText(ledger: EvidenceRecord[]): string {
  return ledger.filter(record => record.kind !== "source").map(record => record.kind === "confirmed_estimate"
    ? `User-confirmed ESTIMATE (retain approximate wording): ${record.text}. Calculation: ${record.estimate!.basis}`
    : `User-confirmed facts: ${record.text}`).join("\n\n");
}
