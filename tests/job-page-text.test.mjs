// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractJobPageText, htmlToText } from "../lib/jobPageText.ts";

// A real Ashby posting, trimmed to the shell + the __appData script. The route
// used to return 422 on this page: 29KB of HTML, 37 characters of visible text.
const ASHBY = readFileSync(
  new URL("./fixtures/job-page-ashby.html", import.meta.url),
  "utf8",
);

test("a client-rendered posting yields its description, not its shell", () => {
  const text = extractJobPageText(ASHBY);

  // The old tag-stripping path found only the title.
  assert.ok(htmlToText(ASHBY).length < 200, "fixture should have no visible body");
  assert.ok(text.length > 4000, `got ${text.length} chars`);

  assert.ok(text.includes("Ambrook helps American family-run businesses"));
  assert.ok(text.includes("Series B"));
  // Markup inside the JSON string is unwrapped, not passed through.
  assert.ok(!text.includes("<p>"));
  assert.ok(!text.includes("</li>"));
});

test("the role name is carried along with the description body", () => {
  // The structured description is the body alone; downstream matching needs
  // the title, which lives only in the page metadata.
  assert.ok(extractJobPageText(ASHBY).startsWith("Software Engineering Intern"));
});

test("schema.org JobPosting wins when a page publishes one", () => {
  const description =
    "<p>We are hiring a Staff Platform Engineer to own our Kubernetes " +
    "estate, our Terraform modules, and the CI/CD pipelines that ship 40 " +
    "services a day. You will partner with product teams on reliability " +
    "budgets and lead the migration off our legacy queue.</p>";
  const html = `<!DOCTYPE html><html><head><title>Careers</title>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Northstar Labs" },
        { "@type": "JobPosting", title: "Staff Platform Engineer", description },
      ],
    })}</script></head><body><div id="app"></div></body></html>`;

  const text = extractJobPageText(html);
  assert.ok(text.includes("Staff Platform Engineer to own our Kubernetes"));
  assert.ok(text.includes("legacy queue"));
  assert.ok(!text.includes("<p>"));
});

test("@type given as an array is still recognised", () => {
  const html = `<html><body><script type="application/ld+json">${JSON.stringify({
    "@type": ["JobPosting", "Thing"],
    description: `<div>${"Own the data platform end to end. ".repeat(12)}</div>`,
  })}</script></body></html>`;
  assert.ok(extractJobPageText(html).includes("Own the data platform end to end."));
});

test("a server-rendered posting still works", () => {
  const body = "We need a senior backend engineer with Go and Postgres. ".repeat(8);
  const html = `<html><head><title>Backend Engineer</title></head>
    <body><nav>Home</nav><article><h1>Backend Engineer</h1><p>${body}</p></article></body></html>`;

  const text = extractJobPageText(html);
  assert.ok(text.includes("senior backend engineer with Go and Postgres"));
  assert.ok(text.includes("Backend Engineer"));
});

test("a short meta description never beats the visible page", () => {
  // `description` is in the key list but is also a generic meta field; a page
  // with a real body must not be reduced to its social blurb.
  const body = "Join our data team. You will build pipelines in Python. ".repeat(8);
  const html = `<html><head><title>Data Engineer</title>
    <script>window.__DATA__ = {"description":"Join our data team."};</script></head>
    <body><article><p>${body}</p></article></body></html>`;

  const text = extractJobPageText(html);
  assert.ok(text.includes("You will build pipelines in Python"));
  assert.ok(text.length > 200);
});

test("an empty page degrades to a short string, not a crash", () => {
  assert.ok(extractJobPageText("<html><body></body></html>").length < 200);
  assert.equal(extractJobPageText(""), "");
});

test("malformed embedded JSON does not throw", () => {
  const html = `<html><body><script type="application/ld+json">{not json at all</script>
    <script>window.x = {"descriptionHtml": "unterminated</script>
    <p>Fallback body text that is long enough to be considered a real posting body for our purposes here.</p>
    </body></html>`;
  assert.doesNotThrow(() => extractJobPageText(html));
  assert.ok(extractJobPageText(html).includes("Fallback body text"));
});

test("descriptionHtml wins over a generic description on the same page", () => {
  const real = `<p>${"Design and operate our streaming ingest layer. ".repeat(10)}</p>`;
  const html = `<html><head><title>Streaming Engineer</title></head><body>
    <script>window.__appData = {"description":"A job at Acme.","posting":{"descriptionHtml":${JSON.stringify(real)}}};</script>
    </body></html>`;
  const text = extractJobPageText(html);
  assert.ok(text.includes("Design and operate our streaming ingest layer"));
});

test("entities are decoded once, not twice", () => {
  assert.equal(htmlToText("<p>R&amp;D &amp; ops</p>"), "R&D & ops");
  assert.equal(htmlToText("<p>&amp;lt;script&amp;gt;</p>"), "&lt;script&gt;");
});

test("block tags become line breaks and indentation is stripped", () => {
  assert.equal(htmlToText("<p>Go</p><p>Postgres</p>"), "Go\nPostgres");
  assert.equal(
    htmlToText("<ul>\n  <li>Go</li>\n  <li>Postgres</li>\n</ul>"),
    "Go\n\nPostgres",
  );
});

// Paragraph breaks are what separate a posting's sections, so they survive —
// but never more than one blank line, however the source is indented.
test("blank runs are capped at a single blank line", () => {
  assert.equal(
    htmlToText("<p>Responsibilities</p>\n\n\n   \n<p>Ship things</p>"),
    "Responsibilities\n\nShip things",
  );
});
