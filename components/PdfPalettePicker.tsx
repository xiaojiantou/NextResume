// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { Check, ChevronDown, Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import {
  getPdfStyleDefinition,
  getResumePalette,
  type FixedPdfStyle,
} from "@/lib/pdf/config";

export function PdfPalettePicker({
  style,
  current,
  onPick,
}: {
  style: FixedPdfStyle;
  current: string;
  onPick: (paletteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const palettes = getPdfStyleDefinition(style).palettes;
  const selected = getResumePalette(style, current);

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-ink-200 bg-white px-2.5 py-1 text-sm transition hover:border-ink-300 focus:outline-none focus:ring-2 focus:ring-ink-900/10"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Palette size={13} className="text-ink-500" />
        <span
          className="h-3 w-3 rounded-full border border-black/10"
          style={{ backgroundColor: selected.accent }}
        />
        <span className="font-medium text-ink-900">{selected.label}</span>
        <ChevronDown
          size={13}
          className={cn("text-ink-400 transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={`${getPdfStyleDefinition(style).label} color palette`}
          className="absolute right-0 top-full z-30 mt-1.5 w-52 card p-1.5 shadow-pop"
        >
          {palettes.map((candidate) => {
            const isSelected = candidate.id === selected.id;
            return (
              <button
                key={candidate.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onPick(candidate.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition",
                  isSelected ? "bg-ink-50" : "hover:bg-ink-50/70",
                )}
              >
                <span
                  className="h-4 w-4 rounded-full border border-black/10"
                  style={{ backgroundColor: candidate.accent }}
                />
                <span className="flex-1 font-medium text-ink-800">
                  {candidate.label}
                </span>
                {isSelected ? (
                  <Check size={13} className="text-ink-900" strokeWidth={3} />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
