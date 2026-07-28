import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { ResumePdf } from "@/lib/pdf/ResumePdf";
import { ResumePdfSidebar } from "@/lib/pdf/ResumePdfSidebar";
import { ResumePdfMinimal } from "@/lib/pdf/ResumePdfMinimal";
import { rateLimitGuard } from "@/lib/ratelimit";
import type { PdfStyle } from "@/lib/store";
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

// Shrink font sizes + spacing a notch at a time and re-render until the
// resume fits on one page. Stops at SCALE_FLOOR to keep text readable —
// a genuinely long resume is allowed to spill onto a 2nd page rather than
// become illegibly tiny.
const FIT_SCALES = [1, 0.93, 0.87, 0.82];

async function renderFittedToOnePage(
  Template: typeof ResumePdf,
  resume: Resume,
  optimization: Optimization | null,
): Promise<Buffer> {
  let lastBuffer: Buffer | null = null;
  for (const scale of FIT_SCALES) {
    const buffer = await renderToBuffer(
      <Template resume={resume} optimization={optimization} scale={scale} />,
    );
    lastBuffer = buffer;
    const pageCount = (await PDFDocument.load(buffer)).getPageCount();
    if (pageCount <= 1) return buffer;
  }
  return lastBuffer!;
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, EXPORT_LIMIT);
  if (rl) return rl;

  try {
    const { resume, optimization, targetTitle, style } =
      (await req.json()) as {
        resume: Resume;
        optimization: Optimization | null;
        targetTitle?: string;
        style?: PdfStyle;
      };

    if (!resume?.name || !Array.isArray(resume.experience)) {
      return NextResponse.json(
        { error: "Missing or invalid resume." },
        { status: 400 },
      );
    }

    const Template =
      style === "sidebar"
        ? ResumePdfSidebar
        : style === "minimal"
          ? ResumePdfMinimal
          : ResumePdf;

    const buffer = await renderFittedToOnePage(Template, resume, optimization);

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
