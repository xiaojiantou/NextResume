// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  decodeXmlText,
  encodeXmlText,
  paragraphText,
  parseDocumentXml,
  parseRelationships,
} from "../lib/docx/paragraphs.ts";
import { applyParagraphEdits } from "../lib/docx/rewrite.ts";
import {
  alignToParagraphs,
  normalizeParagraphText,
  similarity,
} from "../lib/alignParagraphs.ts";
import { readDocxDocument, rewriteDocx } from "../lib/docx/file.ts";
import {
  DOCUMENT_RELS,
  DOCUMENT_XML,
  buildResumeDocx,
} from "./fixtures/docx-fixture.mjs";

const relationships = parseRelationships(DOCUMENT_RELS);
const paragraphs = parseDocumentXml(DOCUMENT_XML, relationships);

test("paragraph text joins the runs Word split a sentence across", () => {
  assert.equal(paragraphs[0].text, "Jane Doe");
  assert.equal(paragraphs[4].text, "Reduced p99 checkout latency by 43%");
});

test("tracked deletions and field instructions are markup, not content", () => {
  assert.equal(paragraphs[7].text, "Shipped the billing migration");
});

test("an empty self-closing paragraph still holds its index", () => {
  assert.equal(paragraphs[2].text, "");
  assert.equal(paragraphs[3].text, "EXPERIENCE");
  assert.equal(paragraphs[3].style, "Heading1");
});

test("list paragraphs report their style and indent level", () => {
  assert.equal(paragraphs[4].style, "ListParagraph");
  assert.equal(paragraphs[4].listLevel, 0);
  assert.equal(paragraphs[0].listLevel, null);
});

test("a run style never masquerades as the paragraph style", () => {
  // Paragraph 1's hyperlink run carries <w:rStyle w:val="Hyperlink"/>.
  assert.equal(paragraphs[1].style, null);
});

test("hyperlinks resolve to their target even when the text hides the URL", () => {
  assert.deepEqual(paragraphs[1].hyperlinks, [
    { text: "LinkedIn", url: "https://www.linkedin.com/in/janedoe" },
  ]);
});

test("non-hyperlink relationships are not mistaken for links", () => {
  assert.equal(relationships.has("rId6"), false);
  assert.equal(relationships.size, 2);
});

test("xml entities survive a decode/encode round trip", () => {
  assert.equal(decodeXmlText("a &amp; b &lt;c&gt; &#65; &#x42;"), "a & b <c> A B");
  assert.equal(encodeXmlText("Cut cost & risk <fast>"), "Cut cost &amp; risk &lt;fast&gt;");
  assert.equal(paragraphs[5].text, "Mentored 4 engineers & ran the on-call rotation");
});

test("an edit lands in the first run and blanks the rest", () => {
  const result = applyParagraphEdits(
    DOCUMENT_XML,
    [{ paragraphIndex: 4, text: "Cut p99 checkout latency 43% via a rewritten pricing path" }],
    paragraphs,
  );
  assert.deepEqual(result.applied, [4]);
  const rewritten = parseDocumentXml(result.xml, relationships);
  assert.equal(
    rewritten[4].text,
    "Cut p99 checkout latency 43% via a rewritten pricing path",
  );
  // Neighbours are untouched.
  assert.equal(rewritten[5].text, paragraphs[5].text);
  assert.equal(rewritten[0].text, "Jane Doe");
  assert.equal(rewritten.length, paragraphs.length);
});

test("rewritten text is xml-escaped rather than injected raw", () => {
  const result = applyParagraphEdits(
    DOCUMENT_XML,
    [{ paragraphIndex: 4, text: "Scaled A&B testing <across> 3 teams" }],
    paragraphs,
  );
  assert.match(result.xml, /Scaled A&amp;B testing &lt;across&gt; 3 teams/);
  const rewritten = parseDocumentXml(result.xml, relationships);
  assert.equal(rewritten[4].text, "Scaled A&B testing <across> 3 teams");
});

test("a paragraph carrying a hyperlink is never rewritten", () => {
  const result = applyParagraphEdits(
    DOCUMENT_XML,
    [{ paragraphIndex: 6, text: "Rewrote the pricing engine" }],
    paragraphs,
  );
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.skipped, [
    { paragraphIndex: 6, reason: "contains-hyperlink" },
  ]);
  const rewritten = parseDocumentXml(result.xml, relationships);
  assert.deepEqual(rewritten[6].hyperlinks, [
    { text: "pricing engine", url: "https://github.com/janedoe/pricing" },
  ]);
});

test("empty paragraphs and no-op edits are reported, not applied", () => {
  const result = applyParagraphEdits(
    DOCUMENT_XML,
    [
      { paragraphIndex: 2, text: "anything" },
      { paragraphIndex: 3, text: "EXPERIENCE" },
    ],
    paragraphs,
  );
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.skipped, [
    { paragraphIndex: 2, reason: "no-text-run" },
    { paragraphIndex: 3, reason: "unchanged" },
  ]);
});

