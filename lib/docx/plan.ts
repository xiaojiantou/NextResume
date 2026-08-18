// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Decides which paragraphs of the user's own .docx get new wording. Alignment
// runs against the ORIGINAL parsed text — that is what the document still
// contains — and the optimized text is what gets written back. Anything that
// cannot be placed with confidence keeps its original wording rather than
// risking an edit landing in the wrong paragraph.
import type { Optimization, Resume } from "../types.ts";
import type { DocxParagraph } from "./paragraphs.ts";
import type { ParagraphEdit } from "./rewrite.ts";
import { alignToParagraphs, type AlignTarget } from "./align.ts";

export type DocxEditPlan = {
  edits: ParagraphEdit[];
  /** Content ids whose source paragraph could not be identified. */
  unplaced: string[];
  /** Content ids that were placed but whose wording did not change. */
  unchanged: string[];
  /** Share of rewritten content that found its paragraph, 0..1. */
  coverage: number;
};

type Replacement = { id: string; original: string; optimized: string };

function collectReplacements(
  resume: Resume,
  optimization: Optimization,
  includeSummary: boolean,
): Replacement[] {
  const replacements: Replacement[] = [];

  if (includeSummary && optimization.summary && resume.summary) {
    replacements.push({
      id: "summary",
      original: resume.summary,
      optimized: optimization.summary,
    });
  }

  for (const role of resume.experience) {
    const optimized = optimization.roles.find(
      (candidate) => candidate.id === role.id,
    );
    if (!optimized) continue;
    for (const bullet of role.bullets) {
      const next = optimized.bullets.find(
        (candidate) => candidate.id === bullet.id,
      );
      if (!next) continue;
      replacements.push({
        id: bullet.id,
        original: bullet.text,
        optimized: next.text,
      });
    }
  }

  for (const project of resume.projects ?? []) {
    const optimized = optimization.projects?.find(
      (candidate) => candidate.id === project.id,
    );
    if (!optimized) continue;
    for (const bullet of project.bullets) {
      const next = optimized.bullets.find(
        (candidate) => candidate.id === bullet.id,
      );
      if (!next) continue;
      replacements.push({
        id: bullet.id,
        original: bullet.text,
        optimized: next.text,
      });
    }
  }

  return replacements;
}

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
  const replacements = collectReplacements(
    resume,
    optimization,
    includeSummary,
  );
  const unchanged = replacements
    .filter((item) => item.original.trim() === item.optimized.trim())
    .map((item) => item.id);
  const rewritten = replacements.filter(
    (item) => item.original.trim() !== item.optimized.trim(),
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
