import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function normalizeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { url: rawUrl } = (await req.json()) as { url?: string };
    const url = normalizeUrl(rawUrl || "");

    if (!url) {
      return NextResponse.json(
        { error: "Enter a valid http or https job posting URL." },
        { status: 400 },
      );
    }

    const res = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent":
          "Mozilla/5.0 (compatible; NextResume/0.1; +https://nextresume.local)",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `The job page returned ${res.status}. Try pasting the JD.` },
        { status: 502 },
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
    const text = htmlToText(html).slice(0, 20000);

    if (text.length < 200) {
      return NextResponse.json(
        { error: "Could not extract enough text. Try pasting the JD." },
        { status: 422 },
      );
    }

    return NextResponse.json({ text, sourceUrl: url.toString() });
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