test("alignment ignores leading bullet glyphs and case", () => {
  assert.equal(
    normalizeParagraphText("•  Reduced P99 Checkout Latency"),
    "reduced p99 checkout latency",
  );
  const result = alignToParagraphs(
    [{ id: "b1", text: "— Reduced p99 checkout latency by 43%" }],
    paragraphs,
  );
  assert.deepEqual(result.matched, [
    { id: "b1", paragraphIndex: 4, confidence: 1 },
  ]);
  assert.deepEqual(result.unmatched, []);
});

test("alignment tolerates light drift but refuses a weak match", () => {
  assert.ok(similarity("reduced p99 latency", "reduced p99 latency.") > 0.9);
  const drifted = alignToParagraphs(
    [{ id: "b1", text: "Reduced p99 checkout latency by 43%." }],
    paragraphs,
  );
  assert.equal(drifted.matched[0].paragraphIndex, 4);
  assert.ok(drifted.matched[0].confidence < 1);

  const unrelated = alignToParagraphs(
    [{ id: "bX", text: "Led the quarterly vendor security review" }],
    paragraphs,
  );
  assert.deepEqual(unrelated.matched, []);
  assert.deepEqual(unrelated.unmatched, ["bX"]);
});

test("two targets can never claim the same paragraph", () => {
  const duplicated = parseDocumentXml(
    DOCUMENT_XML.replace(
      "<w:sectPr>",
      `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">Reduced p99 checkout latency by 43%</w:t></w:r></w:p><w:sectPr>`,
    ),
    relationships,
  );
  const result = alignToParagraphs(
    [
      { id: "b1", text: "Reduced p99 checkout latency by 43%" },
      { id: "b2", text: "Reduced p99 checkout latency by 43%" },
    ],
    duplicated,
  );
  const indexes = result.matched.map((match) => match.paragraphIndex).sort();
  assert.deepEqual(indexes, [4, 8]);
  assert.deepEqual(result.unmatched, []);
});

test("exact matches are claimed before fuzzy ones compete for a paragraph", () => {
  const result = alignToParagraphs(
    [
      { id: "fuzzy", text: "Reduced p99 checkout latency by 43%!" },
      { id: "exact", text: "Reduced p99 checkout latency by 43%" },
    ],
    paragraphs,
  );
  const exact = result.matched.find((match) => match.id === "exact");
  assert.equal(exact.paragraphIndex, 4);
  assert.equal(exact.confidence, 1);
  assert.deepEqual(result.unmatched, ["fuzzy"]);
});

test("a real docx round-trips with formatting and links intact", async () => {
  const original = await buildResumeDocx();
  const before = await readDocxDocument(original);
  assert.equal(before.hyperlinks.length, 2);

  const { buffer, applied, skipped } = await rewriteDocx(original, [
    { paragraphIndex: 4, text: "Cut p99 checkout latency 43%" },
    { paragraphIndex: 6, text: "Rewrote the pricing engine" },
  ]);
  assert.deepEqual(applied, [4]);
  assert.deepEqual(skipped, [{ paragraphIndex: 6, reason: "contains-hyperlink" }]);

  const after = await readDocxDocument(buffer);
  assert.equal(after.paragraphs[4].text, "Cut p99 checkout latency 43%");
  assert.equal(after.paragraphs[4].style, "ListParagraph");
  assert.equal(after.paragraphs[4].listLevel, 0);
  assert.equal(after.paragraphs[0].text, "Jane Doe");
  // Both links survive, including the one in the paragraph we asked to edit.
  assert.deepEqual(after.hyperlinks, before.hyperlinks);
});

test("every non-document part is copied through byte for byte", async () => {
  const JSZip = (await import("jszip")).default;
  const original = await buildResumeDocx();
  const { buffer } = await rewriteDocx(original, [
    { paragraphIndex: 4, text: "Cut p99 checkout latency 43%" },
  ]);
  const before = await JSZip.loadAsync(original);
  const after = await JSZip.loadAsync(buffer);
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort());
  for (const [name, entry] of Object.entries(before.files)) {
    if (name === "word/document.xml" || entry.dir) continue;
    assert.deepEqual(
      await after.file(name).async("nodebuffer"),
      await before.file(name).async("nodebuffer"),
      `${name} was modified`,
    );
  }
});

// Word-generated documents ship with mammoth. They are the ground truth for
// "does this parser survive real Word output"; skipped when the install has
// pruned them.
const WORD_SAMPLES = path.join(
  process.cwd(),
  "node_modules/mammoth/test/test-data",
);

test("parses Word's own output, including table cells", async (t) => {
  if (!fs.existsSync(path.join(WORD_SAMPLES, "tables.docx"))) {
    return t.skip("Word sample documents are not installed");
  }
  const tables = await readDocxDocument(
    fs.readFileSync(path.join(WORD_SAMPLES, "tables.docx")),
  );
  // Resumes routinely use tables for layout, so cell paragraphs must be seen.
  assert.deepEqual(
    tables.paragraphs.map((paragraph) => paragraph.text),
    ["Above", "Top left", "Top right", "Bottom left", "Bottom right", "Below"],
  );

  const list = await readDocxDocument(
    fs.readFileSync(path.join(WORD_SAMPLES, "simple-list.docx")),
  );
  assert.deepEqual(
    list.paragraphs.map((paragraph) => [paragraph.text, paragraph.listLevel]),
    [["Apple", 0], ["Banana", 0]],
  );
});

