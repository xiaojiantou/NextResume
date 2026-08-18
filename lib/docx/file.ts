// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Zip-level access to a .docx. Everything the editor touches lives in
// word/document.xml; every other entry is copied through byte-for-byte, which
// is what preserves styles, fonts, numbering, headers, and images.
//
// No "server-only" guard here on purpose: this layer is pure data transform
// with no secrets, and the test runner needs to import it directly.
import type { ParagraphEdit, RewriteSkip } from "./rewrite.ts";
import { applyParagraphEdits } from "./rewrite.ts";
import { parseDocumentXml, parseRelationships } from "./paragraphs.ts";
import type { DocxParagraph } from "./paragraphs.ts";

const DOCUMENT_PATH = "word/document.xml";
const RELATIONSHIPS_PATH = "word/_rels/document.xml.rels";

export type DocxDocument = {
  paragraphs: DocxParagraph[];
  /** Every external hyperlink in the document, in reading order. */
  hyperlinks: Array<{ paragraphIndex: number; text: string; url: string }>;
};

// jszip arrives with mammoth but is imported directly here, so it is also a
// declared dependency in package.json.
async function loadZip(buffer: Buffer) {
  const JSZip = (await import("jszip")).default;
  return JSZip.loadAsync(buffer);
}

export async function readDocxDocument(buffer: Buffer): Promise<DocxDocument> {
  const zip = await loadZip(buffer);
  const documentFile = zip.file(DOCUMENT_PATH);
  if (!documentFile) {
    throw new Error("This .docx has no word/document.xml and cannot be read.");
  }
  const documentXml = await documentFile.async("string");
  const relsFile = zip.file(RELATIONSHIPS_PATH);
  const relationships = relsFile
    ? parseRelationships(await relsFile.async("string"))
    : new Map<string, string>();
  const paragraphs = parseDocumentXml(documentXml, relationships);
  return {
    paragraphs,
    hyperlinks: paragraphs.flatMap((paragraph) =>
      paragraph.hyperlinks.map((link) => ({
        paragraphIndex: paragraph.index,
        text: link.text,
        url: link.url,
      })),
    ),
  };
}

export type DocxRewrite = {
  buffer: Buffer;
  applied: number[];
  skipped: RewriteSkip[];
};

export async function rewriteDocx(
  buffer: Buffer,
  edits: readonly ParagraphEdit[],
): Promise<DocxRewrite> {
  const zip = await loadZip(buffer);
  const documentFile = zip.file(DOCUMENT_PATH);
  if (!documentFile) {
    throw new Error("This .docx has no word/document.xml and cannot be edited.");
  }
  const documentXml = await documentFile.async("string");
  const relsFile = zip.file(RELATIONSHIPS_PATH);
  const relationships = relsFile
    ? parseRelationships(await relsFile.async("string"))
    : new Map<string, string>();
  const paragraphs = parseDocumentXml(documentXml, relationships);
  const result = applyParagraphEdits(documentXml, edits, paragraphs);
  zip.file(DOCUMENT_PATH, result.xml);
  // Without an explicit level jszip stores entries uncompressed, which
  // inflates a small resume several times over.
  const rewritten = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  return {
    buffer: rewritten,
    applied: result.applied,
    skipped: result.skipped,
  };
}
