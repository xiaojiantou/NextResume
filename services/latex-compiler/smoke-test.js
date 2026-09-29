// Copyright (c) 2026 HowBe LLC. All rights reserved.
// Run during image build, as the runtime user and with the runtime TeX sandbox.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const fixtures = [
  {
    name: "english-t1",
    engine: "pdflatex",
    preamble: String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{fontawesome5,titlesec,tabularx}`,
    body: String.raw`Profile first office efficiency workflow.
\textbf{Bold achievement} \textit{Italic experience}`,
    expected: ["Profile first office efficiency workflow", "Bold achievement", "Italic experience"],
  },
  {
    name: "chinese-default",
    engine: "xelatex",
    preamble: String.raw`\documentclass[UTF8]{ctexart}`,
    body: String.raw`中文简历 软件工程师 \textbf{工作经历} English profile.`,
    expected: ["中文简历", "软件工程师", "工作经历", "English profile"],
  },
  {
    name: "chinese-noto",
    engine: "xelatex",
    preamble: String.raw`\documentclass{article}
\usepackage{xeCJK}
\setCJKmainfont{Noto Serif CJK SC}`,
    body: String.raw`中文简历 繁體中文 \textbf{工作经历} English profile.`,
    expected: ["中文简历", "繁體中文", "工作经历", "English profile"],
  },
  {
    name: "lua-fontspec",
    engine: "lualatex",
    preamble: String.raw`\documentclass{article}
\usepackage{fontspec}
\setmainfont{Lato}`,
    body: String.raw`Profile first office efficiency workflow.
\textbf{Bold achievement} \textit{Italic experience}`,
    expected: ["Profile first office efficiency workflow", "Bold achievement", "Italic experience"],
  },
];

for (const fixture of fixtures) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tex-smoke-"));
  const run = (command, args) => {
    const result = spawnSync(command, args, {
      cwd: dir, encoding: "utf8", timeout: 40_000,
      env: {
        PATH: process.env.PATH, HOME: dir,
        TEXMFVAR: path.join(dir, "texmf-var"), openin_any: "p", openout_any: "p",
      },
    });
    if (result.error || result.status !== 0) {
      throw new Error(`${fixture.name}: ${command} failed: ${result.error || result.stderr}\n${result.stdout}`);
    }
    return result.stdout;
  };
  try {
    fs.writeFileSync(path.join(dir, "resume.tex"), `${fixture.preamble}\n\\begin{document}\n${fixture.body}\n\\end{document}\n`);
    const log = run(fixture.engine, ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "resume.tex"]);
    if (/Missing character:|Font shape .* undefined/.test(log)) {
      throw new Error(`${fixture.name}: missing glyph or font shape\n${log}`);
    }
    const fonts = run("pdffonts", ["resume.pdf"]);
    if (/Type\s+3/.test(fonts)) throw new Error(`${fixture.name}: Type 3 font fallback\n${fonts}`);
    const rows = fonts.trim().split("\n").slice(2);
    if (!rows.length || rows.some(row => !/\byes\s+(?:yes|no)\s+(?:yes|no)\s+\d+\s+\d+\s*$/.test(row))) {
      throw new Error(`${fixture.name}: font not embedded\n${fonts}`);
    }
    const text = run("pdftotext", ["-enc", "UTF-8", "resume.pdf", "-"]).replace(/\s+/g, "");
    for (const expected of fixture.expected) {
      if (!text.includes(expected.replace(/\s+/g, ""))) throw new Error(`${fixture.name}: missing extracted text: ${expected}`);
    }
    console.log(`PASS ${fixture.name}: embedded vector fonts, intact text, no missing glyphs`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
