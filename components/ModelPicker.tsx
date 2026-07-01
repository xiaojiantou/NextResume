"use client";

import { MODELS, findModel } from "@/lib/models";
import { cn } from "@/lib/cn";
import { Check, ChevronDown, Cpu, RefreshCw, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ModelPicker({
  current,
  onPick,
  onRegenerate,
  regenerating,
  compact = false,
}: {
  current: string;
  onPick: (id: string) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const model = findModel(current);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="flex items-center gap-2" ref={ref}>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white text-sm transition hover:border-ink-300",
            compact ? "px-2.5 py-1" : "px-3 py-1.5",
          )}
        >
          <Cpu size={13} className="text-ink-500" />
          <span className="font-medium text-ink-900">{model.name}</span>
          {model.badge && (
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-medium",
                model.badge === "Default" &&
                  "bg-ink-100 text-ink-600",
                model.badge === "Smart" &&
                  "bg-accent-100 text-accent-700",
                model.badge === "Fast" &&
                  "bg-amber-100 text-amber-700",
              )}
            >
              {model.badge}
            </span>
          )}
          <ChevronDown
            size={13}
            className={cn(
              "text-ink-400 transition",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1.5 z-20 w-80 card p-1.5 shadow-pop">
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-widest text-ink-400 font-medium">
              Choose model
            </div>
            {MODELS.map((m) => {
              const selected = m.id === current;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    onPick(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-2.5 py-2 rounded-md transition flex items-start gap-2.5",
                    selected ? "bg-ink-50" : "hover:bg-ink-50/60",
                  )}
                >
                  <div
                    className={cn(
                      "w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5",
                      m.speed === "fast" && "bg-amber-100 text-amber-700",
                      m.speed === "balanced" && "bg-ink-900 text-white",
                      m.speed === "deep" && "bg-accent-100 text-accent-700",
                    )}
                  >
                    {m.speed === "fast" ? (
                      <Zap size={13} />
                    ) : (
                      <Cpu size={13} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink-900">
                        {m.name}
                      </span>
                      {m.badge && (
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-medium",
                            m.badge === "Default" &&
                              "bg-ink-100 text-ink-600",
                            m.badge === "Smart" &&
                              "bg-accent-100 text-accent-700",
                            m.badge === "Fast" &&
                              "bg-amber-100 text-amber-700",
                          )}
                        >
                          {m.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      {m.tagline}
                    </div>
                  </div>
                  {selected && (
                    <Check
                      size={14}
                      className="text-ink-900 shrink-0 mt-1.5"
                      strokeWidth={3}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {onRegenerate && (
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className={cn(
            "btn btn-outline",
            compact && "!py-1 !px-2.5 text-xs",
          )}
        >
          <RefreshCw
            size={12}
            className={regenerating ? "animate-spin" : ""}
          />
          {regenerating ? "Regenerating…" : "Regenerate"}
        </button>
      )}
    </div>
  );
}
