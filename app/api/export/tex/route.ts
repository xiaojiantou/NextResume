// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Format-preserving LaTeX export. The optimized wording is spliced into the
// ranges of the user's own .tex; the preamble, custom macros, spacing, and
// every untouched line stay byte-identical, so the file still compiles as the
// document they wrote. We deliberately do not compile it here — that needs a
// TeX distribution, which does not fit this deployment.
import { NextRequest, NextResponse } from "next/server";
import { requirePaidOrder } from "@/lib/entitlement";
import { rateLimitGuard } from "@/lib/ratelimit";
import { buildEditedTex, NoTexEditsError } from "@/lib/tex/export";
import type { Optimization, Resume } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const EXPORT_LIMIT = {
  key: "export-tex",
  limit: 10,
  windowMs: 60_000,
};

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

function safeFilename(name: string, target: string): string {
  const base = (name || "resume").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  const suffix = (target || "").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  return `${[base || "resume", suffix].filter(Boolean).join(" — ")}.tex`;
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, EXPORT_LIMIT);
  if (rl) return rl;

  const entitlement = await requirePaidOrder(req);
  if (!entitlement.ok) return entitlement.response;

  try {
    const { resume, optimization, sourceTex, targetTitle, includeSummary } =
      (await req.json()) as {
        resume: Resume;
        optimization: Optimization | null;
        sourceTex: string;
        targetTitle?: string;
        includeSummary?: boolean;
      };

    if (!resume?.name || !Array.isArray(resume.experience)) {
      return NextResponse.json(
        { error: "Missing or invalid resume." },
        { status: 400 },
      );
    }
    if (!optimization) {
      return NextResponse.json(
        { error: "Optimize the resume before exporting it." },
        { status: 400 },
      );
    }
    if (typeof sourceTex !== "string" || !sourceTex) {
      return NextResponse.json(
        {
          error:
            "The original LaTeX source is no longer available. Paste it again to keep your formatting.",
        },
        { status: 400 },
      );
    }

    const decoded = Buffer.from(sourceTex, "base64");
    if (decoded.length === 0 || decoded.length > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        { error: "The original LaTeX source could not be read." },
        { status: 400 },
      );
    }
    let edited;
    try {
      edited = buildEditedTex({
        resume,
        optimization,
        source: decoded.toString("utf8"),
        includeSummary: includeSummary !== false,
      });
    } catch (error) {
      if (error instanceof NoTexEditsError) {
        return NextResponse.json(
          {
            error: `${error.message} Download the rebuilt PDF instead.`,
            unplaced: error.unplaced.slice(0, 12),
          },
          { status: 409 },
        );
      }
      throw error;
    }

    const filename = safeFilename(resume.name, targetTitle || "");
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_");

    return new NextResponse(edited.source, {
      status: 200,
      headers: {
        "Content-Type": "application/x-tex; charset=utf-8",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Resume-Edits-Applied": String(edited.applied.length),
        "X-Resume-Edits-Skipped": String(edited.skipped.length),
        "X-Resume-Edits-Unplaced": String(edited.unplaced.length),
        "X-Resume-Edit-Coverage": edited.coverage.toFixed(2),
        "X-Resume-Skills-Omitted": encodeURIComponent(
          edited.skillsOmitted.slice(0, 20).join(", "),
        ),
      },
    });
  } catch (e) {
    console.error("tex export failed", e);
    const message = e instanceof Error ? e.message : "LaTeX export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
