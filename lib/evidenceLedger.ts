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
  removedEstimates?: ImpactMetric[];
};
export type EvidenceRecord = {
  kind: "source" | "user_confirmed" | "confirmed_estimate" | "instruction";
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
    : record.kind === "instruction" ? `User instruction (facts only when explicitly asserted; later corrections prevail): ${record.text}`
    : `User-confirmed facts: ${record.text}`).join("\n\n");
}

/** Replay only user-provided evidence, never a previous model draft. */
export function normalizePriorEvidence(raw: unknown): EvidenceRecord[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 40) throw new Error("Invalid evidence history.");
  return raw.flatMap(record => {
    if (!record || typeof record !== "object" || typeof record.text !== "string" || record.text.length > 6000) throw new Error("Invalid evidence history.");
    if (record.kind === "source") return []; // The current source anchor is supplied separately.
    if (record.kind === "confirmed_estimate") {
      const estimate = normalizeConfirmedEstimates([record.estimate])[0];
      return [{ kind: "confirmed_estimate" as const, text: estimate.description, confirmedAt: estimate.confirmedAt, estimate }];
    }
    if (!["user_confirmed", "instruction"].includes(record.kind) ||
        typeof record.confirmedAt !== "string" || !Number.isFinite(Date.parse(record.confirmedAt))) throw new Error("Invalid evidence history.");
    return [{ kind: record.kind, text: record.text, confirmedAt: record.confirmedAt } as EvidenceRecord];
  });
}

export function normalizeEstimateRetractions(raw: unknown): ImpactMetric[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 5 || raw.some(metric => typeof metric !== "string" || !Object.hasOwn(IMPACT_METRICS, metric))) throw new Error("Invalid removed estimates.");
  return [...new Set(raw)] as ImpactMetric[];
}

/** Preserve chronological corrections; repeated saved notes must not become new assertions. */
export function refinementEvidenceLedger({ source, prior, notes, estimates, removedEstimates = [], instructions, now }: {
  source: string; prior: EvidenceRecord[]; notes: string; estimates: ConfirmedEstimate[];
  instructions: string[]; now: string; removedEstimates?: ImpactMetric[];
}): EvidenceRecord[] {
  const ledger: EvidenceRecord[] = [{ kind: "source", text: source }, ...prior];
  const append = (record: EvidenceRecord) => {
    const comparable = ledger.filter(old => old.kind === record.kind &&
      (record.kind !== "confirmed_estimate" || old.estimate?.metric === record.estimate?.metric));
    const recent = record.kind === "instruction" ? comparable : comparable.slice(-1);
    const duplicate = recent.some(old => old.text === record.text &&
      (record.kind !== "confirmed_estimate" || (JSON.stringify(old.estimate?.inputs) === JSON.stringify(record.estimate?.inputs) &&
        Date.parse(old.estimate!.confirmedAt) === Date.parse(record.estimate!.confirmedAt))));
    if (!duplicate) ledger.push(record);
  };
  for (const instruction of instructions.slice(0, -1)) append({ kind: "instruction", text: instruction.trim(), confirmedAt: now });
  for (const record of buildEvidenceLedger(source, notes, estimates, now).slice(1)) append(record);
  for (const metric of removedEstimates) append({ kind: "instruction", text: `Remove the previous ${IMPACT_METRICS[metric].label.toLowerCase()} estimate; I no longer want to claim it.`, confirmedAt: now });
  const latest = instructions.at(-1)?.trim();
  if (latest) ledger.push({ kind: "instruction", text: latest, confirmedAt: now });
  // Never silently truncate away a correction or an estimate's provenance.
  if (ledger.length > 40) throw new Error("This bullet has too much evidence history. Start a new refinement with the facts you want to keep.");
  return ledger;
}
