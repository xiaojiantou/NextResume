// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { ResumePdf } from "@/lib/pdf/ResumePdf";
import { ResumePdfSidebar } from "@/lib/pdf/ResumePdfSidebar";
import { ResumePdfMinimal } from "@/lib/pdf/ResumePdfMinimal";
import { renderPersonalizedPdf } from "@/lib/personalizedResume";
import { rateLimitGuard } from "@/lib/ratelimit";
import type { PdfStyle } from "@/lib/store";
import type {
  Optimization,
  Resume,
  ResumeStyleProfile,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

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

// Start with roomier variants so a short or medium resume uses the page
// gracefully. Then compact whitespace and leading before reducing type.
// A genuinely long resume is still allowed to span multiple pages.
const FIT_PRESETS = [
  { fontScale: 1.14, spacingScale: 1.42, lineHeightScale: 1.1 },
  { fontScale: 1.1, spacingScale: 1.3, lineHeightScale: 1.07 },
  { fontScale: 1.06, spacingScale: 1.18, lineHeightScale: 1.04 },
  { fontScale: 1.03, spacingScale: 1.09, lineHeightScale: 1.02 },
  { fontScale: 1, spacingScale: 1, lineHeightScale: 1 },
  { fontScale: 1, spacingScale: 0.9, lineHeightScale: 0.94 },
  { fontScale: 0.97, spacingScale: 0.82, lineHeightScale: 0.9 },
  { fontScale: 0.94, spacingScale: 0.74, lineHeightScale: 0.86 },
  { fontScale: 0.9, spacingScale: 0.67, lineHeightScale: 0.83 },
  { fontScale: 0.86, spacingScale: 0.61, lineHeightScale: 0.8 },
  { fontScale: 0.84, spacingScale: 0.56, lineHeightScale: 0.78 },
] as const;

async function renderFittedToOnePage(
  Template: typeof ResumePdf,
  resume: Resume,
  optimization: Optimization | null,
  includeSummary: boolean | undefined,
): Promise<Buffer> {
  let lastBuffer: Buffer | null = null;
  for (const fit of FIT_PRESETS) {
    const buffer = await renderToBuffer(
      <Template
        resume={resume}
        optimization={optimization}
        includeSummary={includeSummary}
        {...fit}
      />,
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
    const {
      resume,
      optimization,
      targetTitle,
      style,
      personalizedStyleProfile,
      includeSummary,
    } =
      (await req.json()) as {
        resume: Resume;
        optimization: Optimization | null;
        targetTitle?: string;
        style?: PdfStyle;
        personalizedStyleProfile?: ResumeStyleProfile | null;
        includeSummary?: boolean;
      };

    if (!resume?.name || !Array.isArray(resume.experience)) {
      return NextResponse.json(
        { error: "Missing or invalid resume." },
        { status: 400 },
      );
    }

    let buffer: Buffer;
    if (style === "personalized") {
      if (!personalizedStyleProfile) {
        return NextResponse.json(
          {
            error:
              "Personalized style is not ready. Regenerate it or choose another style.",
          },
          { status: 409 },
        );
      }
      buffer = await renderPersonalizedPdf({
        styleProfile: personalizedStyleProfile,
        resume,
        optimization,
        includeSummary,
      });
    } else {
      const Template =
        style === "sidebar"
          ? ResumePdfSidebar
          : style === "minimal"
            ? ResumePdfMinimal
            : ResumePdf;
      buffer = await renderFittedToOnePage(
        Template,
        resume,
        optimization,
        includeSummary,
      );
    }
    const pageCount = (await PDFDocument.load(buffer)).getPageCount();

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
        "X-Resume-Pages": String(pageCount),
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
