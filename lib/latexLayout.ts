// Copyright (c) 2026 HowBe LLC. All rights reserved.

import "server-only";
import { compileLatex, isLatexCompilerConfigured } from "./latexCompiler";
import { pageLayoutFromPdf } from "./pdf/pageLayout";
import { detectTexEngine } from "./texEngine";
import type { ResumeSourceLayout } from "./types";

/**
 * How many pages a LaTeX resume actually is, by compiling it. The source
 * itself says nothing about pagination, and a placeholder count would later
 * be read as "this was a one-page resume" when deciding how densely to set
 * an export. Best effort: no compiler, a compile error, or a timeout yields
 * null and the page count stays unknown.
 */
export async function measureLatexSourceLayout(
  source: string,
  { timeoutMs = 45_000 }: { timeoutMs?: number } = {},
): Promise<ResumeSourceLayout | null> {
  if (!isLatexCompilerConfigured()) return null;
  try {
    const compiled = await compileLatex(source, {
      timeoutMs,
      engine: detectTexEngine(source),
    });
    if (!compiled.ok) {
      console.warn(
        "[parse-resume] LaTeX page count unavailable:",
        compiled.error,
      );
      return null;
    }
    return await pageLayoutFromPdf(compiled.pdf);
  } catch (error) {
    console.warn("[parse-resume] LaTeX page count unavailable", error);
    return null;
  }
}
