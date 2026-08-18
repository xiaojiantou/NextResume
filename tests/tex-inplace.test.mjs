// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { parseTexBlocks } from "../lib/tex/blocks.ts";
import { applyTexEdits, escapeLatex } from "../lib/tex/rewrite.ts";
import { planTexEdits } from "../lib/tex/plan.ts";

const SOURCE = String.raw`\documentclass[letterpaper,11pt]{article}
\usepackage{hyperref}
\newcommand{\resumeItem}[1]{\item\small{#1 \vspace{-2pt}}}
\begin{document}
\begin{center}
  \textbf{\Huge Sharon Li} \\
  555-0100 $|$ \href{https://linkedin.com/in/sharonli}{LinkedIn}
\end{center}
\section{Experience}
\begin{itemize}[leftmargin=0.15in]
  \resumeSubheading{Acme Corp}{Jul 2022 -- Present}{Senior Engineer}{Santa Clara, CA}
  \resumeItem{Cut p99 checkout latency by 43\% in Go}
  \resumeItem{Built a \textbf{gRPC} gateway serving 40M requests/day}
  \resumeItem{\href{https://github.com/sharonli/pricing}{Pricing Engine} --- used by 12 teams}
\end{itemize}
\end{document}`;

const blocks = parseTexBlocks(SOURCE);
const byText = (needle) =>
  blocks.find((block) => block.text.includes(needle));

// Any range we splice must contain balanced braces, or the document breaks.
function bracesBalanced(value) {
  const bare = value.replace(/\\[{}]/g, "");
  return (bare.match(/\{/g) ?? []).length === (bare.match(/\}/g) ?? []).length;
}

test("every block range holds balanced braces", () => {
  for (const block of blocks) {
    assert.ok(
      bracesBalanced(SOURCE.slice(block.start, block.end)),
      `block ${block.index} (${block.text.slice(0, 30)}) is unbalanced`,
    );
  }
});

test("the preamble is never offered as editable content", () => {
  assert.equal(byText("documentclass"), undefined);
  assert.equal(byText("resumeItem}[1]"), undefined);
  assert.equal(byText("leftmargin"), undefined);
});

test("a macro's fields stay separate blocks", () => {
  // Splicing across {Acme Corp}{Jul 2022} would orphan a brace.
  assert.ok(byText("Acme Corp"));
  assert.equal(byText("Acme Corp").text, "Acme Corp");
  assert.equal(byText("Jul 2022").text, "Jul 2022 -- Present");
});

test("inline formatting stays inside one block", () => {
  const block = byText("gRPC");
  assert.equal(block.text, "Built a gRPC gateway serving 40M requests/day");
  assert.ok(SOURCE.slice(block.start, block.end).includes("\\textbf"));
});

test("blocks carrying a link are flagged", () => {
  assert.equal(byText("LinkedIn").hasLink, true);
  assert.equal(byText("Pricing Engine").hasLink, true);
  assert.equal(byText("Cut p99").hasLink, false);
});

test("special characters are escaped on the way back in", () => {
  assert.equal(
    escapeLatex("Cut cost 30% & saved $2M for R&D #1"),
    "Cut cost 30\\% \\& saved \\$2M for R\\&D \\#1",
  );
  assert.equal(escapeLatex("a_b {c} ~d^e"), "a\\_b \\{c\\} \\textasciitilde{}d\\textasciicircum{}e");
});

test("an edit rewrites only its own block", () => {
  const target = byText("Cut p99");
  const result = applyTexEdits(SOURCE, blocks, [
    { blockIndex: target.index, text: "Cut p99 latency 43% & saved $2M" },
  ]);
  assert.deepEqual(result.applied, [target.index]);
  assert.match(result.source, /Cut p99 latency 43\\% \\& saved \\\$2M/);
  // Everything around it is untouched.
  assert.ok(result.source.startsWith("\\documentclass[letterpaper,11pt]{article}"));
  assert.ok(result.source.includes("\\newcommand{\\resumeItem}[1]"));
  assert.ok(result.source.includes("Built a \\textbf{gRPC} gateway"));
  assert.ok(bracesBalanced(result.source));
});

test("a block holding a link is never rewritten", () => {
  const target = byText("Pricing Engine");
  const result = applyTexEdits(SOURCE, blocks, [
    { blockIndex: target.index, text: "Open-sourced the pricing engine" },
  ]);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.skipped, [
    { blockIndex: target.index, reason: "contains-link" },
  ]);
  assert.equal(result.source, SOURCE);
});

test("several edits at once keep every offset valid", () => {
  const first = byText("Cut p99");
  const second = byText("gRPC");
  const result = applyTexEdits(SOURCE, blocks, [
    { blockIndex: first.index, text: "Cut p99 latency 43%" },
    { blockIndex: second.index, text: "Built a gRPC gateway serving 80M requests/day" },
  ]);
  assert.deepEqual(result.applied, [first.index, second.index].sort((a, b) => a - b));
  assert.match(result.source, /Cut p99 latency 43\\%/);
  assert.match(result.source, /serving 80M requests\/day/);
  assert.ok(bracesBalanced(result.source));
  // Re-reading the result yields the new wording.
  const after = parseTexBlocks(result.source);
  assert.ok(after.some((block) => block.text === "Cut p99 latency 43%"));
});

test("planning maps optimized bullets onto their source blocks", () => {
  const resume = {
    name: "Sharon Li", title: "", email: "", phone: "", location: "",
    summary: "", skills: [], projects: [], education: [],
    experience: [{
      id: "r1", company: "Acme", title: "", location: "", start: "", end: "",
      bullets: [
        { id: "b1", text: "Cut p99 checkout latency by 43% in Go" },
        { id: "b2", text: "Built a gRPC gateway serving 40M requests/day" },
        { id: "b3", text: "Ran the quarterly vendor security review" },
      ],
    }],
  };
  const optimization = {
    title: "", summary: "", skills: [], projects: [],
    roles: [{ id: "r1", bullets: [
      { id: "b1", text: "Cut p99 checkout latency 43% in Go" },
      { id: "b2", text: "Built a gRPC gateway serving 40M requests/day" },
      { id: "b3", text: "Led the quarterly vendor security review" },
    ] }],
  };
  const plan = planTexEdits({ resume, optimization, blocks });
  assert.deepEqual(plan.unchanged, ["b2"]);
  // b3 has no home in this document and is reported rather than guessed.
  assert.deepEqual(plan.unplaced, ["b3"]);
  assert.deepEqual(plan.edits, [
    { blockIndex: byText("Cut p99").index, text: "Cut p99 checkout latency 43% in Go" },
  ]);
  assert.equal(plan.coverage, 0.5);
});

test("a source with no document environment is still editable", () => {
  const fragment = String.raw`\resumeItem{Shipped the billing migration}`;
  const only = parseTexBlocks(fragment);
  assert.equal(only.length, 1);
  assert.equal(only[0].text, "Shipped the billing migration");
  const result = applyTexEdits(fragment, only, [
    { blockIndex: 0, text: "Shipped the billing migration ahead of schedule" },
  ]);
  assert.equal(
    result.source,
    String.raw`\resumeItem{Shipped the billing migration ahead of schedule}`,
  );
});
