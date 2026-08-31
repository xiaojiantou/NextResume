// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Extract raw text from a resume file. Server-only.
import "server-only";
import { transcribeImage } from "./ai";
import { extractDocxText } from "./docxText";
import { UnprocessableFileError } from "./fileErrors";
import { extractLatexText } from "./latexText";
import { extractPdfPhoto } from "./pdfImage";
import { extractPdfLayout } from "./pdfLayout";
import type { ResumeSourceLayout } from "./types";

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type ExtractedFile = {
  text: string;
  photo?: string;
  layout?: ResumeSourceLayout;
  /** Problems worth telling the user about, e.g. content this cannot reach. */
  issues?: string[];
};

// mammoth's default HTML image converter (images.dataUri) inlines embedded
// pictures as base64 <img src="data:..."> — reuse that instead of writing a
// custom image converter, and just pull the first data URI back out.
async function extractDocxPhoto(buffer: Buffer): Promise<string | undefined> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const match = html.match(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/);
  return match?.[0];
}

export async function extractText(
  buffer: Buffer,
  filename: string,
): Promise<ExtractedFile> {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext && ext in IMAGE_MIME) {
    const text = await transcribeImage({
      base64: buffer.toString("base64"),
      mimeType: IMAGE_MIME[ext],
    });
    return { text };
  }

  if (ext === "pdf") {
    const [data, photo] = await Promise.all([
      extractPdfLayout(buffer),
      extractPdfPhoto(buffer),
    ]);
    return { text: data.text.trim(), photo, layout: data.layout };
  }

  if (ext === "docx") {
    // Read the OOXML directly rather than through mammoth's flat-text output:
    // paragraph and run positions are what make an in-place rewrite possible
    // later, and mammoth discards them. Photo extraction still goes through
    // mammoth, which already handles the embedded-image plumbing well.
    const [document, photo] = await Promise.all([
      Promise.resolve(extractDocxText(buffer)),
      extractDocxPhoto(buffer),
    ]);
    return {
      text: document.text,
      photo,
      issues: document.issues,
      layout: {
        parser: "docx-ooxml",
        pageCount: 1,
        maxColumns: 1,
        pages: [],
        issues: document.issues,
      },
    };
  }

  if (ext === "tex") {
    const document = extractLatexText(buffer.toString("utf8"));
    if (document.includes.length) {
      throw new UnprocessableFileError(
        `This .tex pulls in other files (${document.includes.slice(0, 3).join(", ")}). Upload a single self-contained .tex, or paste the flattened source.`,
      );
    }
    return {
      text: document.text,
      issues: document.issues,
      layout: {
        parser: "latex-source",
        pageCount: 1,
        maxColumns: 1,
        pages: [],
        issues: document.issues,
      },
    };
  }

  throw new UnprocessableFileError(
    `Unsupported file type: ${ext}. Upload a PDF, DOCX or .tex.`,
  );
}
