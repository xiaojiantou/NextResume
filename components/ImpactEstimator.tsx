// Copyright (c) 2026 HowBe LLC. All rights reserved.
"use client";

import { useI18n } from "@/components/LanguageProvider";
import { useId, useState } from "react";
import type { ConfirmedEstimate } from "@/lib/evidenceLedger";
import { estimateImpact, IMPACT_METRICS, type ImpactMetric } from "@/lib/resumeImpact";

export function ImpactEstimator({ metric, onConfirm }: {
  metric: ImpactMetric;
  onConfirm: (estimate: ConfirmedEstimate) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const definition = IMPACT_METRICS[metric];
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState(false);
  const estimate = estimateImpact(metric, inputs);
  const updateInput = (key: string, value: string) => {
    setInputs(previous => ({ ...previous, [key]: value }));
    setConfirmed(false);
    setSaved(false);
  };
  return (
    <details className="mt-3 rounded-md border border-ink-200 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-ink-800">{t("Estimate impact:")}{" "}{t(definition.label)}</summary>
      <p className="mt-2 text-ink-600">{t(definition.question)}</p>
      {"guidance" in definition && <p className="mt-1 text-ink-600">{t(definition.guidance)}</p>}
      <p className="mt-1 text-ink-500">{t("Fill in known values or defensible approximations. Blank fields stay unknown. This calculation is a draft until you confirm it.")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {definition.inputs.map(input => (
          <label key={input.id} htmlFor={`${id}-${input.id}`} className="text-ink-700">
            {t(input.label)}
            {"options" in input ? (
              <select id={`${id}-${input.id}`} value={inputs[input.id] ?? ""}
                onChange={event => updateInput(input.id, event.target.value)}
                className="mt-1 block w-full rounded-md border border-ink-200 bg-white p-2 focus:outline-none focus:ring-2 focus:ring-accent-100">
                <option value="">{t("Choose what you counted")}</option>
                {input.options.map(option => <option key={option} value={option}>{t(option)}</option>)}
              </select>
            ) : (
              <input id={`${id}-${input.id}`} type="number" min="0" step="any" value={inputs[input.id] ?? ""}
                onChange={event => updateInput(input.id, event.target.value)}
                className="mt-1 block w-full rounded-md border border-ink-200 bg-white p-2 focus:outline-none focus:ring-2 focus:ring-accent-100" />
            )}
          </label>
        ))}
      </div>
      <p className="mt-2 text-ink-500">{t("Calculation:")}{" "}{t(definition.formula)}</p>
      <p className="mt-2 font-medium text-ink-900" aria-live="polite">
        {t(estimate ? `Draft estimate: ${estimate.description}` : "Enter comparable values to calculate an estimate. No improvement is assumed.")}
      </p>
      {estimate && (
        <>
          <label className="mt-3 flex items-start gap-2 text-ink-700">
            <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
            {t("I confirm these inputs describe my work and use a comparable scope, period, and measurement. Keep the result labeled approximate.")}</label>
          <button type="button" disabled={!confirmed || saved}
            onClick={() => {
              onConfirm({ metric, inputs: { ...inputs }, ...estimate, confirmedAt: new Date().toISOString() });
              setSaved(true);
            }}
            className="btn btn-primary mt-3 !px-3 !py-1.5 text-xs disabled:opacity-40">
            {t(saved ? "Added to your saved evidence" : "Use confirmed estimate")}
          </button>
          <p className="mt-1 text-ink-500">{t("Then choose Rewrite and review the proposed bullet before accepting it.")}</p>
        </>
      )}
    </details>
  );
}
