// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Format-preserving LaTeX export. The optimized wording is spliced into the
// ranges of the user's own .tex; the preamble, custom macros, spacing, and
// every untouched line stay byte-identical, so the file still compiles as the
// document they wrote. We deliberately do not compile it here — that needs a
// TeX distribution, which does not fit this deployment.
import { NextRequest, NextResponse } from "next/server";
import { requirePaidOrder } from "@/lib/entitlement";
import { rateLimitGuard } from "@/lib/ratelimit";
import { parseTexBlocks } from "@/lib/tex/blocks";
import { planTexEdits } from "@/lib/tex/plan";
import { applyTexEdits } from "@/lib/tex/rewrite";
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
    const source = decoded.toString("utf8");

    const blocks = parseTexBlocks(source);
    const plan = planTexEdits({
      resume,
      optimization,
      blocks,
      includeSummary: includeSummary !== false,
    });

    if (plan.edits.length === 0) {
      return NextResponse.json(
        {
          error:
            "None of the optimized wording could be matched to the original source. Download the rebuilt PDF instead.",
          unplaced: plan.unplaced.slice(0, 12),
        },
        { status: 409 },
      );
    }

    const result = applyTexEdits(source, blocks, plan.edits);
    const filename = safeFilename(resume.name, targetTitle || "");
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_");

    return new NextResponse(result.source, {
      status: 200,
      headers: {
        "Content-Type": "application/x-tex; charset=utf-8",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Resume-Edits-Applied": String(result.applied.length),
        "X-Resume-Edits-Skipped": String(result.skipped.length),
        "X-Resume-Edits-Unplaced": String(plan.unplaced.length),
        "X-Resume-Edit-Coverage": plan.coverage.toFixed(2),
      },
    });
  } catch (e) {
    console.error("tex export failed", e);
    const message = e instanceof Error ? e.message : "LaTeX export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
