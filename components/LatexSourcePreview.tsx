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
import {
  buildEditedSourceWithTouchedLines,
  linesTouchedByEdits,
} from "@/lib/tex/lines";
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
  mode: "original" | "edited",
): { lines: Line[]; changingCount: number; sourceText: string } {
  if (optimization) {
    try {
      const blocks = parseTexBlocks(source);
      const plan = planTexEdits({
        resume,
        optimization,
        blocks,
        includeSummary,
      });
      // "edited" is the optimized pane's own source view: showing the
      // original text again with a highlight reads as no change at all when
      // a bullet's rewrite happens to share long stretches of wording with
      // the source, which is exactly what made this look broken next to the
      // original pane showing the same unedited lines.
      if (mode === "edited") {
        const { source: edited, touchedLines } =
          buildEditedSourceWithTouchedLines(source, blocks, plan.edits);
        const rawEdited = edited.split("\n");
        return {
          lines: rawEdited.map((text, index) => ({
            number: index + 1,
            text,
            changing: touchedLines.has(index),
          })),
          changingCount: touchedLines.size,
          sourceText: edited,
        };
      }
      const changing = linesTouchedByEdits(source, blocks, plan.edits);
      const raw = source.split("\n");
      return {
        lines: raw.map((text, index) => ({
          number: index + 1,
          text,
          changing: changing.has(index),
        })),
        changingCount: changing.size,
        sourceText: source,
      };
    } catch {
      // A source we cannot scan still deserves to be shown verbatim.
    }
  }

  const raw = source.split("\n");
  return {
    lines: raw.map((text, index) => ({ number: index + 1, text, changing: false })),
    changingCount: 0,
    sourceText: source,
  };
}

export function LatexSourcePreview({
  source,
  resume,
  optimization,
  includeSummary = true,
  pageSize,
  mode = "original",
}: {
  source: string;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  /** Output paper size; when given, the pane takes the page's shape so it
   *  lines up with the PDF pane beside it instead of ending mid-column. */
  pageSize?: { widthPt: number; heightPt: number };
  /** "original" (default) shows the unmodified source with the lines an
   *  export would touch highlighted. "edited" shows the source AFTER those
   *  edits are applied — the optimized pane's own view, so it actually
   *  displays the new wording instead of showing the same unchanged text a
   *  second time. */
  mode?: "original" | "edited";
}) {
  const { lines, changingCount } = useMemo(
    () => buildLines(source, resume, optimization, includeSummary, mode),
    [source, resume, optimization, includeSummary, mode],
  );
  const edited = mode === "edited";

  return (
    <div
      className="flex flex-col rounded-lg border border-ink-100 bg-ink-50 shadow-soft"
      style={
        pageSize
          ? { aspectRatio: `${pageSize.widthPt} / ${pageSize.heightPt}` }
          : undefined
      }
      role="region"
      aria-label={edited ? "Rewritten LaTeX source" : "Original LaTeX source"}
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-3 py-2">
        <span className="text-[11px] text-ink-500">
          {edited ? "Your source, rewritten" : "Your source, unmodified"} ·{" "}
          {lines.length.toLocaleString()} lines
        </span>
        {optimization ? (
          <span className="text-[11px] text-ink-500">
            {changingCount > 0 ? (
              <>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-amber-300 align-middle" />
                {changingCount} {changingCount === 1 ? "line" : "lines"}{" "}
                {edited ? "were rewritten" : "will be rewritten"}
              </>
            ) : (
              "No lines change"
            )}
          </span>
        ) : null}
      </div>
      <div
        className={`overflow-auto rounded-b-lg bg-white ${
          pageSize ? "min-h-0 flex-1" : "max-h-[46rem]"
        }`}
      >
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
