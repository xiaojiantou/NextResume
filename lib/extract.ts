// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Extract raw text from a resume file. Server-only.
import "server-only";
import { transcribeImage } from "./ai";
import { extractPdfPhoto } from "./pdfImage";
import { extractPdfLayout } from "./pdfLayout";
import { latexToText } from "./latex";
import type { ResumeSourceLayout } from "./types";
import type { ResumeLink } from "./resumeLinks";
import { dedupeResumeLinks, linkifyText, normalizeLinkUrl } from "./resumeLinks";

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type ExtractedFile = {
  text: string;
  photo?: string;
  layout?: ResumeSourceLayout;
  /**
   * Hyperlink targets recovered from the source document. A PDF keeps these
   * in its annotation layer and a .docx in its relationships, so neither is
   * visible to text extraction; without them a header that displays only
   * "LinkedIn" loses its URL entirely.
   */
  links?: ResumeLink[];
};

// mammoth's default HTML image converter (images.dataUri) inlines embedded
// pictures as base64 <img src="data:..."> — reuse that instead of writing a
// custom image converter, and just pull the first data URI back out.
async function extractDocxHtml(
  buffer: Buffer,
): Promise<{ photo?: string; links: ResumeLink[] }> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const photo = html.match(
    /data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/,
  )?.[0];
  // <a href="..">label</a> — the anchors mammoth already builds. Reading them
  // here is what stops a Word resume's links from being silently dropped.
  const links: ResumeLink[] = [];
  for (const match of html.matchAll(
    /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = normalizeLinkUrl(decodeHtml(match[1]));
    if (!url) continue;
    const label = decodeHtml(match[2].replace(/<[^>]+>/g, "")).trim();
    links.push({ label: label || url, url });
  }
  return { photo, links: dedupeResumeLinks(links) };
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
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
    // An image has no link layer at all, so visible URLs are all there is.
    return { text, links: linkifyText(text) };
  }

  if (ext === "pdf") {
    const [data, photo] = await Promise.all([
      extractPdfLayout(buffer),
      extractPdfPhoto(buffer),
    ]);
    const text = data.text.trim();
    return {
      text,
      photo,
      layout: data.layout,
      // Flattened or scanned exports have no annotation layer; a URL the
      // reader can see is still a target worth keeping.
      links: dedupeResumeLinks([...data.links, ...linkifyText(text)]),
    };
  }

  if (ext === "tex" || ext === "latex") {
    // A LaTeX source states its structure and its \href targets outright, so
    // nothing has to be inferred from geometry or recovered from an
    // annotation layer. linkifyText still runs for URLs written as plain
    // text rather than wrapped in \href.
    const { text, links } = latexToText(buffer.toString("utf8"));
    return { text, links: dedupeResumeLinks([...links, ...linkifyText(text)]) };
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const [result, docxHtml] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      extractDocxHtml(buffer),
    ]);
    const text = result.value.trim();
    return {
      text,
      photo: docxHtml.photo,
      links: dedupeResumeLinks([...docxHtml.links, ...linkifyText(text)]),
    };
  }

  throw new Error(`Unsupported file type: ${ext}`);
}
