// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Reads a .docx as paragraphs, remembering which runs each one came from.
//
// mammoth.extractRawText returns one flat string, which is enough to feed a
// model and nothing else: the result cannot be written back, because no part of
// it knows where it came from. A .docx is a zip of XML, and Word keeps the
// document's styling in parts this never touches — so recording a paragraph's
// run indices is what makes it possible later to swap the text and leave the
// author's formatting byte-for-byte intact.
//
// Word splits a single visible sentence across many <w:r> runs, and the split
// points carry no meaning: a spell-check state change, a revision id, or one
// bold word is enough. Everything here works in terms of paragraphs for that
// reason.
import { unzipSync, strFromU8 } from "fflate";
// Explicit extension: this module is unit-tested directly under Node's type
// stripping, whose ESM loader will not resolve an extensionless relative
// specifier at runtime. Type-only imports are erased and so never hit it, which
// is why the rest of lib/ gets away without one.
import { UnprocessableFileError } from "./fileErrors.ts";

export type DocxRunAnchor = {
  /** Index of the run within its paragraph, as encountered in document order. */
  index: number;
  text: string;
};

export type DocxParagraph = {
  /** Index of the paragraph within the document, in document order. */
  index: number;
  text: string;
  runs: DocxRunAnchor[];
  /** True when the paragraph is part of a numbered or bulleted list. */
  listItem: boolean;
};

export type DocxExtraction = {
  text: string;
  paragraphs: DocxParagraph[];
  issues: string[];
};

const DOCUMENT_PART = "word/document.xml";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    // Ampersand last, so "&amp;lt;" does not decode twice into a tag.
    .replace(/&amp;/g, "&");
}

/**
 * Pulls the text out of one <w:p>. Only <w:t> carries characters; <w:tab> and
 * <w:br> are whitespace, and everything else in a run (formatting, revision
 * marks, proofing state) is deliberately ignored.
 */
function readParagraph(xml: string, index: number): DocxParagraph {
  const runs: DocxRunAnchor[] = [];
  let text = "";
  let runIndex = 0;

  for (const match of xml.matchAll(/<w:(t|tab|br|cr)(\s[^>]*)?(\/>|>([\s\S]*?)<\/w:\1>)/g)) {
    const tag = match[1];
    if (tag === "t") {
      // xml:space="preserve" marks a run whose leading or trailing spaces are
      // significant; without it Word still round-trips them, so keep them all.
      const value = decodeXmlEntities(match[4] ?? "");
      if (!value) continue;
      runs.push({ index: runIndex++, text: value });
      text += value;
      continue;
    }
    text += tag === "tab" ? "\t" : "\n";
  }

  return {
    index,
    text,
    runs,
    listItem: /<w:numPr[\s>]/.test(xml),
  };
}

export function extractDocxText(buffer: Buffer): DocxExtraction {
  const issues: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer), {
      filter: (file) => file.name === DOCUMENT_PART,
    });
  } catch {
    throw new UnprocessableFileError(
      "This .docx could not be opened. Re-save it from Word and try again.",
    );
  }

  const part = files[DOCUMENT_PART];
  if (!part) {
    throw new UnprocessableFileError(
      "This file is not a Word document (no word/document.xml).",
    );
  }

  const xml = strFromU8(part);
  const paragraphs: DocxParagraph[] = [];
  let index = 0;
  for (const match of xml.matchAll(/<w:p(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    paragraphs.push(readParagraph(match[1] ?? "", index++));
  }

  // Text boxes and shapes hold their own <w:p> runs inside <w:txbxContent>, and
  // those are already picked up above. Headers, footers and footnotes are
  // separate parts that are not read, so a resume that hides contact details in
  // a header would lose them silently.
  if (/<w:headerReference[\s>]/.test(xml)) {
    issues.push(
      "This document uses a page header. Content in headers is not imported — check that your contact details came through.",
    );
  }

  const text = paragraphs
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, paragraphs, issues };
}