test("edits a Word-authored document without disturbing its neighbours", async (t) => {
  const sample = path.join(WORD_SAMPLES, "underline.docx");
  if (!fs.existsSync(sample)) {
    return t.skip("Word sample documents are not installed");
  }
  const { buffer, applied } = await rewriteDocx(fs.readFileSync(sample), [
    { paragraphIndex: 0, text: "Cut p99 checkout latency 43%" },
  ]);
  assert.deepEqual(applied, [0]);
  const after = await readDocxDocument(buffer);
  assert.equal(after.paragraphs[0].text, "Cut p99 checkout latency 43%");
});

// --- planning: resume content -> paragraph edits -------------------------

const SOURCE_RESUME = {
  name: "Jane Doe",
  title: "Staff Engineer",
  email: "jane@example.com",
  phone: "",
  location: "Seattle, WA",
  summary: "",
  skills: [],
  experience: [
    {
      id: "r1",
      company: "Acme",
      title: "Staff Engineer",
      location: "Seattle, WA",
      start: "2021",
      end: "Present",
      bullets: [
        { id: "b1", text: "Reduced p99 checkout latency by 43%" },
        { id: "b2", text: "Mentored 4 engineers & ran the on-call rotation" },
        { id: "b3", text: "Open-sourced the pricing engine used by 12 teams" },
      ],
    },
  ],
  projects: [],
  education: [],
};

const optimizationFor = (bullets) => ({
  title: "Staff Engineer",
  summary: "",
  skills: [],
  roles: [{ id: "r1", bullets }],
  projects: [],
});

test("planning maps optimized bullets onto their source paragraphs", async () => {
  const { planDocxEdits } = await import("../lib/docx/plan.ts");
  const plan = planDocxEdits({
    resume: SOURCE_RESUME,
    optimization: optimizationFor([
      { id: "b1", text: "Cut p99 checkout latency 43% by rewriting the pricing path" },
      { id: "b2", text: "Mentored 4 engineers & ran the on-call rotation" },
      { id: "b3", text: "Open-sourced the pricing engine now used by 20 teams" },
    ]),
    paragraphs,
  });
  // b2 is unchanged, so it is never written. b1 and b3 map to paragraphs 4 and 6.
  assert.deepEqual(plan.unchanged, ["b2"]);
  assert.deepEqual(plan.edits, [
    { paragraphIndex: 4, text: "Cut p99 checkout latency 43% by rewriting the pricing path" },
    { paragraphIndex: 6, text: "Open-sourced the pricing engine now used by 20 teams" },
  ]);
  assert.deepEqual(plan.unplaced, []);
  assert.equal(plan.coverage, 1);
});

test("content with no home in the document is reported, never guessed", async () => {
  const { planDocxEdits } = await import("../lib/docx/plan.ts");
  const plan = planDocxEdits({
    resume: {
      ...SOURCE_RESUME,
      experience: [
        {
          ...SOURCE_RESUME.experience[0],
          bullets: [{ id: "b9", text: "Ran the quarterly vendor security review" }],
        },
      ],
    },
    optimization: optimizationFor([
      { id: "b9", text: "Led the quarterly vendor security review" },
    ]),
    paragraphs,
  });
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(plan.unplaced, ["b9"]);
  assert.equal(plan.coverage, 0);
});

test("planning and rewriting compose into a formatting-preserving edit", async () => {
  const { planDocxEdits } = await import("../lib/docx/plan.ts");
  const original = await buildResumeDocx();
  const source = await readDocxDocument(original);
  const plan = planDocxEdits({
    resume: SOURCE_RESUME,
    optimization: optimizationFor([
      { id: "b1", text: "Cut p99 checkout latency 43%" },
      { id: "b2", text: "Grew the on-call rotation to 4 engineers" },
      { id: "b3", text: "Open-sourced the pricing engine now used by 20 teams" },
    ]),
    paragraphs: source.paragraphs,
  });
  const { buffer, applied, skipped } = await rewriteDocx(original, plan.edits);
  const after = await readDocxDocument(buffer);

  assert.deepEqual(applied, [4, 5]);
  // b3's paragraph holds a link, so it keeps its original wording.
  assert.deepEqual(skipped, [{ paragraphIndex: 6, reason: "contains-hyperlink" }]);
  assert.equal(after.paragraphs[4].text, "Cut p99 checkout latency 43%");
  assert.equal(after.paragraphs[5].text, "Grew the on-call rotation to 4 engineers");
  assert.deepEqual(after.hyperlinks, source.hyperlinks);
  assert.equal(after.paragraphs[4].style, "ListParagraph");
});
