// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { Check, ChevronDown, Files } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  normalizeTargetPages,
  type TargetPages,
} from "@/lib/pdf/config";

function targetLabel(target: TargetPages) {
  if (target === "auto") return "Auto length";
  return `${target} ${target === 1 ? "page" : "pages"}`;
}

export function TargetPagesPicker({
  current,
  recommended,
  onPick,
}: {
  current: TargetPages;
  recommended?: number;
  onPick: (target: TargetPages) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customValue, setCustomValue] = useState(
    current === "auto" ? 4 : current,
  );
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (current !== "auto" && current > 3) setCustomValue(current);
  }, [current]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const applyCustom = () => {
    const normalized = normalizeTargetPages(customValue);
    onPick(normalized === "auto" ? 4 : normalized);
    setOpen(false);
  };

  const quickOptions: TargetPages[] = ["auto", 1, 2, 3];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1 text-sm transition hover:border-ink-300 focus:outline-none focus:ring-2 focus:ring-ink-900/10"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Files size={13} className="text-ink-500" />
        <span className="font-medium text-ink-900">
          {targetLabel(current)}
        </span>
        <ChevronDown
          size={13}
          className={cn("text-ink-400 transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-64 card p-1.5 shadow-pop">
          <div role="listbox" aria-label="Target resume length">
            {quickOptions.map((option) => {
              const selected = current === option;
              return (
                <button
                  key={String(option)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onPick(option);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center rounded-md px-2.5 py-2 text-left text-sm transition",
                    selected ? "bg-ink-50" : "hover:bg-ink-50/70",
                  )}
                >
                  <span className="flex-1 font-medium text-ink-800">
                    {targetLabel(option)}
                  </span>
                  {option === recommended ? (
                    <span className="mr-2 rounded bg-accent-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-700">
                      Recommended
                    </span>
                  ) : null}
                  {selected ? (
                    <Check size={13} className="text-ink-900" strokeWidth={3} />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mx-1 my-1.5 h-px bg-ink-100" />
          <label className="block px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
            Custom target
          </label>
          <div className="flex items-center gap-2 px-2 pb-2">
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={customValue}
              onChange={(event) =>
                setCustomValue(
                  Math.min(10, Math.max(1, Number(event.target.value) || 1)),
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") applyCustom();
              }}
              className="min-h-10 w-20 rounded-md border border-ink-200 px-2.5 text-sm tabular-nums outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/10"
              aria-label="Custom target page count"
            />
            <span className="text-xs text-ink-500">pages, 1–10</span>
            <button
              type="button"
              onClick={applyCustom}
              className="ml-auto min-h-10 rounded-md bg-ink-900 px-3 text-xs font-medium text-white transition hover:bg-ink-800"
            >
              Apply
            </button>
          </div>
          <p className="px-2 pb-1 text-[11px] leading-4 text-ink-400">
            Exact after Fit. Auto keeps the complete resume at its natural
            length.
          </p>
        </div>
      ) : null}
    </div>
  );
}
