// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Extract raw text from a resume file. Server-only.
import "server-only";
import { transcribeImage } from "./ai";
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
    const mammoth = await import("mammoth");
    const [result, photo] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      extractDocxPhoto(buffer),
    ]);
    return { text: result.value.trim(), photo };
  }

  throw new Error(`Unsupported file type: ${ext}`);
}
