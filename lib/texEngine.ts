// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Every compile request went out as { source } with no engine, so the
// service always fell back to pdflatex — even for a template that declares
// (or requires) xelatex or lualatex. pdflatex silently substitutes a
// fallback font for one it cannot load rather than failing, so the PDF still
// "compiles" while looking nothing like the user's own template: wrong font,
// wrong metrics, wrong line breaks, sometimes a different page count. This
// reads the same engine signal editors like Overleaf and TeXstudio already
// honor, so the template compiles the way its author intended.
export type TexEngine = "pdflatex" | "xelatex" | "lualatex";

const ENGINES: readonly TexEngine[] = ["pdflatex", "xelatex", "lualatex"];

// The "TeX magic comment" convention: a line near the top of the file such as
// `%!TEX program = xelatex` or `% !TEX TS-program = xelatex`. Case- and
// whitespace-insensitive, and only meaningful within the first handful of
// lines, matching how every editor that supports it looks for it.
const MAGIC_COMMENT =
  /^\s*%\s*!\s*TEX\s+(?:program|TS-program)\s*=\s*([A-Za-z]+)/i;

// Packages that only XeTeX/LuaTeX implement (fontspec refuses to run under
// pdflatex at all: "Fontspec requires either XeTeX or LuaTeX"). Presence of
// any of these means the document cannot compile under pdflatex regardless
// of what engine the user intended, so treat it as a strong xelatex signal
// even with no magic comment — that is the overwhelmingly common default for
// templates built around a system font.
const XETEX_ONLY_PACKAGES =
  /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{(?:[^}]*,\s*)?(?:fontspec|unicode-math|polyglossia|xeCJK)(?:\s*,[^}]*)?\}|\\setmainfont\b|\\setsansfont\b|\\setmonofont\b/;

// Packages specific to LuaTeX's Lua integration. Rarer than fontspec-only
// templates but a real signal when present.
const LUATEX_ONLY_PACKAGES =
  /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{(?:[^}]*,\s*)?(?:luacode|luatextra|luaotfload)(?:\s*,[^}]*)?\}/;

/**
 * Best-effort engine choice for a .tex source: an explicit magic comment
 * wins, then package sniffing for an engine-only feature, else pdflatex.
 * Never throws — an unrecognized magic-comment value falls through to
 * sniffing rather than failing the whole compile over a typo.
 */
export function detectTexEngine(source: string): TexEngine {
  const firstLines = source.split(/\r?\n/, 20).join("\n");
  for (const line of firstLines.split(/\r?\n/)) {
    const match = line.match(MAGIC_COMMENT);
    if (!match) continue;
    const declared = match[1].toLowerCase();
    const engine = ENGINES.find((candidate) => candidate === declared);
    if (engine) return engine;
  }
  if (LUATEX_ONLY_PACKAGES.test(source)) return "lualatex";
  if (XETEX_ONLY_PACKAGES.test(source)) return "xelatex";
  return "pdflatex";
}
