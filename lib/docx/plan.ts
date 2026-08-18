// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Decides which paragraphs of the user's own .docx get new wording. Alignment
// runs against the ORIGINAL parsed text — that is what the document still
// contains — and the optimized text is what gets written back. Anything that
// cannot be placed with confidence keeps its original wording rather than
// risking an edit landing in the wrong paragraph.
import type { Optimization, Resume } from "../types.ts";
import {
  collectResumeReplacements,
  splitByChanged,
} from "../resumeReplacements.ts";
import type { DocxParagraph } from "./paragraphs.ts";
import type { ParagraphEdit } from "./rewrite.ts";
import { alignToParagraphs, type AlignTarget } from "../alignParagraphs.ts";

export type DocxEditPlan = {
  edits: ParagraphEdit[];
  /** Content ids whose source paragraph could not be identified. */
  unplaced: string[];
  /** Content ids that were placed but whose wording did not change. */
  unchanged: string[];
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
  const { rewritten, unchanged } = splitByChanged(
    collectResumeReplacements(resume, optimization, includeSummary),
  );

  const targets: AlignTarget[] = rewritten.map((item) => ({
    id: item.id,
    text: item.original,
  }));
  const alignment = alignToParagraphs(targets, paragraphs);
  const optimizedById = new Map(
    rewritten.map((item) => [item.id, item.optimized]),
  );

  const edits: ParagraphEdit[] = [];
  for (const match of alignment.matched) {
    const text = optimizedById.get(match.id);
    if (text === undefined) continue;
    edits.push({ paragraphIndex: match.paragraphIndex, text });
  }
  // Deterministic document order keeps the applied/skipped report readable.
  edits.sort((left, right) => left.paragraphIndex - right.paragraphIndex);

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
