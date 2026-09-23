// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { PDFDocument } from "pdf-lib";
import type { ResumeSourceLayout } from "../types";

/**
 * Page geometry of a rendered PDF, as a source layout with no column
 * analysis. Used for uploads whose page count is only knowable from a render
 * of the file (a compiled .tex): the text still comes from the source, so the
 * parser stays "linear-text", but the pages are real, which is what marks the
 * page count as measured rather than a placeholder.
 */
export async function pageLayoutFromPdf(
  buffer: Buffer,
): Promise<ResumeSourceLayout> {
  const document = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pages = document.getPages().map((page, index) => {
    const { width, height } = page.getSize();
    return {
      page: index + 1,
      widthPt: width,
      heightPt: height,
      columns: 1 as const,
    };
  });
  return {
    parser: "linear-text",
    pageCount: pages.length,
    maxColumns: 1,
    pages,
    issues: [],
  };
}
