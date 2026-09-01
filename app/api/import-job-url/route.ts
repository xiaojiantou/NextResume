// Copyright (c) 2026 HowBe LLC. All rights reserved.

import dns from "node:dns/promises";
import net from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { extractJobPageText } from "@/lib/jobPageText";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

// One budget for the whole import, shared across redirect hops, so a stalled
// job page can't hold the function open until Vercel kills it at maxDuration
// (which surfaces as a real 502 and bills the full 30s).
const TOTAL_FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;

function normalizeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

// --- SSRF guard -----------------------------------------------------------
// This route fetches a caller-supplied URL from inside our own network, so
// every hop has to be proven to point at a public address first. Anything
// unparseable fails closed.

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments, TEST-NET-1
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split("%")[0]; // drop any zone id
  if (addr === "::1" || addr === "::") return true;
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms tunnel v4 ranges.
  const mapped = addr.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const head = Number.parseInt(addr.split(":")[0] || "0", 16);
  if (!Number.isFinite(head)) return true;
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

function isPrivateAddress(address: string, family: number): boolean {
  return family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
}

// Resolves the hostname and requires *every* answer to be public — a name that
// returns one public and one internal address is rejected.
//
// Caveat: there's still a DNS-rebinding window between this check and the
// fetch, since fetch() re-resolves the name itself. Closing that needs the
// connection pinned to the vetted IP, which fetch() doesn't expose. This stops
// the practical cases (IP literals, internal hostnames, redirect-to-internal);
// it is not airtight against an attacker actively flipping a DNS record.
async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, ""); // unwrap IPv6 literal
  const literal = net.isIP(host);
  if (literal) return !isPrivateAddress(host, literal);

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0) return false;
    return records.every((r) => !isPrivateAddress(r.address, r.family));
  } catch {
    return false;
  }
}

type FetchOutcome =
  | { kind: "ok"; res: Response; finalUrl: URL }
  | { kind: "blocked" }
  | { kind: "too-many-redirects" };

// Redirects are followed by hand so each hop can be re-checked; `redirect:
// "follow"` would let a public URL bounce us into the private network.
async function fetchJobPage(start: URL): Promise<FetchOutcome> {
  const signal = AbortSignal.timeout(TOTAL_FETCH_TIMEOUT_MS);
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!(await isPublicHost(url.hostname))) return { kind: "blocked" };

    const res = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (compatible; NextResume/0.1; +https://nextresume.local)",
      },
      redirect: "manual",
      signal,
    });

    if (res.status < 300 || res.status >= 400) {
      return { kind: "ok", res, finalUrl: url };
    }

    const location = res.headers.get("location");
    if (!location) return { kind: "ok", res, finalUrl: url };

    const next = normalizeUrl(new URL(location, url).toString());
    if (!next) return { kind: "blocked" };
    url = next;
  }

  return { kind: "too-many-redirects" };
}

// --- Login/consent wall detection ----------------------------------------
// A walled page is a 200 with plenty of HTML, so status and length can't tell
// it apart from a real posting. LinkedIn's guest wall imports as nav chrome
// and puzzle-game names — which then flows into parse-job and the paid rewrite
// as if it were the job description.

const JOB_SIGNALS = [
  "responsibilit",
  "qualification",
  "requirements",
  "what you'll do",
  "what you will do",
  "about the role",
  "about this role",
  "job description",
  "years of experience",
  "we're looking for",
  "we are looking for",
  "compensation",
  "salary range",
  "benefits",
];

const WALL_SIGNALS = [
  "sign in",
  "log in",
  "agree & join",
  "create account",
  "enable javascript",
  "verify you are human",
  "are you a robot",
  "captcha",
  "access denied",
  "unusual traffic",
];

function looksLikeWall(text: string): boolean {
  const haystack = text.toLowerCase();
  const jobHits = JOB_SIGNALS.filter((s) => haystack.includes(s)).length;
  // Two independent job signals is strong enough to accept regardless of a
  // stray "sign in" in the page header.
  if (jobHits >= 2) return false;
  return WALL_SIGNALS.some((s) => haystack.includes(s));
}

const PASTE_INSTEAD = "Copy the job description and paste it instead.";

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.importJobUrl);
  if (rl) return rl;
  try {
    const { url: rawUrl } = (await req.json()) as { url?: string };
    const url = normalizeUrl(rawUrl || "");

    if (!url) {
      return NextResponse.json(
        { error: "Enter a valid http or https job posting URL." },
        { status: 400 },
      );
    }

    let outcome: FetchOutcome;
    try {
      outcome = await fetchJobPage(url);
    } catch (fetchError) {
      // A timeout here is the page stalling on us, not our bug — say so
      // rather than letting it read as a server fault.
      if (
        fetchError instanceof Error &&
        (fetchError.name === "TimeoutError" || fetchError.name === "AbortError")
      ) {
        return NextResponse.json(
          { error: `That job page took too long to respond. ${PASTE_INSTEAD}` },
          { status: 422 },
        );
      }
      return NextResponse.json(
        { error: `Could not reach that job page. ${PASTE_INSTEAD}` },
        { status: 422 },
      );
    }

    if (outcome.kind === "blocked") {
      return NextResponse.json(
        { error: "That URL does not point at a public web address." },
        { status: 400 },
      );
    }

    if (outcome.kind === "too-many-redirects") {
      return NextResponse.json(
        { error: `That URL redirected too many times. ${PASTE_INSTEAD}` },
        { status: 422 },
      );
    }

    const { res, finalUrl } = outcome;

    if (!res.ok) {
      // The job board refusing us is not a gateway failure of ours. 422 keeps
      // the 5xx rate meaningful and stops a routine block from logging as an
      // outage.
      const blocking = res.status === 403 || res.status === 429;
      return NextResponse.json(
        {
          error: blocking
            ? `${finalUrl.hostname} blocks automated imports. ${PASTE_INSTEAD}`
            : `The job page returned ${res.status}. ${PASTE_INSTEAD}`,
        },
        { status: 422 },
      );
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return NextResponse.json(
        { error: "That URL did not return a readable HTML job page." },
        { status: 415 },
      );
    }

    const html = await res.text();
    const text = extractJobPageText(html).slice(0, 20000);

    if (text.length < 200) {
      return NextResponse.json(
        { error: `Could not extract enough text. ${PASTE_INSTEAD}` },
        { status: 422 },
      );
    }

    if (looksLikeWall(text)) {
      return NextResponse.json(
        {
          error: `${finalUrl.hostname} served a sign-in page instead of the posting. ${PASTE_INSTEAD}`,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({ text, sourceUrl: finalUrl.toString() });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not import from that job URL.",
      },
      { status: 500 },
    );
  }
}
