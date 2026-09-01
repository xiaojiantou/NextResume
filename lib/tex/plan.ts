// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Decides which blocks of the user's own .tex get new wording. Mirrors the
// Word planner: alignment is deterministic, and anything that cannot be
// placed with confidence keeps its original wording rather than risking an
// edit landing in the wrong place.
//
// Both formats share one implementation of that decision; only the edit shape
// differs, so all this layer does is rename the index.
import type { Optimization, Resume } from "../types.ts";
import { planReplacements } from "../resumeReplacements.ts";
import type { TexBlock } from "./blocks.ts";
import type { TexEdit } from "./rewrite.ts";

export type TexEditPlan = {
  edits: TexEdit[];
  unplaced: string[];
  unchanged: string[];
  /** Skills with no unambiguous home in a category-grouped source. */
  skillsOmitted: string[];
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
  const plan = planReplacements({
    resume,
    optimization,
    units: blocks,
    includeSummary,
  });
  return {
    ...plan,
    edits: plan.edits.map((edit) => ({
      blockIndex: edit.index,
      text: edit.text,
    })),
  };
}
