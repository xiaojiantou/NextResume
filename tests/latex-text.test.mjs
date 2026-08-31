// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { extractLatexText } from "../lib/latexText.ts";

// Shaped after the widely copied "Jake" resume template: custom macros carrying
// all the content, itemize bullets, inline \textbf keywords, escaped percents.
const RESUME = String.raw`
\documentclass[letterpaper,11pt]{article}
\usepackage[empty]{fullpage}
% a preamble comment that must never reach the parser
\newcommand{\resumeSubheading}[4]{\item\small{\textbf{#1} & #2 \\ \textit{#3} & \textit{#4}}}

\begin{document}

\begin{center}
    \textbf{\Huge Kunyi Shi} \\ \vspace{1pt}
    \small (929) 408-2228 $|$ \href{mailto:x@y.edu}{shi.kun@northeastern.edu}
\end{center}

\section{Professional Experience}
\begin{itemize}
  \resumeSubheading{Software Engineer Intern}{04/2026 -- present}{Howbe Technology LLC}{Hayward, CA}
  \begin{itemize}
    \item Built a production Agentic AI platform in \textbf{Python} and \textbf{FastAPI} on \textbf{GCP}, cutting p95 latency $\sim$40\%.
    \item Designed a \textbf{ReAct}-style Planner--Executor framework reducing token spend \textasciitilde35\%. % trailing note
  \end{itemize}
\end{itemize}

\section{Technical Skills}
\textbf{Languages}: Python, Go, Java, C\#, C++

\end{document}
`;

const { text, nodes, issues, includes } = extractLatexText(RESUME);

test("the preamble and comments never reach the text", () => {
  assert.ok(!text.includes("documentclass"));
  assert.ok(!text.includes("usepackage"));
  assert.ok(!text.includes("preamble comment"));
  assert.ok(!text.includes("trailing note"));
  // The macro definition lives in the preamble and is not content either.
  assert.ok(!text.includes("newcommand"));
});

test("inline formatting is unwrapped, keeping the keyword matchable", () => {
  assert.match(text, /platform in Python and FastAPI on GCP/);
  assert.ok(!text.includes("textbf"));
  assert.match(text, /ReAct-style Planner--Executor/);
});

// Custom macros are where these templates keep everything, so dropping
// arguments alongside the command would discard most of the document.
test("arguments of an unknown macro survive", () => {
  for (const value of [
    "Software Engineer Intern",
    "04/2026 -- present",
    "Howbe Technology LLC",
    "Hayward, CA",
  ]) {
    assert.ok(text.includes(value), `lost macro argument: ${value}`);
  }
});

test("escapes become their literal character", () => {
  assert.match(text, /p95 latency ~40%/);
  assert.match(text, /token spend ~35%/);
  assert.match(text, /C#, C\+\+/);
  assert.ok(!text.includes("\\%"));
});

test("each bullet lands on its own line", () => {
  const lines = text.split("\n").map((line) => line.trim());
  assert.ok(lines.some((line) => line.startsWith("Built a production Agentic AI")));
  assert.ok(lines.some((line) => line.startsWith("Designed a ReAct-style")));
});

test("headings survive as their own lines", () => {
  const lines = text.split("\n").map((line) => line.trim());
  assert.ok(lines.includes("Professional Experience"));
  assert.ok(lines.includes("Technical Skills"));
});

// The anchors are the whole reason this file exists: they are what a later
// in-place rewrite would use to find the bytes to replace.
test("every anchor points at the bytes it claims", () => {
  assert.ok(nodes.length > 10, `only ${nodes.length} nodes`);
  for (const node of nodes) {
    assert.equal(
      RESUME.slice(node.start, node.end).length >= node.text.length,
      true,
      `anchor shorter than its text: ${JSON.stringify(node)}`,
    );
    assert.ok(node.start < node.end, `empty range: ${JSON.stringify(node)}`);
    assert.ok(node.end <= RESUME.length);
  }
});

test("anchors do not drift after an escape sequence", () => {
  // "C\#, C++" is the acid test: two source characters produce one output
  // character, so a length-derived offset would be wrong from here on.
  const skills = nodes.find((node) => node.text.includes("C#"));
  assert.ok(skills, "no node covering the skills line");
  const slice = RESUME.slice(skills.start, skills.end);
  assert.ok(slice.includes("C\\#"), `anchor missed the escape: ${JSON.stringify(slice)}`);
});

test("anchors are ordered and never overlap", () => {
  for (let i = 1; i < nodes.length; i++) {
    assert.ok(
      nodes[i].start >= nodes[i - 1].end,
      `overlap at ${i}: ${JSON.stringify([nodes[i - 1], nodes[i]])}`,
    );
  }
});

test("a clean single file reports no issues", () => {
  assert.deepEqual(issues, []);
  assert.deepEqual(includes, []);
});

test("a multi-file project is reported rather than silently truncated", () => {
  const split = extractLatexText(String.raw`
\documentclass{article}
\begin{document}
\section{Experience}
\input{sections/experience}
\include{sections/skills}
\end{document}
`);
  assert.deepEqual(split.includes, ["sections/experience", "sections/skills"]);
  assert.equal(split.issues.length, 1);
  assert.match(split.issues[0], /single self-contained \.tex/);
});

test("a fragment without a document environment is still read", () => {
  const fragment = extractLatexText(String.raw`\item Shipped \textbf{Kubernetes} operators.`);
  assert.match(fragment.text, /Shipped Kubernetes operators\./);
  assert.equal(fragment.issues.length, 1);
  assert.match(fragment.issues[0], /begin\{document\}/);
});

// Both of these were found by running the real "Jake" template through the
// extractor rather than by imagining what LaTeX looks like.
test("\\item with a braced body keeps that body", () => {
  // Skipping the group here as if it were a length argument (as \vspace takes)
  // deleted an entire skills section.
  const { text } = extractLatexText(String.raw`
\begin{document}
\section{Technical Skills}
\begin{itemize}
  \small{\item{
    \textbf{Languages}{: Python, Go, C\#, C++} \\
    \textbf{Cloud}{: AWS, Docker}
  }}
\end{itemize}
\end{document}`);
  assert.match(text, /Languages: Python, Go, C#, C\+\+/);
  assert.match(text, /Cloud: AWS, Docker/);
});

test("a link renders as its label, the way the compiled document reads", () => {
  const { text } = extractLatexText(
    String.raw`\begin{document}\href{mailto:x@y.edu}{x@y.edu} $|$ \href{https://linkedin.com/in/a}{LinkedIn}\end{document}`,
  );
  assert.match(text, /x@y\.edu \| LinkedIn/);
  assert.ok(!text.includes("mailto:"));
  assert.ok(!text.includes("linkedin.com"));
});

test("adjacent macro arguments are separated, but punctuation still binds left", () => {
  const { text } = extractLatexText(
    String.raw`\begin{document}\resumeSubheading{Engineer}{2026}{Howbe}{CA}\end{document}`,
  );
  assert.match(text, /Engineer 2026 Howbe CA/);
});

test("empty input degrades quietly", () => {
  const empty = extractLatexText("");
  assert.equal(empty.text, "");
  assert.deepEqual(empty.nodes, []);
});
