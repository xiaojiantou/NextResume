// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Turns a LaTeX resume into the plain text the parser expects, and pulls out
// the links it declares. A .tex source is the richest input we accept: its
// structure and its \href targets are stated outright rather than inferred
// from geometry, so nothing has to be recovered from an annotation layer.
//
// Brace nesting rules this out as a regex problem — \textbf{\Large Jane} has
// to survive — so the source is walked once with a scanner instead.
import type { ResumeLink } from "./resumeLinks.ts";
import { dedupeResumeLinks, labelForUrl, normalizeLinkUrl } from "./resumeLinks.ts";

// Layout and setup commands whose arguments are not resume content. Anything
// not listed keeps its argument text, which is what makes custom template
// macros like \resumeSubheading{Acme}{2021}{Engineer} degrade gracefully.
export const DISCARD_WITH_ARGUMENTS = new Set([
  "documentclass", "usepackage", "RequirePackage", "geometry", "pagestyle",
  "thispagestyle", "fancyhead", "fancyfoot", "renewcommand", "newcommand",
  "providecommand", "def", "let", "setlength", "addtolength", "vspace",
  "hspace", "rule", "includegraphics", "label", "ref", "pageref", "input",
  "include", "bibliography", "bibliographystyle", "titleformat",
  "titlespacing", "definecolor", "color", "textcolor", "colorbox",
  "hyphenation", "setmainfont", "setsansfont", "raisebox", "scalebox",
  "titlerule", "urlstyle", "hypersetup", "graphicspath", "counterwithin",
  "setcounter", "addcontentsline", "phantomsection", "index",
]);

// \textcolor{blue}{Text} keeps its final argument even though the command is
// discarded: the colour is styling, the text is content.
const KEEP_LAST_ARGUMENT = new Set(["textcolor", "colorbox", "raisebox", "scalebox"]);

export const ENVIRONMENTS_WITH_SPEC = new Set([
  "tabular", "tabular*", "array", "tabularx", "longtable", "multicols",
]);

const ESCAPED_CHARACTERS: Record<string, string> = {
  "&": "&", "%": "%", $: "$", "#": "#", _: "_", "{": "{", "}": "}",
  " ": " ", "-": "",
};

/** Removes % comments while respecting an escaped \%. */
export function stripLatexComments(source: string): string {
  let output = "";
  for (const line of source.split(/\r?\n/)) {
    let cut = -1;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== "%") continue;
      let backslashes = 0;
      for (let back = index - 1; back >= 0 && line[back] === "\\"; back -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) {
        cut = index;
        break;
      }
    }
    // Trailing space left where a comment was cut is not content.
    output += `${cut === -1 ? line : line.slice(0, cut).replace(/[ \t]+$/, "")}\n`;
  }
  return output;
}

type Group = { content: string; end: number };

/** Reads a balanced {...} starting at `open`, or null if it is not one. */
export function readGroup(source: string, open: number, close = "}"): Group | null {
  const opener = close === "}" ? "{" : "[";
  if (source[open] !== opener) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === opener) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return { content: source.slice(open + 1, index), end: index + 1 };
      }
    }
  }
  return null;
}

export function skipOptional(source: string, index: number): number {
  let cursor = index;
  while (source[cursor] === "[") {
    const group = readGroup(source, cursor, "]");
    if (!group) break;
    cursor = group.end;
  }
  return cursor;
}

export function readArguments(
  source: string,
  index: number,
  limit: number,
): { groups: string[]; end: number } {
  const groups: string[] = [];
  let cursor = skipOptional(source, index);
  while (groups.length < limit) {
    const group = readGroup(source, cursor);
    if (!group) break;
    groups.push(group.content);
    cursor = skipOptional(source, group.end);
  }
  return { groups, end: cursor };
}

export type LatexDocument = {
  text: string;
  links: ResumeLink[];
};

export function latexToText(source: string): LatexDocument {
  const withoutComments = stripLatexComments(source);
  // The preamble is setup, not content. Keep everything when the document has
  // no \begin{document} at all — a fragment is still worth parsing.
  const bodyStart = withoutComments.indexOf("\\begin{document}");
  const body =
    bodyStart === -1
      ? withoutComments
      : withoutComments.slice(bodyStart + "\\begin{document}".length);
  const links: ResumeLink[] = [];
  const text = convert(body, links);
  return {
    text: tidy(text),
    links: dedupeResumeLinks(links),
  };
}

