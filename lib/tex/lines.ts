// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Maps edited source ranges onto the lines that display them, so the preview
// can show exactly which lines an export is going to rewrite.
import type { TexBlock } from "./blocks.ts";
import { escapeLatex, type TexEdit } from "./rewrite.ts";

/**
 * Line numbers are 0-based. A range that straddles a line break marks every
 * line it touches, since a LaTeX bullet is routinely wrapped across several.
 */
export function linesTouchedByEdits(
  source: string,
  blocks: readonly TexBlock[],
  edits: readonly TexEdit[],
): Set<number> {
  const lines = source.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  const touched = new Set<number>();
  for (const edit of edits) {
    const block = blocks[edit.blockIndex];
    if (!block) continue;
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index];
      const end = start + lines[index].length;
      // Ranges are half-open, so a block ending exactly at a line start does
      // not belong to that line.
      if (block.start <= end && block.end > start) touched.add(index);
    }
  }
  return touched;
}

/**
 * The "optimized" pane's own source view has to show what actually changed,
 * not the original again with a highlight — that reads as no change at all,
 * which is what the un-rewritten original bullets it shares with the
 * original pane look like side by side. Builds the edited text the same way
 * applyTexEdits does (sequentially, left to right, rather than splicing from
 * the end — the two produce identical output for non-overlapping block
 * ranges) while tracking where each edit's replacement landed, so the
 * touched lines are computed against the OUTPUT text's own line breaks
 * rather than the original's.
 */
export function buildEditedSourceWithTouchedLines(
  source: string,
  blocks: readonly TexBlock[],
  edits: readonly TexEdit[],
): { source: string; touchedLines: Set<number> } {
  // Mirrors applyTexEdits's own skip conditions, so the preview never shows
  // a substitution the real export would not actually make.
  const byStart = [...edits]
    .map((edit) => ({ edit, block: blocks[edit.blockIndex] }))
    .filter(
      (entry): entry is { edit: TexEdit; block: TexBlock } =>
        Boolean(entry.block) &&
        !entry.block.hasLink &&
        entry.block.text !== entry.edit.text,
    )
    .sort((a, b) => a.block.start - b.block.start);

  let output = "";
  let cursor = 0;
  const ranges: Array<{ start: number; end: number }> = [];
  for (const { edit, block } of byStart) {
    output += source.slice(cursor, block.start);
    const start = output.length;
    output += escapeLatex(edit.text);
    ranges.push({ start, end: output.length });
    cursor = block.end;
  }
  output += source.slice(cursor);

  const lines = output.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const touchedLines = new Set<number>();
  for (const range of ranges) {
    for (let index = 0; index < starts.length; index += 1) {
      const lineStart = starts[index];
      const lineEnd = lineStart + lines[index].length;
      if (range.start <= lineEnd && range.end > lineStart) {
        touchedLines.add(index);
      }
    }
  }
  return { source: output, touchedLines };
}
