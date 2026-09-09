// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Compiles the user's own .tex exactly as uploaded, so the Side-by-side view
// can show the original the way their template renders it, beside the
// optimized PDF. Nothing is edited here: the rewrite lives in ../pdf.
import { NextRequest, NextResponse } from "next/server";
import { requirePaidOrder } from "@/lib/entitlement";
import { rateLimitGuard } from "@/lib/ratelimit";
import { compileLatex, isLatexCompilerConfigured } from "@/lib/latexCompiler";

export const runtime = "nodejs";
export const maxDuration = 60;

// Same metering as the compiled export: this costs real CPU on a paid service.
const COMPILE_LIMIT = {
  key: "export-tex-original",
  limit: 5,
  windowMs: 60_000,
};

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, COMPILE_LIMIT);
  if (rl) return rl;

  if (!isLatexCompilerConfigured()) {
    return NextResponse.json(
      { error: "PDF compilation is not enabled here." },
      { status: 501 },
    );
  }

  const entitlement = await requirePaidOrder(req);
  if (!entitlement.ok) return entitlement.response;

  try {
    const { sourceTex } = (await req.json()) as { sourceTex?: string };
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

    const compiled = await compileLatex(decoded.toString("utf8"));
    if (!compiled.ok) {
      return NextResponse.json(
        { error: compiled.error, log: compiled.log },
        { status: compiled.status },
      );
    }

    return new NextResponse(compiled.pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(compiled.pdf.length),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("tex original compile failed", e);
    const message = e instanceof Error ? e.message : "LaTeX compile failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
