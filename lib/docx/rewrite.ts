// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Rewrites paragraph text inside word/document.xml while leaving every other
// byte of the document alone. Nothing here re-lays-out the page: styles,
// numbering, spacing, headers, and relationships are the user's and stay
// untouched, which is what makes the output keep the source formatting.
import {
  encodeXmlText,
  type DocxParagraph,
} from "./paragraphs.ts";

export type ParagraphEdit = {
  paragraphIndex: number;
  text: string;
};

export type RewriteSkip = {
  paragraphIndex: number;
  reason: "no-text-run" | "contains-hyperlink" | "unchanged";
};

export type RewriteResult = {
  xml: string;
  applied: number[];
  skipped: RewriteSkip[];
};

const PARAGRAPH_PATTERN = /<w:p(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/g;
const TEXT_ELEMENT_PATTERN = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;

/**
 * Word may split one sentence across a dozen runs, so new text goes into the
 * paragraph's first <w:t> and the remaining ones are emptied. The surviving
 * run keeps its own formatting, which is why a bullet that is uniformly
 * styled comes back looking identical.
 */
function rewriteParagraphXml(xml: string, text: string): string {
  let seen = 0;
  const rewritten = xml.replace(
    TEXT_ELEMENT_PATTERN,
    (_match, open: string, _text: string, close: string) => {
      const preserving = open.includes("xml:space")
        ? open
        : `${open.slice(0, -1)} xml:space="preserve">`;
      if (seen++ > 0) return `${preserving}${close}`;
      return `${preserving}${encodeXmlText(text)}${close}`;
    },
  );
  // Line breaks belonged to the old wording; the replacement is a single run
  // of text and would otherwise inherit a stray blank line.
  return rewritten.replace(/<w:br\s*\/>/g, "");
}

function hasTextRun(xml: string): boolean {
  TEXT_ELEMENT_PATTERN.lastIndex = 0;
  return TEXT_ELEMENT_PATTERN.test(xml);
}

export function applyParagraphEdits(
  documentXml: string,
  edits: readonly ParagraphEdit[],
  paragraphs?: readonly DocxParagraph[],
): RewriteResult {
  const byIndex = new Map<number, string>();
  for (const edit of edits) byIndex.set(edit.paragraphIndex, edit.text);
  const applied: number[] = [];
  const skipped: RewriteSkip[] = [];
  let index = -1;

  const xml = documentXml.replace(PARAGRAPH_PATTERN, (paragraphXml) => {
    index += 1;
    const next = byIndex.get(index);
    if (next === undefined) return paragraphXml;

    // A paragraph carrying a hyperlink is left alone. Rewriting it would
    // collapse the <w:hyperlink> runs and silently drop the URL — the exact
    // loss this whole path exists to prevent.
    const source = paragraphs?.[index];
    const linked = source
      ? source.hyperlinks.length > 0
      : /<w:hyperlink[\s>]/.test(paragraphXml);
    if (linked) {
      skipped.push({ paragraphIndex: index, reason: "contains-hyperlink" });
      return paragraphXml;
    }
    if (!hasTextRun(paragraphXml)) {
      skipped.push({ paragraphIndex: index, reason: "no-text-run" });
      return paragraphXml;
    }
    if (source && source.text === next) {
      skipped.push({ paragraphIndex: index, reason: "unchanged" });
      return paragraphXml;
    }
    applied.push(index);
    return rewriteParagraphXml(paragraphXml, next);
  });

  return { xml, applied, skipped };
}
