// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Turns a .tex resume into plain text, remembering where every piece came from.
//
// No attempt is made to understand the template. Resume classes vary far too
// much — moderncv, altacv, the "Jake" template, and any number of homegrown
// macros — for rule-based structure recognition to be worth writing. The
// semantic pass is the same model call every other format goes through.
//
// What this file owns is the part a model cannot do: recording the byte range
// each run of text occupied in the source. That mapping is what makes it
// possible later to rewrite a bullet in place and recompile the author's own
// template, instead of rebuilding an approximation of it.

/** A run of literal text and the source range it was read from. */
export type LatexTextNode = {
  text: string;
  /** Inclusive offset into the original source. */
  start: number;
  /** Exclusive offset into the original source. */
  end: number;
};

export type LatexExtraction = {
  text: string;
  nodes: LatexTextNode[];
  issues: string[];
  /** Files pulled in by \input or \include, which a single upload cannot resolve. */
  includes: string[];
};

// Commands that open a block, so their argument belongs on its own line.
// Inline formatting is deliberately absent: \textbf{Python} is part of the
// sentence around it, and breaking there is what produced "platform in\nPython"
// — the same split-keyword damage the PDF path used to inflict.
const BLOCK_COMMANDS = new Set([
  "section", "subsection", "subsubsection", "paragraph", "subparagraph",
  "chapter", "part", "title", "cventry", "cvitem", "resumesubheading",
  "resumeprojectheading", "resumesubheadinglistend",
]);

// Commands that produce a character rather than markup.
const LITERAL_COMMANDS: Record<string, string> = {
  "&": "&", "%": "%", "$": "$", "#": "#", "_": "_",
  "{": "{", "}": "}", "~": "~", "^": "^", "\\": "\n",
  ldots: "…", dots: "…", textellipsis: "…",
  sim: "~", approx: "~", times: "×", pm: "±",
  textbackslash: "\\", textasciitilde: "~", textunderscore: "_",
  quad: " ", qquad: " ", space: " ", nobreakspace: " ",
  bullet: "•", cdot: "·", dag: "†", copyright: "©",
  degree: "°", euro: "€", pounds: "£",
};

// Environments whose contents are not body text.
const SKIPPED_ENVIRONMENTS = new Set([
  "tikzpicture", "picture", "filecontents", "comment", "verbatim", "lstlisting",
]);

// Commands that break the line where they appear.
const BREAK_COMMANDS = new Set([
  "item", "newline", "linebreak", "par", "hfill", "vspace", "bigskip",
  "medskip", "smallskip", "cr", "hline", "toprule", "midrule", "bottomrule",
]);

// Of those, the ones whose braced argument is a measurement to discard. \item
// must not be here: "\item{...}" is a real form, and skipping its group deleted
// an entire skills section on the template this was first tried against.
const LENGTH_ARGUMENT_COMMANDS = new Set([
  "vspace", "hspace", "vskip", "hskip", "addvspace",
]);

function isLetter(char: string): boolean {
  return /[a-zA-Z]/.test(char);
}

