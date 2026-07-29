// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Extract raw text from a resume file. Server-only.
import "server-only";
import { transcribeImage } from "./ai";
import { extractPdfPhoto } from "./pdfImage";

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type ExtractedFile = {
  text: string;
  photo?: string;
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
    // Import the internal implementation directly. The top-level `pdf-parse`
    // entrypoint has a debug-mode code path that tries to read a bundled test
    // PDF (./test/data/05-versions-space.pdf) at load time, which ENOENTs on
    // Vercel serverless. Reaching straight for the impl file dodges it.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — deep import into pdf-parse has no types
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
      b: Buffer,
    ) => Promise<{ text: string }>;
    const [data, photo] = await Promise.all([
      pdfParse(buffer),
      extractPdfPhoto(buffer),
    ]);
    return { text: data.text.trim(), photo };
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
