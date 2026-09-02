// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Format-preserving export. Instead of rebuilding the resume in one of our
// templates, this writes the optimized wording back into the user's own .docx
// and returns that same file. Nothing is re-laid-out, so the document keeps
// its original typography, spacing, and hyperlinks by construction.
import { NextRequest, NextResponse } from "next/server";
import { requirePaidOrder } from "@/lib/entitlement";
import { rateLimitGuard } from "@/lib/ratelimit";
import { planDocxEdits } from "@/lib/docx/plan";
import { readDocxDocument, rewriteDocx } from "@/lib/docx/file";
import type { Optimization, Resume } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const EXPORT_LIMIT = {
  key: "export-docx",
  limit: 10,
  windowMs: 60_000,
};

// Resumes are tens of kilobytes; anything far past that is not one.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

function safeFilename(name: string, target: string): string {
  const base = (name || "resume").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  const suffix = (target || "").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  return `${[base || "resume", suffix].filter(Boolean).join(" — ")}.docx`;
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, EXPORT_LIMIT);
  if (rl) return rl;

  const entitlement = await requirePaidOrder(req);
  if (!entitlement.ok) return entitlement.response;

  try {
    const { resume, optimization, sourceDocx, targetTitle, includeSummary } =
      (await req.json()) as {
        resume: Resume;
        optimization: Optimization | null;
        sourceDocx: string;
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
    if (typeof sourceDocx !== "string" || !sourceDocx) {
      return NextResponse.json(
        {
          error:
            "The original Word file is no longer available. Re-upload it to keep your formatting.",
        },
        { status: 400 },
      );
    }

    const source = Buffer.from(sourceDocx, "base64");
    if (source.length === 0 || source.length > MAX_SOURCE_BYTES) {
      return NextResponse.json(
        { error: "The original Word file could not be read." },
        { status: 400 },
      );
    }
    // A .docx is a zip; every one starts "PK".
    if (source[0] !== 0x50 || source[1] !== 0x4b) {
      return NextResponse.json(
        { error: "That file is not a Word .docx document." },
        { status: 400 },
      );
    }

    const { paragraphs } = await readDocxDocument(source);
    const plan = planDocxEdits({
      resume,
      optimization,
      paragraphs,
      includeSummary: includeSummary !== false,
    });

    if (plan.edits.length === 0) {
      return NextResponse.json(
        {
          error:
            "None of the optimized wording could be matched to the original document. Download the rebuilt PDF instead.",
          unplaced: plan.unplaced.slice(0, 12),
        },
        { status: 409 },
      );
    }

    const { buffer, applied, skipped } = await rewriteDocx(source, plan.edits);
    const filename = safeFilename(resume.name, targetTitle || "");
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_");

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        // Lets the client tell the user exactly what kept its original wording.
        "X-Resume-Edits-Applied": String(applied.length),
        "X-Resume-Edits-Skipped": String(skipped.length),
        "X-Resume-Edits-Unplaced": String(plan.unplaced.length),
        "X-Resume-Edit-Coverage": plan.coverage.toFixed(2),
        // Skills the rebuilt PDF carries but a category-grouped Word document
        // has no unambiguous line for. Named, not just counted, so the client
        // can tell the user exactly what to add by hand.
        "X-Resume-Skills-Omitted": encodeURIComponent(
          plan.skillsOmitted.slice(0, 20).join(", "),
        ),
      },
    });
  } catch (e) {
    console.error("docx export failed", e);
    const message = e instanceof Error ? e.message : "Word export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