/** Reads a {...} group starting at an opening brace, honouring nesting. */
function matchGroup(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractLatexText(source: string): LatexExtraction {
  const nodes: LatexTextNode[] = [];
  const issues: string[] = [];
  const includes: string[] = [];
  const out: string[] = [];

  // Everything before \begin{document} configures the class; none of it is
  // resume content. Files without a document environment are treated as a
  // fragment and read whole.
  const documentStart = source.indexOf("\\begin{document}");
  const bodyStart =
    documentStart >= 0 ? documentStart + "\\begin{document}".length : 0;
  const documentEnd = source.indexOf("\\end{document}");
  const bodyEnd = documentEnd >= 0 ? documentEnd : source.length;

  let literalStart = -1;
  let literalEnd = -1;
  let literal = "";
  /** Whether the previous significant character closed a group. */
  let closedGroup = false;

  const flush = () => {
    if (literal.trim()) {
      nodes.push({ text: literal, start: literalStart, end: literalEnd });
      out.push(literal);
    } else if (literal) {
      out.push(literal);
    }
    literal = "";
    literalStart = -1;
    literalEnd = -1;
  };

  // srcEnd is tracked explicitly rather than derived from the text length: an
  // escape consumes two source characters to emit one ("\&"), and \ldots
  // consumes six to emit one, so offsets computed from the output would drift
  // and every anchor after the first escape would point at the wrong bytes.
  const pushLiteral = (value: string, srcStart: number, srcEnd: number) => {
    if (literalStart < 0) literalStart = srcStart;
    literalEnd = srcEnd;
    literal += value;
    // Real content between two groups already separates them.
    closedGroup = false;
  };

  const breakLine = () => {
    flush();
    closedGroup = false;
    if (out.length && !out[out.length - 1].endsWith("\n")) out.push("\n");
  };

  let i = bodyStart;
  while (i < bodyEnd) {
    const char = source[i];

    // Comment: everything to the end of the line, unless the % was escaped.
    if (char === "%") {
      flush();
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? bodyEnd : newline + 1;
      continue;
    }

    if (char === "\\") {
      const next = source[i + 1] ?? "";
      // A control symbol: one non-letter character.
      if (next && !isLetter(next)) {
        const literalValue = LITERAL_COMMANDS[next];
        if (literalValue === "\n") breakLine();
        else if (literalValue !== undefined) pushLiteral(literalValue, i, i + 2);
        i += 2;
        continue;
      }

      const commandStart = i;
      let end = i + 1;
      while (end < bodyEnd && isLetter(source[end])) end += 1;
      const name = source.slice(i + 1, end);
      i = end;
      // A starred variant is the same command for our purposes.
      if (source[i] === "*") i += 1;

      if (name === "begin" || name === "end") {
        const braceOpen = source.indexOf("{", i);
        const braceClose = braceOpen >= 0 ? matchGroup(source, braceOpen) : -1;
        const environment =
          braceOpen >= 0 && braceClose > braceOpen
            ? source.slice(braceOpen + 1, braceClose)
            : "";
        i = braceClose >= 0 ? braceClose + 1 : i;
        if (name === "begin" && SKIPPED_ENVIRONMENTS.has(environment)) {
          const closing = source.indexOf(`\\end{${environment}}`, i);
          i = closing < 0 ? bodyEnd : closing + `\\end{${environment}}`.length;
        }
        breakLine();
        continue;
      }

      if (name === "input" || name === "include") {
        const braceOpen = source.indexOf("{", i);
        const braceClose = braceOpen >= 0 ? matchGroup(source, braceOpen) : -1;
        if (braceClose > braceOpen) {
          includes.push(source.slice(braceOpen + 1, braceClose).trim());
          i = braceClose + 1;
        }
        continue;
      }

      if (LITERAL_COMMANDS[name] !== undefined) {
        pushLiteral(LITERAL_COMMANDS[name], commandStart, i);
        // A control word swallows the whitespace that terminates it.
        while (i < bodyEnd && /[ \t]/.test(source[i])) i += 1;
        continue;
      }

      if (BREAK_COMMANDS.has(name)) {
        breakLine();
        if (LENGTH_ARGUMENT_COMMANDS.has(name) && source[i] === "{") {
          const close = matchGroup(source, i);
          if (close > i) i = close + 1;
        }
        continue;
      }

      // \href{target}{label} renders as the label alone, so that is what every
      // other input format yields for the same document. Emitting the target as
      // well produced "mailto:x@y.edu x@y.edu" in the extracted text.
      if (name === "href" && source[i] === "{") {
        const close = matchGroup(source, i);
        if (close > i) i = close + 1;
        continue;
      }

      // Anything else: drop the command, keep its arguments. Custom resume
      // macros — \resumeSubheading{Role}{Dates}{Company}{Location} and friends
      // — carry all their content this way, so discarding arguments would
      // discard most of the document.
      if (BLOCK_COMMANDS.has(name.toLowerCase())) breakLine();
      while (i < bodyEnd && /[ \t]/.test(source[i])) i += 1;
      // Optional arguments are formatting, not content.
      while (source[i] === "[") {
        const close = source.indexOf("]", i);
        if (close < 0) break;
        i = close + 1;
        while (i < bodyEnd && /[ \t]/.test(source[i])) i += 1;
      }
      continue;
    }

    if (char === "}") {
      flush();
      closedGroup = true;
      i += 1;
      continue;
    }

    if (char === "{") {
      // Consecutive groups are separate macro arguments — the four fields of
      // \resumeSubheading{Role}{Dates}{Company}{Location} are not one word.
      // Anything with real whitespace between them already separates itself,
      // and "\textbf{Py}thon" must stay a single word.
      //
      // Punctuation that binds to the left is the exception: skill lines are
      // written "\textbf{Languages}{: Python, Go}", and a separator there gives
      // "Languages : Python", which no longer looks like the labelled list the
      // parser is asked to recognise.
      const following = source.slice(i + 1).match(/^\s*(\S)/)?.[1] ?? "";
      if (closedGroup && !":,;.!?)%".includes(following)) out.push(" ");
      flush();
      closedGroup = false;
      i += 1;
      continue;
    }

    if (char === "&" || char === "~") {
      // A tabular column break and a non-breaking space both read as a space.
      pushLiteral(" ", i, i + 1);
      i += 1;
      continue;
    }

    if (char === "$") {
      // Inline maths still contains readable content in a resume ("$\sim$40%"),
      // so only the delimiter is dropped.
      flush();
      i += source[i + 1] === "$" ? 2 : 1;
      continue;
    }

    if (char === "\n") {
      flush();
      out.push("\n");
      i += 1;
      continue;
    }

    pushLiteral(char, i, i + 1);
    i += 1;
  }
  flush();

  if (includes.length) {
    issues.push(
      `This file pulls in ${includes.length} other file(s) with \\input or \\include (${includes
        .slice(0, 3)
        .join(", ")}${includes.length > 3 ? ", …" : ""}). Upload a single self-contained .tex.`,
    );
  }
  if (documentStart < 0) {
    issues.push("No \\begin{document} was found; the file was read as a fragment.");
  }

  const text = out
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, nodes, issues, includes };
}
