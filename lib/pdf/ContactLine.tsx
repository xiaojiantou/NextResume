// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The contact line, shared by every fixed template. Links render as real
// <Link> elements so the exported PDF carries clickable annotations rather
// than dead text — the same layer we now read back out of uploaded resumes.
import { Link, Text } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { ResumeLink } from "../resumeLinks";
import { normalizeResumeLinks } from "../resumeLinks";

export type ContactEntry = {
  key: string;
  label: string;
  url?: string;
};

/** Contact values and links as one ordered, de-duplicated list. */
export function contactEntries(
  values: ReadonlyArray<string | undefined | null>,
  links: unknown,
): ContactEntry[] {
  const entries: ContactEntry[] = [];
  for (const value of values) {
    const label = (value ?? "").trim();
    if (label) entries.push({ key: `v:${label}`, label });
  }
  for (const link of normalizeResumeLinks(links)) {
    entries.push({ key: `l:${link.label}`, label: link.label, url: link.url });
  }
  return entries;
}

/**
 * A link keeps the surrounding text's colour and weight on purpose. The
 * default blue underline would redesign a header the user never asked us to
 * change, and recruiters print these.
 */
export function ContactText({
  entries,
  separator,
  style,
  linkStyle,
}: {
  entries: readonly ContactEntry[];
  separator: string;
  style?: Style | Style[];
  linkStyle?: Style | Style[];
}) {
  if (entries.length === 0) return null;
  return (
    <Text style={style}>
      {entries.map((entry, index) => (
        <Text key={entry.key}>
          {index > 0 ? separator : ""}
          {entry.url ? (
            <Link src={entry.url} style={linkStyle}>
              {entry.label}
            </Link>
          ) : (
            entry.label
          )}
        </Text>
      ))}
    </Text>
  );
}
