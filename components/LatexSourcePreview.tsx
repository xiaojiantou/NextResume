// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

// Shows the user's own LaTeX source as the "original" pane.
//
// A .tex upload has no page images to show — rendering one would need a TeX
// distribution, which this deployment does not ship — and reconstructing the
// resume in our own styling would be actively misleading, since the whole
// point of this path is that we do not restyle anything. The source itself is
// the honest answer, and marking the lines that will be rewritten says
// exactly what the export is going to do.
import { useMemo } from "react";
import { parseTexBlocks } from "@/lib/tex/blocks";
import { planTexEdits } from "@/lib/tex/plan";
import { linesTouchedByEdits } from "@/lib/tex/lines";
import type { Optimization, Resume } from "@/lib/types";

type Line = {
  number: number;
  text: string;
  changing: boolean;
};

function buildLines(
  source: string,
  resume: Resume,
  optimization: Optimization | null,
  includeSummary: boolean,
): { lines: Line[]; changingCount: number } {
  const raw = source.split("\n");
  let changing = new Set<number>();

  if (optimization) {
    try {
      const blocks = parseTexBlocks(source);
      const plan = planTexEdits({
        resume,
        optimization,
        blocks,
        includeSummary,
      });
      changing = linesTouchedByEdits(source, blocks, plan.edits);
    } catch {
      // A source we cannot scan still deserves to be shown verbatim.
    }
  }

  return {
    lines: raw.map((text, index) => ({
      number: index + 1,
      text,
      changing: changing.has(index),
    })),
    changingCount: changing.size,
  };
}

export function LatexSourcePreview({
  source,
  resume,
  optimization,
  includeSummary = true,
}: {
  source: string;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
}) {
  const { lines, changingCount } = useMemo(
    () => buildLines(source, resume, optimization, includeSummary),
    [source, resume, optimization, includeSummary],
  );

  return (
    <div
      className="rounded-lg border border-ink-100 bg-ink-50 shadow-soft"
      role="region"
      aria-label="Original LaTeX source"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-3 py-2">
        <span className="text-[11px] text-ink-500">
          Your source, unmodified · {lines.length.toLocaleString()} lines
        </span>
        {optimization ? (
          <span className="text-[11px] text-ink-500">
            {changingCount > 0 ? (
              <>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-amber-300 align-middle" />
                {changingCount} {changingCount === 1 ? "line" : "lines"} will be
                rewritten
              </>
            ) : (
              "No lines change"
            )}
          </span>
        ) : null}
      </div>
      <div className="max-h-[46rem] overflow-auto rounded-b-lg bg-white">
        <pre className="min-w-full w-max text-[12px] leading-[1.6]">
          {lines.map((line) => (
            <div
              key={line.number}
              className={`flex ${line.changing ? "bg-amber-50" : ""}`}
            >
              <span
                aria-hidden
                className="sticky left-0 w-11 shrink-0 select-none border-r border-ink-100 bg-ink-50 px-2 text-right text-[11px] text-ink-300"
              >
                {line.number}
              </span>
              <code className="whitespace-pre px-3 font-mono text-ink-700">
                {line.text || " "}
              </code>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
