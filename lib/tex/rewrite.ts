// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Splices new wording into a LaTeX source without touching anything else.
// The preamble, custom macros, spacing, and every line we did not rewrite
// stay byte-identical, which is what makes the result still compile as the
// document the user wrote.
import type { TexBlock } from "./blocks.ts";

export type TexEdit = {
  blockIndex: number;
  text: string;
};

export type TexRewriteSkip = {
  blockIndex: number;
  reason: "contains-link" | "unchanged" | "unknown-block";
};

export type TexRewriteResult = {
  source: string;
  applied: number[];
  skipped: TexRewriteSkip[];
};

const ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

/** Optimized wording is plain prose; LaTeX's special characters must escape. */
export function escapeLatex(value: string): string {
  return value.replace(/[\\&%$#_{}~^]/g, (character) => ESCAPES[character]);
}

export function applyTexEdits(
  source: string,
  blocks: readonly TexBlock[],
  edits: readonly TexEdit[],
): TexRewriteResult {
  const applied: number[] = [];
  const skipped: TexRewriteSkip[] = [];
  const pending: Array<{ start: number; end: number; text: string }> = [];

  for (const edit of edits) {
    const block = blocks[edit.blockIndex];
    if (!block || block.index !== edit.blockIndex) {
      skipped.push({ blockIndex: edit.blockIndex, reason: "unknown-block" });
      continue;
    }
    // A block holding \href would lose its target if the range were replaced,
    // the same rule the Word path follows for a linked paragraph.
    if (block.hasLink) {
      skipped.push({ blockIndex: edit.blockIndex, reason: "contains-link" });
      continue;
    }
    if (block.text === edit.text) {
      skipped.push({ blockIndex: edit.blockIndex, reason: "unchanged" });
      continue;
    }
    pending.push({
      start: block.start,
      end: block.end,
      text: escapeLatex(edit.text),
    });
    applied.push(edit.blockIndex);
  }

  // Splice from the end so earlier offsets stay valid as the source changes.
  pending.sort((left, right) => right.start - left.start);
  let output = source;
  for (const edit of pending) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }

  applied.sort((left, right) => left - right);
  return { source: output, applied, skipped };
}
