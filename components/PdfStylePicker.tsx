// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { cn } from "@/lib/cn";
import type { PdfStyle, PersonalizedStatus } from "@/lib/store";
import { Check, ChevronDown, FileText, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const STYLES: { id: PdfStyle; label: string; blurb: string }[] = [
  {
    id: "personalized",
    label: "Personalized",
    blurb: "AI-matched to your original resume's look",
  },
  {
    id: "classic",
    label: "Classic",
    blurb: "Traditional single column, serif type",
  },
  {
    id: "sidebar",
    label: "Sidebar",
    blurb: "Colored sidebar for photo & contact",
  },
  {
    id: "minimal",
    label: "Minimal",
    blurb: "Modern single column, tag-style labels",
  },
];

// Small CSS mockups — not real renders of the PDF, just enough visual
// structure (column layout / accent placement) to tell the 3 apart at a
// glance before committing to a real export.
function StyleThumb({ id }: { id: PdfStyle }) {
  if (id === "personalized") {
    return (
      <div className="w-14 h-[72px] rounded border border-accent-200 bg-gradient-to-br from-accent-50 to-accent-100 p-1.5 flex flex-col items-center justify-center gap-1 shrink-0">
        <Sparkles size={18} className="text-accent-600" />
        <div className="w-8 h-0.5 bg-accent-300 rounded-full" />
        <div className="w-6 h-0.5 bg-accent-300 rounded-full" />
      </div>
    );
  }
  if (id === "sidebar") {
    return (
      <div className="w-14 h-[72px] rounded border border-ink-200 bg-white overflow-hidden flex shrink-0">
        <div className="w-1/3 h-full bg-accent-600 flex items-start justify-center pt-2">
          <div className="w-3 h-3 rounded-full bg-white/70" />
        </div>
        <div className="flex-1 p-1.5 flex flex-col gap-1">
          <div className="w-7 h-1 bg-ink-800 rounded-full" />
          <div className="w-full h-0.5 bg-ink-200 rounded-full mt-1" />
          <div className="w-full h-0.5 bg-ink-200 rounded-full" />
          <div className="w-2/3 h-0.5 bg-ink-200 rounded-full" />
        </div>
      </div>
    );
  }
  if (id === "minimal") {
    return (
      <div className="w-14 h-[72px] rounded border border-ink-200 bg-white p-1.5 flex flex-col gap-1 shrink-0">
        <div className="w-8 h-1 bg-ink-800 rounded-full" />
        <div className="w-5 h-0.5 bg-accent-500 rounded-full" />
        <div className="w-5 h-1.5 bg-accent-600 rounded-sm mt-1" />
        <div className="w-full h-0.5 bg-ink-200 rounded-full mt-0.5" />
        <div className="w-3/4 h-0.5 bg-ink-200 rounded-full" />
      </div>
    );
  }
  // classic
  return (
    <div className="w-14 h-[72px] rounded border border-ink-200 bg-white p-1.5 flex flex-col items-center gap-1 shrink-0">
      <div className="w-8 h-1 bg-ink-800 rounded-full" />
      <div className="w-6 h-0.5 bg-accent-500 rounded-full" />
      <div className="w-full h-px bg-accent-500 mt-0.5" />
      <div className="w-full flex flex-col gap-0.5 mt-1">
        <div className="w-full h-0.5 bg-ink-200 rounded-full" />
        <div className="w-full h-0.5 bg-ink-200 rounded-full" />
        <div className="w-3/4 h-0.5 bg-ink-200 rounded-full" />
      </div>
    </div>
  );
}

export function PdfStylePicker({
  current,
  onPick,
  personalizedStatus,
}: {
  current: PdfStyle;
  onPick: (id: PdfStyle) => void;
  personalizedStatus?: PersonalizedStatus;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentInfo = STYLES.find((s) => s.id === current) ?? STYLES[0];
  const currentIsGenerating =
    current === "personalized" && personalizedStatus === "generating";

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
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1 text-sm transition hover:border-ink-300"
      >
        {currentIsGenerating ? (
          <Loader2 size={13} className="text-accent-600 animate-spin" />
        ) : (
          <FileText size={13} className="text-ink-500" />
        )}
        <span className="font-medium text-ink-900">
          {currentIsGenerating ? "Generating…" : currentInfo.label}
        </span>
        <ChevronDown
          size={13}
          className={cn("text-ink-400 transition", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-20 w-72 card p-1.5 shadow-pop">
          {STYLES.map((s) => {
            const selected = s.id === current;
            const isPersonalized = s.id === "personalized";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onPick(s.id);
                  setOpen(false);
                }}
                className={cn(
                  "w-full text-left px-2 py-2 rounded-md transition flex items-center gap-3",
                  selected ? "bg-ink-50" : "hover:bg-ink-50/60",
                )}
              >
                <StyleThumb id={s.id} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-900 flex items-center gap-1.5">
                    {s.label}
                    {isPersonalized && personalizedStatus === "generating" && (
                      <Loader2 size={12} className="text-accent-600 animate-spin" />
                    )}
                    {isPersonalized && personalizedStatus === "failed" && (
                      <AlertTriangle size={12} className="text-amber-600" />
                    )}
                  </div>
                  <div className="text-xs text-ink-500 mt-0.5">
                    {isPersonalized && personalizedStatus === "generating"
                      ? "Generating your layout — this can take a minute…"
                      : isPersonalized && personalizedStatus === "failed"
                        ? "Couldn't generate this time — try again, or pick another style"
                        : s.blurb}
                  </div>
                </div>
                {selected && (
                  <Check
                    size={14}
                    className="text-ink-900 shrink-0"
                    strokeWidth={3}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
