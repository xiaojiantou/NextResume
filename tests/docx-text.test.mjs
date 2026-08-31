// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { extractDocxText } from "../lib/docxText.ts";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function docx(body) {
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(RELS),
      "word/document.xml": strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`,
      ),
    }),
  );
}

/** One <w:p>. Runs are given as strings; a nested array marks a bold run. */
function para(runs, { list = false } = {}) {
  const props = list ? "<w:pPr><w:numPr><w:ilvl w:val=\"0\"/></w:numPr></w:pPr>" : "";
  const body = runs
    .map((run) => {
      const [text, bold] = Array.isArray(run) ? run : [run, false];
      const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
      return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
    })
    .join("");
  return `<w:p>${props}${body}</w:p>`;
}

// Word routinely cuts one sentence into several runs at meaningless boundaries:
// a bold word, a revision id, a spell-check state change.
const SPLIT_BULLET = [
  "Built a production Agentic AI platform in ",
  ["Python", true],
  " and ",
  ["FastAPI", true],
  " on GCP.",
];

test("a sentence split across runs is reassembled without losing spaces", () => {
  const { text } = extractDocxText(docx(para(SPLIT_BULLET)));
  assert.equal(
    text,
    "Built a production Agentic AI platform in Python and FastAPI on GCP.",
  );
  assert.ok(!text.includes("inPython"), "run boundary swallowed a space");
});

test("every run is recorded against its paragraph", () => {
  const { paragraphs } = extractDocxText(docx(para(SPLIT_BULLET)));
  assert.equal(paragraphs.length, 1);
  assert.equal(paragraphs[0].index, 0);
  assert.equal(paragraphs[0].runs.length, 5);
  assert.deepEqual(
    paragraphs[0].runs.map((run) => run.index),
    [0, 1, 2, 3, 4],
  );
  // Concatenating the anchors must reproduce the paragraph exactly, or a
  // later in-place rewrite would target the wrong bytes.
  assert.equal(
    paragraphs[0].runs.map((run) => run.text).join(""),
    paragraphs[0].text,
  );
});

test("paragraphs keep document order and their own indices", () => {
  const { text, paragraphs } = extractDocxText(
    docx([para(["Kunyi Shi"]), para(["EXPERIENCE"]), para(SPLIT_BULLET)].join("")),
  );
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.index),
    [0, 1, 2],
  );
  assert.equal(text.split("\n")[0], "Kunyi Shi");
  assert.equal(text.split("\n")[1], "EXPERIENCE");
});

test("list membership is reported so bullets can be told from prose", () => {
  const { paragraphs } = extractDocxText(
    docx([para(["Summary line"]), para(SPLIT_BULLET, { list: true })].join("")),
  );
  assert.equal(paragraphs[0].listItem, false);
  assert.equal(paragraphs[1].listItem, true);
});

test("tabs and breaks inside a paragraph become whitespace", () => {
  const body = `<w:p><w:r><w:t>Howbe Technology LLC</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Hayward, CA</w:t></w:r></w:p>`;
  const { text } = extractDocxText(docx(body));
  assert.match(text, /Howbe Technology LLC Hayward, CA/);
});

test("XML entities are decoded once, not twice", () => {
  const { text } = extractDocxText(
    docx(para(["R&amp;D &amp; ops, C&#35;, 100&#x25; coverage"])),
  );
  assert.equal(text, "R&D & ops, C#, 100% coverage");
});

test("an empty paragraph does not become a phantom line", () => {
  const { text, paragraphs } = extractDocxText(
    docx([para(["First"]), "<w:p/>", para(["Second"])].join("")),
  );
  assert.equal(text, "First\nSecond");
  assert.equal(paragraphs.length, 3, "the empty paragraph is still addressable");
});

test("a document with a header warns that headers are not imported", () => {
  const body = `<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rId5"/></w:sectPr></w:pPr><w:r><w:t>Body text here</w:t></w:r></w:p>`;
  const { issues } = extractDocxText(docx(body));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /header/i);
});

test("a file that is not a Word document is rejected clearly", () => {
  const notDocx = Buffer.from(
    zipSync({ "hello.txt": strToU8("not a resume") }),
  );
  assert.throws(() => extractDocxText(notDocx), /not a Word document/);
});

test("a corrupt archive is rejected clearly", () => {
  assert.throws(
    () => extractDocxText(Buffer.from("this is not a zip at all")),
    /could not be opened/,
  );
});
