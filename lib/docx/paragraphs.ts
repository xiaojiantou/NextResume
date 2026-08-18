// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Reads the paragraph structure of a Word document straight out of
// word/document.xml. This is deliberately not mammoth: the in-place editor
// needs a stable paragraph *index* to write back to, and mammoth's HTML
// output has no way to point at "the 14th <w:p> in the body". Parsing the
// XML once gives us text, hyperlinks, and that index from a single pass, so
// what we show the model and what we later edit can never drift apart.

/** A hyperlink carried by a paragraph, with its display text and target. */
export type DocxHyperlink = {
  /** Visible text, e.g. "LinkedIn". */
  text: string;
  /** Resolved external target, e.g. "https://linkedin.com/in/jane". */
  url: string;
};

export type DocxParagraph = {
  /** Position among all <w:p> elements in the body, including empty ones. */
  index: number;
  text: string;
  /** w:pStyle value, e.g. "ListParagraph" or "Heading1"; null when unstyled. */
  style: string | null;
  /** w:numPr indent level; null when the paragraph is not a list item. */
  listLevel: number | null;
  hyperlinks: DocxHyperlink[];
};

// <w:p> cannot nest, so a non-greedy match is exact. The [\s>/] guard keeps
// sibling tags that merely start with "w:p" — <w:pPr>, <w:pStyle> — out.
const PARAGRAPH_PATTERN = /<w:p(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/w:p>)/g;
const TEXT_PATTERN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const HYPERLINK_PATTERN = /<w:hyperlink(\s[^>]*)>([\s\S]*?)<\/w:hyperlink>/g;
const RELATIONSHIP_PATTERN = /<Relationship\s[^>]*\/>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlText(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(parseInt(entity.slice(1), 10));
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

export function encodeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function attribute(source: string, name: string): string | null {
  const match = source.match(
    new RegExp(`${name.replace(":", "\\:")}="([^"]*)"`),
  );
  return match ? match[1] : null;
}

/**
 * Word splits one visual line across many <w:r> runs, so paragraph text is
 * only ever the concatenation of its <w:t> children. Deleted text and field
 * instructions are markup, not content, and must not leak into the resume.
 */
export function paragraphText(paragraphXml: string): string {
  const withoutMarkup = paragraphXml
    .replace(/<w:delText(?:\s[^>]*)?>[\s\S]*?<\/w:delText>/g, "")
    .replace(/<w:instrText(?:\s[^>]*)?>[\s\S]*?<\/w:instrText>/g, "")
    .replace(/<w:tab\s*\/>/g, " ")
    .replace(/<w:br\s*\/>/g, " ");
  let text = "";
  for (const match of withoutMarkup.matchAll(TEXT_PATTERN)) {
    text += decodeXmlText(match[1]);
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Maps relationship ids to external targets from word/_rels/document.xml.rels. */
export function parseRelationships(relsXml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(RELATIONSHIP_PATTERN)) {
    const tag = match[0];
    const id = attribute(tag, "Id");
    const target = attribute(tag, "Target");
    const type = attribute(tag, "Type") ?? "";
    if (!id || !target || !type.endsWith("/hyperlink")) continue;
    targets.set(id, decodeXmlText(target));
  }
  return targets;
}

function paragraphHyperlinks(
  paragraphXml: string,
  relationships: Map<string, string>,
): DocxHyperlink[] {
  const links: DocxHyperlink[] = [];
  for (const match of paragraphXml.matchAll(HYPERLINK_PATTERN)) {
    const id = attribute(match[1], "r:id");
    const url = id ? relationships.get(id) : null;
    if (!url) continue;
    const text = paragraphText(match[2]);
    links.push({ text, url });
  }
  return links;
}

export function parseDocumentXml(
  documentXml: string,
  relationships: Map<string, string> = new Map(),
): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = [];
  let index = 0;
  for (const match of documentXml.matchAll(PARAGRAPH_PATTERN)) {
    const xml = match[0];
    // Only the paragraph's own <w:pPr> defines its style; a run's <w:rPr>
    // can carry a <w:rStyle> that would otherwise match the same pattern.
    const properties = xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
    const style = properties.match(/<w:pStyle\s[^>]*w:val="([^"]*)"/)?.[1] ?? null;
    const numbered = /<w:numPr>/.test(properties);
    const level = properties.match(/<w:ilvl\s[^>]*w:val="(\d+)"/)?.[1];
    paragraphs.push({
      index,
      text: paragraphText(xml),
      style,
      listLevel: numbered ? Number(level ?? 0) : null,
      hyperlinks: paragraphHyperlinks(xml, relationships),
    });
    index += 1;
  }
  return paragraphs;
}
