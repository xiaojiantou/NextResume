"use client";

import { cn } from "@/lib/cn";
import type { ContentStructureMode } from "@/lib/types";
import {
  Check,
  ChevronDown,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const OPTIONS: Array<{
  id: ContentStructureMode;
  label: string;
  description: string;
}> = [
  {
    id: "optimize",
    label: "Optimize for role",
    description:
      "Tailor wording, section headings, and section order to emphasize the target role.",
  },
  {
    id: "preserve",
    label: "Keep original sections",
    description:
      "Keep detected headings and section order; shorten or omit lower-priority content to meet the page target.",
  },
];

export function ContentStructurePicker({
  current,
  onPick,
  variant = "compact",
  disabled = false,
}: {
  current: ContentStructureMode;
  onPick: (mode: ContentStructureMode) => void;
  variant?: "compact" | "cards";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentOption =
    OPTIONS.find((option) => option.id === current) ?? OPTIONS[0];

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (variant === "cards") {
    return (
      <fieldset>
        <legend className="text-sm font-medium text-ink-900">
          Content structure
        </legend>
        <p className="mt-1 text-xs leading-5 text-ink-500">
          Choose how the resume is organized. PDF Style controls colors,
          typography, and visual layout separately.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {OPTIONS.map((option) => {
            const selected = option.id === current;
            const Icon = option.id === "preserve" ? ShieldCheck : ListChecks;
            return (
              <label
                key={option.id}
                className={cn(
                  "flex min-h-24 cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition focus-within:ring-2 focus-within:ring-ink-900/10",
                  selected
                    ? "border-ink-900 bg-ink-50"
                    : "border-ink-200 bg-white hover:border-ink-300",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="content-structure"
                  value={option.id}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onPick(option.id)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    selected
                      ? "bg-ink-900 text-white"
                      : "bg-ink-100 text-ink-500",
                  )}
                >
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-sm font-medium text-ink-900">
                    {option.label}
                    {selected ? <Check size={14} strokeWidth={3} /> : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-ink-500">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1 text-sm transition hover:border-ink-300 focus:outline-none focus:ring-2 focus:ring-ink-900/10 disabled:cursor-not-allowed disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current === "preserve" ? (
          <ShieldCheck size={13} className="text-ink-500" />
        ) : (
          <ListChecks size={13} className="text-ink-500" />
        )}
        <span className="font-medium text-ink-900">{currentOption.label}</span>
        <ChevronDown
          size={13}
          className={cn("text-ink-400 transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-ink-100 bg-white p-1.5 shadow-pop">
          <div role="listbox" aria-label="Content structure">
            {OPTIONS.map((option) => {
              const selected = option.id === current;
              const Icon = option.id === "preserve" ? ShieldCheck : ListChecks;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onPick(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-h-16 w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition",
                    selected ? "bg-ink-50" : "hover:bg-ink-50/70",
                  )}
                >
                  <Icon size={16} className="mt-0.5 shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink-900">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 text-ink-500">
                      {option.description}
                    </span>
                  </span>
                  {selected ? (
                    <Check size={14} className="mt-0.5 text-ink-900" strokeWidth={3} />
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="mx-2 border-t border-ink-100 px-1 pt-2 pb-1 text-[11px] leading-4 text-ink-400">
            Visual design remains controlled by PDF Style.
          </p>
        </div>
      ) : null}
    </div>
  );
}
