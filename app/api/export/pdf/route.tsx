import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { ResumePdf } from "@/lib/pdf/ResumePdf";
import { rateLimitGuard } from "@/lib/ratelimit";
import type { Optimization, Resume } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const EXPORT_LIMIT = {
  key: "export-pdf",
  limit: 10,
  windowMs: 60_000,
};

function safeFilename(name: string, target: string): string {
  const base = (name || "resume").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  const suffix = (target || "").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  const parts = [base || "resume", suffix].filter(Boolean).join(" — ");
  return `${parts}.pdf`;
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, EXPORT_LIMIT);
  if (rl) return rl;

  try {
    const { resume, optimization, targetTitle } = (await req.json()) as {
      resume: Resume;
      optimization: Optimization | null;
      targetTitle?: string;
    };

    if (!resume?.name || !Array.isArray(resume.experience)) {
      return NextResponse.json(
        { error: "Missing or invalid resume." },
        { status: 400 },
      );
    }

    const buffer = await renderToBuffer(
      <ResumePdf resume={resume} optimization={optimization} />,
    );

    const filename = safeFilename(resume.name, targetTitle || "");
    // Use ASCII-only fallback for Content-Disposition to avoid header issues.
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_");

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("pdf export failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PDF export failed" },
      { status: 500 },
    );
  }
}
