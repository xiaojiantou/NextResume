// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Measures whether parsed content can be located back in the source file.
//
// The LaTeX and DOCX readers record where every run of text sat in the source,
// on the premise that a bullet the model returns can be found again there and
// rewritten in place. That premise is an assumption until it is measured: the
// model is asked for verbatim text, but it can still normalise whitespace, join
// wrapped lines, or tidy punctuation, and any of those breaks the lookup.
//
// This drives the real /api/parse-resume, so what it reports is the production
// path rather than a reconstruction of it.
//
// Usage:
//   npm run dev                 # in another terminal
//   node --experimental-strip-types scripts/measure-anchor-match.mjs cv-sample.tex
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { extractLatexText } from "../lib/latexText.ts";
import { extractDocxText } from "../lib/docxText.ts";

const [path, baseArg] = process.argv.slice(2);
const base = baseArg || process.env.BASE_URL || "http://127.0.0.1:3000";
if (!path) {
  console.error("usage: measure-anchor-match.mjs <file.tex|file.docx> [baseUrl]");
  process.exit(1);
}

const buffer = readFileSync(path);
const name = basename(path);

/**
 * The text the model was actually given, plus the anchored runs that text was
 * assembled from.
 *
 * Searching a re-join of the anchors instead would measure the wrong thing:
 * "on \textbf{GCP}, running" is three runs, and gluing them with spaces yields
 * "on GCP , running", which the model's verbatim output can never match. The
 * lookup a rewrite performs is two steps — find the bullet in the extracted
 * text, then map that span to source positions through the anchors — and only
 * the first step is uncertain, so that is what is measured here.
 */
function buildSource() {
  if (name.toLowerCase().endsWith(".tex")) {
    const { text, nodes } = extractLatexText(buffer.toString("utf8"));
    return {
      unit: "byte offset",
      text,
      pieces: nodes.map((node) => ({ text: node.text, where: `${node.start}-${node.end}` })),
    };
  }
  const { text, paragraphs } = extractDocxText(buffer);
  return {
    unit: "paragraph",
    text,
    pieces: paragraphs
      .filter((paragraph) => paragraph.text.trim())
      .map((paragraph) => ({ text: paragraph.text, where: `p${paragraph.index}` })),
  };
}

const { unit, text: extractedText, pieces } = buildSource();

// Collapse whitespace and case so that a model reflowing a wrapped line does
// not count as a miss; anything beyond that is a genuine rewrite.
const norm = (value) => value.replace(/\s+/g, " ").trim().toLowerCase();
const haystack = norm(extractedText);

// How much of what the model saw is anchored at all. Text with no anchor cannot
// be rewritten in place even when the model reproduces it perfectly.
const inkOnly = (value) => value.replace(/\s/g, "").length;
const anchoredChars = pieces.reduce((sum, piece) => sum + inkOnly(piece.text), 0);
const anchorCoverage = anchoredChars / Math.max(1, inkOnly(extractedText));

const words = (value) => norm(value).split(" ").filter(Boolean);

/** Longest run of the needle's leading words that still appears in the source. */
function longestPrefixHit(needle) {
  const parts = words(needle);
  let best = 0;
  for (let count = parts.length; count > 0; count--) {
    if (haystack.includes(parts.slice(0, count).join(" "))) {
      best = count;
      break;
    }
  }
  return { matched: best, total: parts.length };
}

const form = new FormData();
form.append("file", new Blob([buffer]), name);

console.log(`POST ${base}/api/parse-resume  (${name}, ${buffer.length} bytes)`);
const res = await fetch(`${base}/api/parse-resume`, { method: "POST", body: form });
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`parse failed: ${res.status} ${data.error ?? ""}`);
  process.exit(1);
}

const resume = data.resume;
const bullets = [
  ...resume.experience.flatMap((role) =>
    role.bullets.map((bullet) => ({ owner: role.company, ...bullet })),
  ),
  ...(resume.projects ?? []).flatMap((project) =>
    project.bullets.map((bullet) => ({ owner: project.name, ...bullet })),
  ),
  ...(resume.additionalSections ?? []).flatMap((section) =>
    section.items.flatMap((item) =>
      item.bullets.map((bullet) => ({ owner: section.title, ...bullet })),
    ),
  ),
];

let exact = 0;
const partial = [];
for (const bullet of bullets) {
  if (haystack.includes(norm(bullet.text))) {
    exact += 1;
    continue;
  }
  partial.push({ bullet, ...longestPrefixHit(bullet.text) });
}

const pct = (n) => `${((n / Math.max(1, bullets.length)) * 100).toFixed(1)}%`;

console.log(`\nanchors: ${pieces.length} (${unit})`);
console.log(
  `anchor coverage of extracted text: ${(anchorCoverage * 100).toFixed(1)}%`,
);
console.log(`bullets parsed: ${bullets.length}`);
console.log(`locatable verbatim: ${exact}  (${pct(exact)})`);
console.log(`not locatable: ${partial.length}  (${pct(partial.length)})`);

if (partial.length) {
  console.log("\n---- misses ----");
  for (const miss of partial) {
    const share = ((miss.matched / Math.max(1, miss.total)) * 100).toFixed(0);
    console.log(`\n  [${miss.bullet.owner}] longest leading match ${miss.matched}/${miss.total} words (${share}%)`);
    console.log(`    parsed: ${miss.bullet.text.slice(0, 150)}`);
  }
}

// Other fields matter too: a rewrite that can reach bullets but not the summary
// or a role title is only half a rewrite.
const scalars = [
  ["name", resume.name],
  ["title", resume.title],
  ["summary", resume.summary],
  ...resume.experience.flatMap((role) => [
    [`company:${role.id}`, role.company],
    [`title:${role.id}`, role.title],
  ]),
].filter(([, value]) => value);
const scalarMisses = scalars.filter(([, value]) => !haystack.includes(norm(value)));
console.log(
  `\nheader/role fields locatable: ${scalars.length - scalarMisses.length}/${scalars.length}`,
);
for (const [field, value] of scalarMisses) console.log(`  MISSING ${field}: ${value}`);
