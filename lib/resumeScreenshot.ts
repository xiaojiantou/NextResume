// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Captures up to the first three pages of the ORIGINAL resume for visual-style
// analysis. Text parsing remains independent and always processes the entire
// document.
import "server-only";
import { rasterizePdf } from "./pdfRaster";
import type { ResumePageSpec, ResumeStyleSource } from "./types";

const MAX_STYLE_PAGES = 3;
const LETTER_PAGE: ResumePageSpec = {
  widthPt: 612,
  heightPt: 792,
  orientation: "portrait",
};

/**
 * Pictures of the ORIGINAL document, or null when no faithful picture exists.
 *
 * Null is a real answer, not a failure. Everything downstream of this treats
 * the images as evidence of what the author actually designed: the result page
 * labels the pane "Original PDF", and the "personalized" style has a vision
 * model read the author's visual system out of them.
 *
 * DOCX used to be rendered by converting it with mammoth and screenshotting the
 * result. mammoth extracts semantics, not layout — columns, tables, margins,
 * fonts and spacing are all gone — so the picture was the author's words
 * reflowed into hardcoded Arial on white, a document they had never seen. It
 * was then shown to them as "Original PDF" and used to derive a style described
 * as "rebuilds the uploaded resume's visual language". Rendering DOCX properly
 * needs a real Word-compatible renderer; until there is one, no picture is the
 * honest answer.
 */
export async function screenshotResume(
  buffer: Buffer,
  filename: string,
): Promise<ResumeStyleSource | null> {
  const ext = filename.split(".").pop()?.toLowerCase();

  // pdf.js renders the pages itself — no browser, so this behaves the same
  // locally and on Vercel, where headless Chromium has no PDF viewer at all.
  if (ext === "pdf") return rasterizePdf(buffer, MAX_STYLE_PAGES);

  // A .tex is not a rendered document. Producing an image would mean running a
  // LaTeX toolchain, which this deployment does not have.
  if (ext === "docx" || ext === "tex") return null;

  if (ext === "png" || ext === "jpg" || ext === "jpeg") {
    const mime = ext === "png" ? "image/png" : "image/jpeg";
    return {
      screenshots: [`data:${mime};base64,${buffer.toString("base64")}`],
      page: LETTER_PAGE,
      pageCount: 1,
    };
  }

  throw new Error(`Unsupported file type for screenshot: ${ext}`);
}
