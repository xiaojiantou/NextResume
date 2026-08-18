// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeResumeLinks,
  labelForUrl,
  linkifyText,
  mergeResumeLinks,
  normalizeLinkUrl,
  normalizeResumeLinks,
} from "../lib/resumeLinks.ts";
import { pairLinkAnnotations } from "../lib/pdfLinks.ts";

test("a bare domain becomes an absolute target", () => {
  assert.equal(normalizeLinkUrl("github.com/jane"), "https://github.com/jane");
  assert.equal(normalizeLinkUrl("  janedoe.dev  "), "https://janedoe.dev/");
  assert.equal(normalizeLinkUrl("https://x.com/a"), "https://x.com/a");
});

test("things that are not web links are rejected", () => {
  // These belong to the email and phone fields, not links.
  assert.equal(normalizeLinkUrl("mailto:jane@example.com"), undefined);
  assert.equal(normalizeLinkUrl("tel:+15550100"), undefined);
  assert.equal(normalizeLinkUrl("localhost"), undefined);
  assert.equal(normalizeLinkUrl(""), undefined);
});

test("a url reads as a compact resume label", () => {
  assert.equal(
    labelForUrl("https://www.linkedin.com/in/janedoe/"),
    "linkedin.com/in/janedoe",
  );
  assert.equal(labelForUrl("https://janedoe.dev"), "janedoe.dev");
});

test("legacy string links still load and gain targets", () => {
  assert.deepEqual(normalizeResumeLinks(["github.com/jane", "LinkedIn"]), [
    { label: "github.com/jane", url: "https://github.com/jane" },
    { label: "LinkedIn" },
  ]);
  assert.deepEqual(normalizeResumeLinks(undefined), []);
  assert.deepEqual(normalizeResumeLinks("nope"), []);
});

test("a link object with only a url is labelled from it", () => {
  assert.deepEqual(
    normalizeResumeLinks([{ url: "https://www.github.com/jane" }]),
    [{ label: "github.com/jane", url: "https://www.github.com/jane" }],
  );
});

test("the same target twice collapses, keeping the richer entry", () => {
  const links = dedupeResumeLinks([
    { label: "LinkedIn" },
    { label: "LinkedIn", url: "https://linkedin.com/in/jane" },
    { label: "linkedin.com/in/jane/", url: "https://www.linkedin.com/in/jane" },
  ]);
  assert.deepEqual(links, [
    { label: "LinkedIn", url: "https://linkedin.com/in/jane" },
  ]);
});

test("a recovered target fills in a label that had none", () => {
  const merged = mergeResumeLinks(
    [{ label: "LinkedIn" }, { label: "Portfolio" }],
    [
      { label: "LinkedIn", url: "https://www.linkedin.com/in/janedoe" },
      { label: "github.com/janedoe", url: "https://github.com/janedoe" },
    ],
  );
  // The displayed label survives; only the missing target is filled in.
  assert.deepEqual(merged, [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/janedoe" },
    { label: "Portfolio" },
    { label: "github.com/janedoe", url: "https://github.com/janedoe" },
  ]);
});

test("visible urls are recovered when a file has no link layer", () => {
  assert.deepEqual(
    linkifyText("Reach me at github.com/jane or https://janedoe.dev."),
    [
      { label: "github.com/jane", url: "https://github.com/jane" },
      { label: "janedoe.dev", url: "https://janedoe.dev/" },
    ],
  );
});

test("linkifying does not mistake technology names for websites", () => {
  assert.deepEqual(linkifyText("Built with Node.js, React.js and Vue.js"), []);
  assert.deepEqual(linkifyText("Improved p99 by 43% (see e.g. notes)"), []);
});

// A text item is positioned by its glyph origin: transform[4] is x, and
// transform[5] is the baseline y.
const item = (str, x, y, width) => ({
  str,
  width,
  height: 10,
  transform: [10, 0, 0, 10, x, y],
});

test("an annotation is paired with the text drawn under it", () => {
  const links = pairLinkAnnotations(
    [
      { subtype: "Link", url: "https://www.linkedin.com/in/janedoe", rect: [207, 710, 239, 720] },
      { subtype: "Link", url: "https://github.com/janedoe", rect: [245, 710, 317, 720] },
    ],
    [
      item("jane@example.com", 54, 712, 90),
      item("LinkedIn", 207, 712, 32),
      item("github.com/janedoe", 245, 712, 72),
    ],
  );
  assert.deepEqual(links, [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/janedoe" },
    { label: "github.com/janedoe", url: "https://github.com/janedoe" },
  ]);
});

test("an icon-only link still yields a usable label", () => {
  // Nothing is drawn under the rect — the common case for a linked icon.
  const links = pairLinkAnnotations(
    [{ subtype: "Link", url: "https://github.com/janedoe", rect: [400, 700, 412, 712] }],
    [item("Jane Doe", 54, 740, 60)],
  );
  assert.deepEqual(links, [
    { label: "github.com/janedoe", url: "https://github.com/janedoe" },
  ]);
});

test("corner order and non-link annotations are handled", () => {
  const links = pairLinkAnnotations(
    [
      // Rect given bottom-right first; still the same box.
      { subtype: "Link", url: "https://janedoe.dev", rect: [355, 720, 324, 710] },
      { subtype: "Widget", url: "https://example.com/form", rect: [0, 0, 10, 10] },
      { subtype: "Link", rect: [1, 1, 2, 2] },
    ],
    [item("Portfolio", 324, 712, 31)],
  );
  assert.deepEqual(links, [
    { label: "Portfolio", url: "https://janedoe.dev/" },
  ]);
});

test("text on another line is not swept into a link", () => {
  const links = pairLinkAnnotations(
    [{ subtype: "Link", url: "https://github.com/janedoe", rect: [54, 710, 126, 720] }],
    [
      item("github.com/janedoe", 54, 712, 72),
      // A line well below the annotation must not be absorbed.
      item("Staff Engineer", 54, 680, 60),
    ],
  );
  assert.deepEqual(links, [
    { label: "github.com/janedoe", url: "https://github.com/janedoe" },
  ]);
});

test("a combined text run is clipped to the linked words", () => {
  // The extractor merges adjacent runs, so one item can span a whole contact
  // line. Only the words under the rectangle may become the label.
  const combined = item("A · LinkedIn · github.com/janedoe", 100, 712, 200);
  const links = pairLinkAnnotations(
    [
      { subtype: "Link", url: "https://www.linkedin.com/in/janedoe", rect: [125, 710, 175, 720] },
    ],
    [combined],
  );
  assert.deepEqual(links, [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/janedoe" },
  ]);
});

test("a link inside a sentence takes only the linked word", () => {
  const sentence = item("Built thing in a bullet.", 54, 692, 120);
  const links = pairLinkAnnotations(
    [{ subtype: "Link", url: "https://github.com/janedoe/thing", rect: [80, 690, 110, 702] }],
    [sentence],
  );
  assert.equal(links[0].label, "thing");
});
