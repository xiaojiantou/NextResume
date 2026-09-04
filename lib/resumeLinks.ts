// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The resume link model. A link has a label the reader sees and, when we can
// recover it, the target behind it. Those are genuinely different things: a
// PDF header often shows the word "LinkedIn" while the URL lives only in the
// file's annotation layer, so a plain string can never represent both.
//
// Resumes persisted before links carried targets stored plain strings, so
// every reader normalizes through here rather than trusting the shape.

export type ResumeLink = {
  /** What the resume displays, e.g. "LinkedIn" or "github.com/jane". */
  label: string;
  /** Absolute target, when known. Absent for a label we could not resolve. */
  url?: string;
};

// Deliberately conservative: it must not treat "React.js" or "Node.js" as a
// site. A bare domain needs a known multi-character TLD, and anything with a
// scheme or a www prefix is taken at face value.
const URL_PATTERN =
  /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ai|co|me|app|edu|gov|xyz|page|site|tech|design|studio)\b(?:\/[^\s<>()[\]{}"']*)?/gi;

const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/;
const LABEL_ONLY_PROFILE =
  /^(linkedin|linked\s*in|github|gitlab|portfolio|website|personal website|personal site|homepage|profile|github profile|linkedin profile)$/i;
const PROFILE_LABEL_HINT =
  /\b(linkedin|linked\s*in|github|gitlab|portfolio|website|homepage|profile)\b/i;

export function normalizeLinkUrl(value: string): string | undefined {
  const trimmed = value.trim().replace(TRAILING_PUNCTUATION, "");
  if (!trimmed) return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    // mailto: and tel: belong to the email and phone fields, not links.
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!url.hostname.includes(".")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * A compact, resume-style label for a bare URL: no scheme, no "www.", no
 * trailing slash. "https://www.linkedin.com/in/jane/" reads as
 * "linkedin.com/in/jane".
 */
export function labelForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}${parsed.hash}`;
  } catch {
    return url;
  }
}

function plausibleLabelOnlyLink(label: string): boolean {
  const clean = label.trim();
  if (!clean || clean.length > 48) return false;
  if (/[,:;•·|]/.test(clean)) return false;
  return LABEL_ONLY_PROFILE.test(clean) || PROFILE_LABEL_HINT.test(clean);
}

function safeDisplayLabel(label: string, url?: string): string {
  const clean = label.trim();
  if (!url) return plausibleLabelOnlyLink(clean) ? clean : "";
  if (clean.length > 72 || /[,:;•·|]/.test(clean)) return labelForUrl(url);
  return clean || labelForUrl(url);
}

function sameTarget(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  const strip = (value: string) =>
    value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  return strip(left) === strip(right);
}

/** Accepts legacy `string[]`, current `ResumeLink[]`, or anything at all. */
export function normalizeResumeLinks(value: unknown): ResumeLink[] {
  if (!Array.isArray(value)) return [];
  const links: ResumeLink[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const label = entry.trim();
      if (!label) continue;
      const url = normalizeLinkUrl(label);
      const displayLabel = safeDisplayLabel(label, url);
      if (displayLabel) {
        links.push(url ? { label: displayLabel, url } : { label: displayLabel });
      }
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { label?: unknown; url?: unknown };
    const url =
      typeof candidate.url === "string"
        ? normalizeLinkUrl(candidate.url)
        : undefined;
    const rawLabel =
      typeof candidate.label === "string" ? candidate.label.trim() : "";
    const label = safeDisplayLabel(rawLabel || (url ? labelForUrl(url) : ""), url);
    if (!label) continue;
    links.push(url ? { label, url } : { label });
  }
  return dedupeResumeLinks(links);
}

export function dedupeResumeLinks(links: readonly ResumeLink[]): ResumeLink[] {
  const result: ResumeLink[] = [];
  for (const link of links) {
    const existing = result.find(
      (candidate) =>
        sameTarget(candidate.url, link.url) ||
        candidate.label.toLowerCase() === link.label.toLowerCase(),
    );
    if (!existing) {
      result.push({ ...link });
      continue;
    }
    // A later entry may carry the target an earlier label was missing.
    if (!existing.url && link.url) existing.url = link.url;
  }
  return result;
}

/**
 * Recovered targets win over parsed labels: the annotation layer is ground
 * truth, while a label is whatever the model read off the page. Labels the
 * user actually sees are preserved, so "LinkedIn" does not become
 * "linkedin.com/in/jane" just because we learned the URL.
 */
export function mergeResumeLinks(
  parsed: readonly ResumeLink[],
  recovered: readonly ResumeLink[],
): ResumeLink[] {
  const merged = parsed.map((link) => ({ ...link }));
  for (const link of recovered) {
    const byTarget = merged.find((candidate) =>
      sameTarget(candidate.url, link.url),
    );
    if (byTarget) continue;
    const byLabel = merged.find(
      (candidate) =>
        !candidate.url &&
        candidate.label.toLowerCase() === link.label.toLowerCase(),
    );
    if (byLabel) {
      byLabel.url = link.url;
      continue;
    }
    merged.push({ ...link });
  }
  return dedupeResumeLinks(merged);
}

/**
 * Last-resort recovery for PDFs with no annotation layer — scanned files, or
 * exports that flattened their links. A visible "github.com/jane" is still a
 * usable target even when nothing in the file says so.
 */
export function linkifyText(text: string): ResumeLink[] {
  const links: ResumeLink[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    // Every resume carries an email, and its domain is not a profile link:
    // "sharon@example.com" must not surface as "example.com".
    if (/[A-Za-z0-9._%+-]@$/.test(text.slice(Math.max(0, index - 64), index))) {
      continue;
    }
    const raw = match[0].replace(TRAILING_PUNCTUATION, "");
    const url = normalizeLinkUrl(raw);
    if (!url) continue;
    links.push({ label: raw.replace(/^https?:\/\//i, ""), url });
  }
  return dedupeResumeLinks(links);
}

/** Flattens links to display strings for keyword scoring and plain-text views. */
export function resumeLinkLabels(links: readonly ResumeLink[]): string[] {
  return links.map((link) => link.label);
}