function convert(source: string, links: ResumeLink[]): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const character = source[index];

    if (character === "\\") {
      const rest = source.slice(index + 1);
      const nameMatch = rest.match(/^[a-zA-Z@]+\*?/);

      if (!nameMatch) {
        const symbol = source[index + 1];
        if (symbol === "\\") {
          // A line break, optionally carrying a spacing argument.
          const after = skipOptional(source, index + 2);
          output += "\n";
          index = after;
          continue;
        }
        if (symbol !== undefined && symbol in ESCAPED_CHARACTERS) {
          output += ESCAPED_CHARACTERS[symbol];
          index += 2;
          continue;
        }
        index += symbol === undefined ? 1 : 2;
        continue;
      }

      const name = nameMatch[0];
      let cursor = index + 1 + name.length;

      if (name === "begin" || name === "end") {
        const group = readGroup(source, cursor);
        if (group) {
          const environment = group.content.trim();
          // \begin{itemize}[leftmargin=0.15in] — the options follow the
          // environment name and are formatting, never content.
          cursor = skipOptional(source, group.end);
          // A tabular column spec is layout, never content.
          if (ENVIRONMENTS_WITH_SPEC.has(environment)) {
            const spec = readGroup(source, cursor);
            if (spec) cursor = skipOptional(source, spec.end);
          }
          output += "\n";
          index = cursor;
          continue;
        }
      }

      if (name === "href") {
        const { groups, end } = readArguments(source, cursor, 2);
        const url = normalizeLinkUrl(convert(groups[0] ?? "", links).trim());
        const label = convert(groups[1] ?? "", links).trim();
        if (url) links.push({ label: label || labelForUrl(url), url });
        output += label || (url ? labelForUrl(url) : "");
        index = end;
        continue;
      }

      if (name === "url" || name === "nolinkurl") {
        const { groups, end } = readArguments(source, cursor, 1);
        const raw = (groups[0] ?? "").trim();
        const url = normalizeLinkUrl(raw);
        if (url) links.push({ label: labelForUrl(url), url });
        output += raw;
        index = end;
        continue;
      }

      if (name === "item") {
        output += "\n• ";
        index = skipOptional(source, cursor);
        continue;
      }

      if (/^(sub){0,2}section$|^(sub)?paragraph$|^chapter$/.test(name)) {
        const { groups, end } = readArguments(source, cursor, 1);
        output += `\n\n${convert(groups[0] ?? "", links).trim()}\n`;
        index = end;
        continue;
      }

      if (DISCARD_WITH_ARGUMENTS.has(name)) {
        const limit = name === "newcommand" || name === "renewcommand" ? 2 : 3;
        const { groups, end } = readArguments(source, cursor, limit);
        if (KEEP_LAST_ARGUMENT.has(name) && groups.length > 0) {
          output += convert(groups[groups.length - 1], links);
        }
        index = end;
        continue;
      }

      // Everything else is presentational or a template macro: drop the
      // command, keep whatever it wraps. Arguments are joined rather than
      // concatenated, because a template's \resumeSubheading{Acme}{2022}
      // holds separate fields that would otherwise read as "AcmeJul 2022".
      // Only immediately adjacent groups are taken, so a following sibling
      // on the next line is never swallowed as an argument.
      const { groups, end } = readArguments(source, cursor, 6);
      if (groups.length > 0) {
        output += groups
          .map((group) => convert(group, links).trim())
          .filter(Boolean)
          .join(" ");
      }
      index = end;
      continue;
    }

    if (character === "{" || character === "}") {
      index += 1;
      continue;
    }
    if (character === "&") {
      output += " ";
      index += 1;
      continue;
    }
    if (character === "~") {
      output += " ";
      index += 1;
      continue;
    }
    if (character === "$") {
      index += 1;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function tidy(value: string): string {
  const collapsed = value
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]*•[ \t]*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Successive list items belong together; the blank line between them comes
  // from the source's own line breaks, not from a break in the list.
  let tightened = collapsed;
  for (;;) {
    const next = tightened.replace(/(•[^\n]*)\n{2,}(?=•)/g, "$1\n");
    if (next === tightened) return next;
    tightened = next;
  }
}
