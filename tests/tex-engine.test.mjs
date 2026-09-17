import assert from "node:assert/strict";
import test from "node:test";
import { detectTexEngine } from "../lib/texEngine.ts";

test("an explicit TeX magic comment wins", () => {
  assert.equal(
    detectTexEngine("% !TEX program = xelatex\n\\documentclass{article}"),
    "xelatex",
  );
  assert.equal(
    detectTexEngine("%!TEX TS-program = lualatex\n\\documentclass{article}"),
    "lualatex",
  );
  assert.equal(
    detectTexEngine("%!TEX program=pdflatex\n\\usepackage{fontspec}"),
    "pdflatex",
  );
  // Only meaningful near the top of the file, matching editor conventions.
  const late = Array.from({ length: 30 }, () => "% padding").join("\n") +
    "\n%!TEX program = xelatex\n";
  assert.equal(detectTexEngine(late), "pdflatex");
});

test("fontspec and friends imply xelatex when nothing is declared", () => {
  assert.equal(
    detectTexEngine("\\documentclass{article}\n\\usepackage{fontspec}\n"),
    "xelatex",
  );
  assert.equal(
    detectTexEngine("\\documentclass{article}\n\\usepackage[math-style=ISO]{unicode-math}\n"),
    "xelatex",
  );
  assert.equal(
    detectTexEngine("\\documentclass{article}\n\\setmainfont{Lato}\n"),
    "xelatex",
  );
  // fontspec need not be the only package in its \usepackage list.
  assert.equal(
    detectTexEngine("\\documentclass{article}\n\\usepackage{amsmath,fontspec,xcolor}\n"),
    "xelatex",
  );
});

test("luatex-only packages take precedence over a bare fontspec guess", () => {
  assert.equal(
    detectTexEngine("\\usepackage{fontspec}\n\\usepackage{luatextra}\n"),
    "lualatex",
  );
});

test("an ordinary pdflatex resume with no font packages is left alone", () => {
  const source = `\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage{titlesec}
\\begin{document}
Hello
\\end{document}`;
  assert.equal(detectTexEngine(source), "pdflatex");
});
