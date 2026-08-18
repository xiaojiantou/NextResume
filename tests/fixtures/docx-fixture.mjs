// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Builds a .docx in memory that mirrors how Word actually serializes a
// resume: rsid attributes, one sentence split across several <w:r> runs,
// numbered list paragraphs, an empty self-closing paragraph, and hyperlinks
// carried by <w:hyperlink> + a relationship id. Modeled on the XML in
// mammoth's Word-generated test documents.
import JSZip from "jszip";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

export const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.linkedin.com/in/janedoe" TargetMode="External"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://github.com/janedoe/pricing" TargetMode="External"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const run = (text, properties = "") =>
  `<w:r w:rsidRPr="002733BD">${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const bulletProperties =
  `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>`;

export const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>` +
  // 0: name, split mid-word the way Word does after an edit
  `<w:p w:rsidR="003872F6" w:rsidRDefault="00BF0D64">${run("Jane ", "<w:b/>")}${run("Doe", "<w:b/>")}</w:p>` +
  // 1: contact line with a hyperlink whose visible text hides the URL
  `<w:p w:rsidR="003872F6">${run("jane@example.com · Seattle, WA · ")}<w:hyperlink r:id="rId4" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>LinkedIn</w:t></w:r></w:hyperlink></w:p>` +
  // 2: empty spacer paragraph, self-closing
  `<w:p/>` +
  // 3: section heading
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run("EXPERIENCE")}</w:p>` +
  // 4-5: list bullets, each split across runs
  `<w:p>${bulletProperties}${run("Reduced p99 checkout ")}${run("latency by 43%")}</w:p>` +
  `<w:p>${bulletProperties}${run("Mentored 4 engineers & ")}${run("ran the on-call rotation")}</w:p>` +
  // 6: a bullet that itself carries a hyperlink — must never be rewritten
  `<w:p>${bulletProperties}${run("Open-sourced the ")}<w:hyperlink r:id="rId5" w:history="1"><w:r><w:t>pricing engine</w:t></w:r></w:hyperlink>${run(" used by 12 teams")}</w:p>` +
  // 7: tracked-change deletion plus a field instruction; neither is content
  `<w:p>${run("Shipped ")}<w:r><w:delText>old wording </w:delText></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>${run("the billing migration")}</w:p>` +
  `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;

export async function buildResumeDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", DOCUMENT_XML);
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS);
  zip.file("word/styles.xml", STYLES_XML);
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}
