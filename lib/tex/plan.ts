// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Decides which blocks of the user's own .tex get new wording. Mirrors the
// Word planner: alignment is deterministic, and anything that cannot be
// placed with confidence keeps its original wording rather than risking an
// edit landing in the wrong place.
import type { Optimization, Resume } from "../types.ts";
import {
  collectResumeReplacements,
  splitByChanged,
} from "../resumeReplacements.ts";
import { alignToParagraphs, type AlignTarget } from "../alignParagraphs.ts";
import type { TexBlock } from "./blocks.ts";
import type { TexEdit } from "./rewrite.ts";

export type TexEditPlan = {
  edits: TexEdit[];
  unplaced: string[];
  unchanged: string[];
  coverage: number;
};

export function planTexEdits({
  resume,
  optimization,
  blocks,
  includeSummary = true,
}: {
  resume: Resume;
  optimization: Optimization;
  blocks: readonly TexBlock[];
  includeSummary?: boolean;
}): TexEditPlan {
  const { rewritten, unchanged } = splitByChanged(
    collectResumeReplacements(resume, optimization, includeSummary),
  );

  const targets: AlignTarget[] = rewritten.map((item) => ({
    id: item.id,
    text: item.original,
  }));
  const alignment = alignToParagraphs(targets, blocks);
  const optimizedById = new Map(
    rewritten.map((item) => [item.id, item.optimized]),
  );

  const edits: TexEdit[] = [];
  for (const match of alignment.matched) {
    const text = optimizedById.get(match.id);
    if (text === undefined) continue;
    edits.push({ blockIndex: match.paragraphIndex, text });
  }
  edits.sort((left, right) => left.blockIndex - right.blockIndex);

  return {
    edits,
    unplaced: alignment.unmatched,
    unchanged,
    coverage:
      rewritten.length === 0
        ? 1
        : alignment.matched.length / rewritten.length,
  };
}
