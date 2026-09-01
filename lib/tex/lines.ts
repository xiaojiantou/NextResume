// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Maps edited source ranges onto the lines that display them, so the preview
// can show exactly which lines an export is going to rewrite.
import type { TexBlock } from "./blocks.ts";
import type { TexEdit } from "./rewrite.ts";

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
