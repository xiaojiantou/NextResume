// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The single path from "optimized resume" to "the user's own .tex, rewritten".
// Both the source download and the compiled PDF go through here, so the PDF
// can never be built from a different document than the .tex we hand over.
import type { Optimization, Resume } from "../types.ts";
import { parseTexBlocks } from "./blocks.ts";
import { planTexEdits } from "./plan.ts";
import { applyTexEdits, type TexRewriteSkip } from "./rewrite.ts";

export type TexExport = {
  source: string;
  applied: number[];
  skipped: TexRewriteSkip[];
  unplaced: string[];
  /** Skills with no unambiguous home in a category-grouped source. */
  skillsOmitted: string[];
  coverage: number;
};

export class NoTexEditsError extends Error {
  readonly unplaced: string[];
  constructor(unplaced: string[]) {
    super(
      "None of the optimized wording could be matched to the original source.",
    );
    this.name = "NoTexEditsError";
    this.unplaced = unplaced;
  }
}

export function buildEditedTex({
  resume,
  optimization,
  source,
  includeSummary = true,
}: {
  resume: Resume;
  optimization: Optimization;
  source: string;
  includeSummary?: boolean;
}): TexExport {
  const blocks = parseTexBlocks(source);
  const plan = planTexEdits({
    resume,
    optimization,
    blocks,
    includeSummary,
  });
  if (plan.edits.length === 0) throw new NoTexEditsError(plan.unplaced);

  const result = applyTexEdits(source, blocks, plan.edits);
  return {
    source: result.source,
    applied: result.applied,
    skipped: result.skipped,
    unplaced: plan.unplaced,
    skillsOmitted: plan.skillsOmitted,
    coverage: plan.coverage,
  };
}
