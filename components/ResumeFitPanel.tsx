"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  EyeOff,
  Lock,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type {
  FitConflict,
  ResumeFitVariant,
} from "@/lib/resumeFit";

export const FIT_PROGRESS_STAGES = [
  "Measuring layout",
  "Adjusting spacing",
  "Prioritizing content",
  "Rewriting with evidence",
  "Verifying exact page count",
  "Recalculating ATS",
] as const;

export type FitProgressStage = (typeof FIT_PROGRESS_STAGES)[number];

export function ResumeFitPanel({
  fitting,
  stage,
  variant,
  conflict,
  error,
  outdated,
  onFit,
  onCancel,
  onKeep,
}: {
  fitting: boolean;
  stage: FitProgressStage | null;
  variant: ResumeFitVariant | null;
  conflict: FitConflict | null;
  error: string | null;
  outdated: boolean;
  onFit: () => void;
  onCancel: () => void;
  onKeep: (contentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const groups = useMemo(() => {
    if (!variant) return [];
    return [
      {
        label: "Shortened",
        kind: "shortened",
        items: variant.changes.filter((change) => change.kind === "shortened"),
      },
      {
        label: "Expanded",
        kind: "expanded",
        items: variant.changes.filter((change) => change.kind === "expanded"),
      },
      {
        label: "Hidden",
        kind: "hidden",
        items: variant.changes.filter((change) => change.kind === "hidden"),
      },
      {
        label: "Collapsed",
        kind: "collapsed",
        items: variant.changes.filter((change) => change.kind === "collapsed"),
      },
    ].filter((group) => group.items.length > 0);
  }, [variant]);

  if (fitting) {
    const activeIndex = stage ? FIT_PROGRESS_STAGES.indexOf(stage) : 0;
    return (
      <section
        aria-live="polite"
        aria-label="Resume page fitting progress"
        className="mt-4 rounded-xl border border-accent-200 bg-accent-50/40 p-4"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-600 text-white">
            <Sparkles size={16} className="animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-ink-900">
              Fitting the latest resume…
            </div>
            <p className="mt-0.5 text-sm text-ink-500">
              Layout and content are being verified against the exact page
              target.
            </p>
            <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {FIT_PROGRESS_STAGES.map((item, index) => {
                const complete = index < activeIndex;
                const active = index === activeIndex;
                return (
                  <li
                    key={item}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs",
                      complete
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : active
                          ? "border-accent-300 bg-white text-ink-900"
                          : "border-ink-100 bg-white/60 text-ink-400",
                    )}
                  >
                    {complete ? (
                      <Check size={13} strokeWidth={3} />
                    ) : (
                      <Circle
                        size={12}
                        className={active ? "fill-accent-500 text-accent-500" : ""}
                      />
                    )}
                    {item}
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-outline mt-4 min-h-11 bg-white"
            >
              Cancel fit
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (conflict) {
    return (
      <section
        role="alert"
        className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-amber-700"
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-amber-950">
              Exact page fit needs your input
            </div>
            <p className="mt-1 text-sm text-amber-900">{conflict.message}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {conflict.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-amber-700">
              Feasible range observed: {conflict.recommendedRange.min}–
              {conflict.recommendedRange.max} pages.
            </p>
            <button
              type="button"
              onClick={onFit}
              className="btn btn-outline mt-3 min-h-11 bg-white"
            >
              <RotateCcw size={14} /> Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        role="alert"
        className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 p-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-rose-700"
          />
          <div>
            <div className="font-medium text-rose-950">Page fit failed</div>
            <p className="mt-1 text-sm text-rose-800">{error}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onFit}
          className="btn btn-outline min-h-11 shrink-0 bg-white"
        >
          Retry
        </button>
      </section>
    );
  }

  if (outdated && !variant) {
    return (
      <section
        role="status"
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"
      >
        <div className="flex items-start gap-3">
          <RotateCcw
            size={17}
            className="mt-0.5 shrink-0 text-amber-700"
          />
          <div>
            <div className="font-medium text-amber-950">
              Resume content changed
            </div>
            <p className="mt-0.5 text-sm text-amber-800">
              Refit is required so the downloadable PDF includes your latest
              edits.
            </p>
          </div>
        </div>
        <button type="button" onClick={onFit} className="btn btn-primary min-h-11">
          Refit latest resume
        </button>
      </section>
    );
  }

  if (!variant) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-emerald-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition hover:bg-emerald-50/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-600/20"
        aria-expanded={expanded}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <Check size={15} strokeWidth={3} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink-900">
            Exactly {variant.actualPages}{" "}
            {variant.actualPages === 1 ? "page" : "pages"}
          </span>
          <span className="block text-xs text-ink-500">
            ATS {variant.atsScore} · {variant.density} density ·{" "}
            {variant.changes.length} page-fit changes
          </span>
        </span>
        {expanded ? (
          <ChevronUp size={16} className="text-ink-400" />
        ) : (
          <ChevronDown size={16} className="text-ink-400" />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-ink-100 p-4">
          {groups.length === 0 ? (
            <p className="text-sm text-ink-500">
              The complete optimized content already fits this target. Only
              layout density changed.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {groups.map((group) => (
                <div key={group.kind}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
                    {group.kind === "hidden" || group.kind === "collapsed" ? (
                      <EyeOff size={13} />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    {group.label}
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                      {group.items.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {group.items.map((change) => (
                      <div
                        key={change.id}
                        className="rounded-lg border border-ink-100 bg-ink-50/60 p-3"
                      >
                        <div className="text-sm font-medium text-ink-800">
                          {change.label}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">
                          {change.reason}
                        </p>
                        {(change.kind === "hidden" ||
                          change.kind === "collapsed") && (
                          <button
                            type="button"
                            onClick={() => onKeep(change.targetId)}
                            className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3 text-xs font-medium text-ink-700 transition hover:border-ink-300 hover:text-ink-900"
                          >
                            <Lock size={12} /> Keep on next fit
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
