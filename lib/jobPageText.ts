// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Pulls the job description out of a fetched job-posting page.
//
// Stripping tags off the raw HTML only works for server-rendered postings. The
// large ATS vendors — Ashby, Lever, Greenhouse's embedded boards, Workday —
// ship a near-empty HTML shell and hydrate on the client, so tag-stripping
// yields the page title and nothing else. An Ashby posting measured 29KB of
// HTML and 37 characters of visible text; its 5,000-character description sat
// in a `window.__appData` script blob, which is the first thing the stripper
// deletes.
//
// So we look for the description in structured data first (schema.org
// JobPosting, then the JSON blobs those SPAs bootstrap from) and only fall
// back to tag-stripping when neither carries a substantive body.

// Below this a "description" is a nav label or a meta blurb, not a posting.
const MIN_USEFUL_LENGTH = 200;

// Ordered most- to least-specific. `description` is last because it is also a
// generic meta field; anything it wins on is a page with nothing better.
const DESCRIPTION_KEYS = [
  "descriptionPlainText",
  "descriptionHtml",
  "jobDescription",
  "descriptionBody",
  "description",
];

// Guards against a pathological page turning extraction into a scan storm.
const MAX_MATCHES_PER_KEY = 20;
const MAX_WALK_DEPTH = 8;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Ampersand last, so "&amp;lt;" does not decode twice into a tag.
    .replace(/&amp;/g, "&");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|section|article|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walk(node: unknown, depth: number, visit: (o: Record<string, unknown>) => void) {
  if (depth > MAX_WALK_DEPTH || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, depth + 1, visit);
    return;
  }
  const obj = node as Record<string, unknown>;
  visit(obj);
  for (const value of Object.values(obj)) walk(value, depth + 1, visit);
}

// schema.org JobPosting, the one format several boards agree on. The node can
// be nested inside an @graph, and @type is sometimes an array.
function fromLinkedData(html: string): string[] {
  const out: string[] = [];
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(decodeEntities(block[1]).trim());
    } catch {
      continue;
    }
    walk(data, 0, (obj) => {
      const type = obj["@type"];
      const isPosting = Array.isArray(type)
        ? type.includes("JobPosting")
        : type === "JobPosting";
      if (isPosting && typeof obj.description === "string") out.push(obj.description);
    });
  }
  return out;
}

// Reads `"key": "..."` out of a JSON blob without parsing the blob. The
// bootstrap payloads these pages embed are megabyte-scale and frequently sit
// next to other statements in the same <script>, so JSON.parse on the whole
// thing is both wasteful and fragile — a targeted scan that honours backslash
// escapes gets the one field we want.
function readJsonStrings(source: string, key: string): string[] {
  const out: string[] = [];
  const needle = `"${key}"`;
  let from = 0;

  while (out.length < MAX_MATCHES_PER_KEY) {
    const at = source.indexOf(needle, from);
    if (at < 0) break;
    from = at + needle.length;

    let i = from;
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== ":") continue;
    i++;
    while (i < source.length && /\s/.test(source[i])) i++;
    // Not a string value (null, an object, a number) — skip to the next hit.
    if (source[i] !== '"') continue;
    i++;

    const start = i;
    while (i < source.length) {
      if (source[i] === "\\") {
        i += 2;
        continue;
      }
      if (source[i] === '"') break;
      i++;
    }
    if (i >= source.length) break;

    try {
      out.push(JSON.parse(`"${source.slice(start, i)}"`) as string);
    } catch {
      // A malformed escape run; the next key is still worth trying.
    }
    from = i;
  }

  return out;
}

function fromEmbeddedJson(html: string): string[] {
  const out: string[] = [];
  for (const key of DESCRIPTION_KEYS) out.push(...readJsonStrings(html, key));
  return out;
}

function pageTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']*)["']/i,
  );
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const tag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tag?.[1]) return htmlToText(tag[1]);
  return "";
}

/**
 * Best-effort job description text for a fetched posting page. Returns the
 * empty string when the page carries nothing usable; callers decide what
 * counts as enough.
 */
export function extractJobPageText(html: string): string {
  let best = "";
  for (const candidate of [...fromLinkedData(html), ...fromEmbeddedJson(html)]) {
    const text = htmlToText(candidate);
    if (text.length > best.length) best = text;
  }

  // A structured body this short is a meta blurb, not a posting — the visible
  // page is the better guess, even if it comes with nav and footer noise.
  if (best.length < MIN_USEFUL_LENGTH) {
    const visible = htmlToText(html);
    return visible.length > best.length ? visible : best;
  }

  // The structured body is the description alone, so it usually omits the role
  // name that downstream matching needs.
  const title = pageTitle(html);
  return title && !best.slice(0, 200).includes(title) ? `${title}\n\n${best}` : best;
}
