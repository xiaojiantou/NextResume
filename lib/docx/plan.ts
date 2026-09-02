// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Decides which paragraphs of the user's own .docx get new wording. Alignment
// runs against the ORIGINAL parsed text — that is what the document still
// contains — and the optimized text is what gets written back. Anything that
// cannot be placed with confidence keeps its original wording rather than
// risking an edit landing in the wrong paragraph.
//
// The decision itself is shared with the LaTeX export; only the edit shape
// differs, so all this layer does is rename the index.
import type { Optimization, Resume } from "../types.ts";
import { planReplacements } from "../resumeReplacements.ts";
import type { DocxParagraph } from "./paragraphs.ts";
import type { ParagraphEdit } from "./rewrite.ts";

export type DocxEditPlan = {
  edits: ParagraphEdit[];
  /** Content ids whose source paragraph could not be identified. */
  unplaced: string[];
  /** Content ids that were placed but whose wording did not change. */
  unchanged: string[];
  /** Skills with no unambiguous home in a category-grouped source. */
  skillsOmitted: string[];
  /** Share of rewritten content that found its paragraph, 0..1. */
  coverage: number;
};

export function planDocxEdits({
  resume,
  optimization,
  paragraphs,
  includeSummary = true,
}: {
  resume: Resume;
  optimization: Optimization;
  paragraphs: readonly DocxParagraph[];
  includeSummary?: boolean;
}): DocxEditPlan {
  const plan = planReplacements({
    resume,
    optimization,
    units: paragraphs,
    includeSummary,
  });
  return {
    ...plan,
    edits: plan.edits.map((edit) => ({
      paragraphIndex: edit.index,
      text: edit.text,
    })),
  };
}
