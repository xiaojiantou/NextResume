// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Locates the rewritable text of a LaTeX resume as source ranges, so the
// optimized wording can be written back into the user's own .tex with the
// preamble, macros, and spacing left exactly as they wrote them.
//
// The scanner runs over the ORIGINAL source, skipping comments in place
// rather than stripping them, because every offset it reports has to index
// back into the file we are going to edit.
import {
  DISCARD_WITH_ARGUMENTS,
  ENVIRONMENTS_WITH_SPEC,
  latexToText,
  readArguments,
  readGroup,
  skipOptional,
} from "../latex.ts";

export type TexBlock = {
  index: number;
  /** Plain text, converted by the same reader the parser saw. */
  text: string;
  /** Source range, [start, end), guaranteed to contain balanced braces. */
  start: number;
  end: number;
  /** Blocks carrying a link are never rewritten; the target would be lost. */
  hasLink: boolean;
};

type OpenBlock = {
  start: number;
  baseDepth: number;
  lastLiteralEnd: number;
  lastLiteralDepth: number;
  hasLink: boolean;
};

const SECTION_COMMAND = /^(sub){0,2}section\*?$|^(sub)?paragraph\*?$|^chapter\*?$/;

/**
 * Walks forward over closing braces until `closers` of them have been seen.
 *
 * A block whose last text sits inside a group — the "B" of {A}{B} — would
 * otherwise end on an unbalanced range, and replacing it would orphan the
 * trailing brace and break the document.
 */
function extendToDepth(source: string, from: number, closers: number): number {
  let remaining = closers;
  let index = from;
  while (index < source.length && remaining > 0) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "}") remaining -= 1;
    index += 1;
  }
  return index;
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let back = index - 1; back >= 0 && source[back] === "\\"; back -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function parseTexBlocks(source: string): TexBlock[] {
  const documentStart = source.indexOf("\\begin{document}");
  const from =
    documentStart === -1
      ? 0
      : documentStart + "\\begin{document}".length;

  const blocks: TexBlock[] = [];
  const state: { open: OpenBlock | null } = { open: null };
  let depth = 0;
  let index = from;

  const close = () => {
    const open = state.open;
    if (!open) return;
    const end = extendToDepth(
      source,
      open.lastLiteralEnd,
      Math.max(0, open.lastLiteralDepth - open.baseDepth),
    );
    const slice = source.slice(open.start, end);
    const text = latexToText(slice).text;
    if (text) {
      blocks.push({
        index: blocks.length,
        text,
        start: open.start,
        end,
        hasLink: open.hasLink,
      });
    }
    state.open = null;
  };

  const addLiteral = (start: number, end: number): OpenBlock => {
    const open = state.open;
    if (!open) {
      const created: OpenBlock = {
        start,
        baseDepth: depth,
        lastLiteralEnd: end,
        lastLiteralDepth: depth,
        hasLink: false,
      };
      state.open = created;
      return created;
    }
    open.lastLiteralEnd = end;
    open.lastLiteralDepth = depth;
    return open;
  };

  while (index < source.length) {
    const character = source[index];

    if (character === "%" && !isEscaped(source, index)) {
      const lineEnd = source.indexOf("\n", index);
      index = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }

    if (character === "\\") {
      const nameMatch = source.slice(index + 1).match(/^[a-zA-Z@]+\*?/);

      if (!nameMatch) {
        const symbol = source[index + 1];
        if (symbol === "\\") {
          close();
          index = skipOptional(source, index + 2);
          continue;
        }
        // \% \& \$ and friends are literal characters of the resume.
        if (symbol !== undefined && "&%$#_{} -".includes(symbol)) {
          addLiteral(index, index + 2);
          index += 2;
          continue;
        }
        index += symbol === undefined ? 1 : 2;
        continue;
      }

      const name = nameMatch[0];
      let cursor = index + 1 + name.length;

      if (name === "begin" || name === "end") {
        close();
        const group = readGroup(source, cursor);
        if (group) {
          cursor = skipOptional(source, group.end);
          if (ENVIRONMENTS_WITH_SPEC.has(group.content.trim())) {
            const spec = readGroup(source, cursor);
            if (spec) cursor = skipOptional(source, spec.end);
          }
        }
        index = cursor;
        continue;
      }

      if (name === "item") {
        close();
        index = skipOptional(source, cursor);
        continue;
      }

      if (SECTION_COMMAND.test(name)) {
        close();
        index = cursor;
        continue;
      }

      if (name === "href" || name === "url" || name === "nolinkurl") {
        // Counts as content so the block's extent covers the visible label,
        // but the flag stops it from ever being rewritten.
        const { end } = readArguments(source, cursor, 2);
        addLiteral(index, end).hasLink = true;
        index = end;
        continue;
      }

      if (DISCARD_WITH_ARGUMENTS.has(name)) {
        const limit = name === "newcommand" || name === "renewcommand" ? 2 : 3;
        const { end } = readArguments(source, cursor, limit);
        index = end;
        continue;
      }

      // Presentational or a template macro: the command itself contributes no
      // text, and its braces are walked normally so the words inside count.
      index = skipOptional(source, cursor);
      continue;
    }

    if (character === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      // Falling out of the group the block began in ends it.
      if (state.open && depth < state.open.baseDepth) close();
      index += 1;
      continue;
    }

    // A blank line is a paragraph break in LaTeX, so it ends the block.
    if (character === "\n") {
      const following = source.slice(index + 1).match(/^[ \t]*\n/);
      if (following) close();
      index += 1;
      continue;
    }

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    addLiteral(index, index + 1);
    index += 1;
  }

  close();
  return blocks;
}
