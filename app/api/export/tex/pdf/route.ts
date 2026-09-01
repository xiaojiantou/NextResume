// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Compiles the user's own .tex — after the optimized wording has been written
// into it — and returns the PDF. The edit step is shared with the .tex
// download, so the compiled output is always the same document.
import { NextRequest, NextResponse } from "next/server";
import { requirePaidOrder } from "@/lib/entitlement";
import { rateLimitGuard } from "@/lib/ratelimit";
import { buildEditedTex, NoTexEditsError } from "@/lib/tex/export";
import { compileLatex, isLatexCompilerConfigured } from "@/lib/latexCompiler";
import type { Optimization, Resume } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Compiling costs real CPU on a service we pay for, so it is metered harder
// than handing back a text file.
const COMPILE_LIMIT = {
  key: "export-tex-pdf",
  limit: 5,
  windowMs: 60_000,
};

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

function safeFilename(name: string, target: string): string {
  const base = (name || "resume").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  const suffix = (target || "").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  return `${[base || "resume", suffix].filter(Boolean).join(" — ")}.pdf`;
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, COMPILE_LIMIT);
  if (rl) return rl;

  if (!isLatexCompilerConfigured()) {
    return NextResponse.json(
      {
        error:
          "PDF compilation is not enabled here. Download the .tex and build it in Overleaf.",
      },
      { status: 501 },
    );
  }

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
        { error: "The original LaTeX source is no longer available." },
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
          { error: error.message, unplaced: error.unplaced.slice(0, 12) },
          { status: 409 },
        );
      }
      throw error;
    }

    const compiled = await compileLatex(edited.source);
    if (!compiled.ok) {
      return NextResponse.json(
        {
          error: compiled.error,
          // The TeX log is the only thing that explains a template we cannot
          // build, and it is the user's own document.
          log: compiled.log,
        },
        { status: compiled.status },
      );
    }

    const filename = safeFilename(resume.name, targetTitle || "");
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_");

    return new NextResponse(compiled.pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(compiled.pdf.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Resume-Edits-Applied": String(edited.applied.length),
        "X-Resume-Edits-Skipped": String(edited.skipped.length),
        "X-Resume-Edits-Unplaced": String(edited.unplaced.length),
      },
    });
  } catch (e) {
    console.error("tex pdf export failed", e);
    const message = e instanceof Error ? e.message : "LaTeX export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
