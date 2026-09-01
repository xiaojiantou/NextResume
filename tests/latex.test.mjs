// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { latexToText, stripLatexComments } from "../lib/latex.ts";

test("comments are removed but an escaped percent survives", () => {
  assert.equal(
    stripLatexComments("Cut latency 43\\% % TODO reword\nNext line").trim(),
    "Cut latency 43\\%\nNext line",
  );
});

test("the preamble is setup, not resume content", () => {
  const { text } = latexToText(String.raw`
\documentclass[letterpaper,11pt]{article}
\usepackage{hyperref}
\newcommand{\resumeItem}[1]{\item\small{#1}}
\begin{document}
Sharon Li
\end{document}`);
  assert.equal(text, "Sharon Li");
});

test("a fragment with no document environment is still parsed", () => {
  assert.equal(latexToText("\\textbf{Sharon Li}").text, "Sharon Li");
});

test("href yields both the label and its target", () => {
  const { text, links } = latexToText(
    String.raw`\href{https://www.linkedin.com/in/sharonli}{LinkedIn}`,
  );
  assert.equal(text, "LinkedIn");
  assert.deepEqual(links, [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/sharonli" },
  ]);
});

test("a bare url is its own label", () => {
  const { text, links } = latexToText(String.raw`\url{https://github.com/sharonli}`);
  assert.equal(text, "https://github.com/sharonli");
  assert.deepEqual(links, [
    { label: "github.com/sharonli", url: "https://github.com/sharonli" },
  ]);
});

test("a mailto link is an email address, not a profile link", () => {
  const { text, links } = latexToText(
    String.raw`\href{mailto:sharon@example.com}{sharon@example.com}`,
  );
  assert.equal(text, "sharon@example.com");
  assert.deepEqual(links, []);
});

test("environment options never leak into the text", () => {
  const { text } = latexToText(
    String.raw`\begin{itemize}[leftmargin=0.15in, label={}]\item Shipped it\end{itemize}`,
  );
  assert.equal(text, "• Shipped it");
});

test("a template macro's arguments read as separate fields", () => {
  // \resumeSubheading{...}{...}{...}{...} must not collapse to "AcmeJul 2022".
  const { text } = latexToText(
    String.raw`\resumeSubheading{Acme Corp}{Jul 2022 -- Present}{Senior Engineer}{Santa Clara, CA}`,
  );
  assert.equal(text, "Acme Corp Jul 2022 -- Present Senior Engineer Santa Clara, CA");
});

test("a group used for typography does not split a number", () => {
  // 12{,}000 is the LaTeX idiom for a thousands separator.
  assert.equal(latexToText("Scaled to 12{,}000 RPS").text, "Scaled to 12,000 RPS");
});

test("nested formatting commands unwrap to their content", () => {
  assert.equal(latexToText(String.raw`\textbf{\Large \scshape Sharon Li}`).text, "Sharon Li");
});

test("escaped characters become themselves", () => {
  assert.equal(
    latexToText(String.raw`43\% growth, AWS \& GCP, cost \$4M, a\_b, 100\#1`).text,
    "43% growth, AWS & GCP, cost $4M, a_b, 100#1",
  );
});

test("a tabular column spec is layout and never content", () => {
  const { text } = latexToText(
    String.raw`\begin{tabular}{l@{\extracolsep{\fill}}r}Acme & 2022 \\ Initech & 2020\end{tabular}`,
  );
  assert.equal(text, "Acme 2022\nInitech 2020");
});

test("section headings and items become structure", () => {
  const { text } = latexToText(String.raw`
\section{Experience}
\begin{itemize}
  \item Cut p99 latency 43\%
  \item Scaled ingress
\end{itemize}`);
  assert.equal(text, "Experience\n\n• Cut p99 latency 43%\n• Scaled ingress");
});

test("spacing and layout commands are dropped with their arguments", () => {
  const { text } = latexToText(
    String.raw`\vspace{-4pt}\hspace{2em}Sharon\label{sec:x}\includegraphics[width=1in]{photo.png} Li`,
  );
  assert.equal(text, "Sharon Li");
});

test("a coloured run keeps its text and drops its colour", () => {
  assert.equal(latexToText(String.raw`\textcolor{blue}{Senior Engineer}`).text, "Senior Engineer");
});

test("a full resume keeps its links and loses its scaffolding", () => {
  const { text, links } = latexToText(String.raw`
\documentclass[letterpaper,11pt]{article}
\usepackage{hyperref}
\newcommand{\resumeItem}[1]{\item\small{#1 \vspace{-2pt}}}
\begin{document}
\begin{center}
  \textbf{\Huge Sharon Li} \\ \vspace{1pt}
  \small 555-0100 $|$ \href{https://www.linkedin.com/in/sharonli}{LinkedIn}
\end{center}
\section{Experience}
\begin{itemize}[leftmargin=0.15in]
  \resumeItem{Cut p99 checkout latency by 43\% across AWS \& GCP}
\end{itemize}
\end{document}`);
  assert.match(text, /Sharon Li/);
  assert.match(text, /555-0100 \| LinkedIn/);
  assert.match(text, /Cut p99 checkout latency by 43% across AWS & GCP/);
  // No scaffolding survives.
  assert.doesNotMatch(text, /documentclass|usepackage|newcommand|vspace|leftmargin/);
  assert.deepEqual(links, [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/sharonli" },
  ]);
});
