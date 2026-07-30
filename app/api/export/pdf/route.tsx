// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { renderPersonalizedPdf } from "@/lib/personalizedResume";
import { rateLimitGuard } from "@/lib/ratelimit";
import {
  getResumePalette,
  isPdfStyle,
  normalizeTargetPages,
  type PdfStyle,
  type TargetPages,
} from "@/lib/pdf/config";
import { renderFixedFitted } from "@/lib/pdf/renderFixed";
import {
  defaultResumePage,
  type ResumeFitVariant,
} from "@/lib/resumeFit";
import type {
  Optimization,
  Resume,
  ResumePageSpec,
  ResumeStyleProfile,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

const EXPORT_LIMIT = {
  key: "export-pdf",
  limit: 10,
  windowMs: 60_000,
};

const PREVIEW_LIMIT = {
  key: "preview-pdf",
  limit: 30,
  windowMs: 60_000,
};

function safeFilename(name: string, target: string): string {
  const base = (name || "resume").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  const suffix = (target || "").trim().replace(/[^\p{L}\p{N}\-_ ]/gu, "");
  const parts = [base || "resume", suffix].filter(Boolean).join(" — ");
  return `${parts}.pdf`;
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(
    req,
    req.headers.get("x-resume-preview") === "1"
      ? PREVIEW_LIMIT
      : EXPORT_LIMIT,
  );
  if (rl) return rl;

  try {
    const {
      resume,
      optimization,
      targetTitle,
      style,
      palette,
      targetPages,
      pageSize,
      fitVariant,
      sourceRevision,
      personalizedStyleProfile,
      includeSummary,
    } = (await req.json()) as {
      resume: Resume;
      optimization: Optimization | null;
      targetTitle?: string;
      style?: PdfStyle;
      palette?: string;
      targetPages?: TargetPages;
      pageSize?: ResumePageSpec;
      fitVariant?: ResumeFitVariant | null;
      sourceRevision?: string;
      personalizedStyleProfile?: ResumeStyleProfile | null;
      includeSummary?: boolean;
    };

    if (!resume?.name || !Array.isArray(resume.experience)) {
      return NextResponse.json(
        { error: "Missing or invalid resume." },
        { status: 400 },
      );
    }

    const selectedStyle: PdfStyle = isPdfStyle(style) ? style : "classic";
    const selectedTargetPages = normalizeTargetPages(targetPages);
    const selectedPage = defaultResumePage(
      pageSize ?? personalizedStyleProfile?.page,
    );
    const usesFitVariant =
      selectedTargetPages !== "auto" && Boolean(fitVariant);
    if (usesFitVariant) {
      if (
        fitVariant!.sourceRevision !== sourceRevision ||
        fitVariant!.style !== selectedStyle ||
        fitVariant!.targetPages !== selectedTargetPages
      ) {
        return NextResponse.json(
          {
            error:
              "This fitted version is outdated. Fit the latest resume before downloading.",
          },
          { status: 409 },
        );
      }
    }
    const effectiveResume = fitVariant?.fittedResume ?? resume;
    const effectiveOptimization =
      fitVariant?.fittedOptimization ?? optimization;
    let buffer: Buffer;
    let density = "source";
    let desiredPages =
      selectedTargetPages === "auto" ? "auto" : String(selectedTargetPages);
    let overflow = false;

    if (selectedStyle === "personalized") {
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
        resume: effectiveResume,
        optimization: effectiveOptimization,
        includeSummary,
        targetPages: selectedTargetPages,
        allowMinimumTypography: usesFitVariant,
      });
    } else {
      const selectedPalette = getResumePalette(selectedStyle, palette);
      const fitted = await renderFixedFitted({
        style: selectedStyle,
        palette: selectedPalette,
        resume: effectiveResume,
        optimization: effectiveOptimization,
        includeSummary,
        page: selectedPage,
        targetPages: selectedTargetPages,
        requireExact: usesFitVariant,
      });
      if (usesFitVariant && !fitted.exact) {
        return NextResponse.json(
          {
            error: `The fitted version rendered as ${fitted.pageCount} pages instead of ${selectedTargetPages}. Refit before downloading.`,
          },
          { status: 409 },
        );
      }
      buffer = fitted.buffer;
      density = fitted.density;
      desiredPages = String(fitted.desiredPages);
      overflow = fitted.overflow;
    }
    const pageCount = (await PDFDocument.load(buffer)).getPageCount();
    if (
      selectedStyle === "personalized" &&
      selectedTargetPages !== "auto"
    ) {
      overflow = pageCount > selectedTargetPages;
    }
    if (usesFitVariant && pageCount !== selectedTargetPages) {
      return NextResponse.json(
        {
          error: `The fitted version rendered as ${pageCount} pages instead of ${selectedTargetPages}. Refit before downloading.`,
        },
        { status: 409 },
      );
    }

    const filename = safeFilename(effectiveResume.name, targetTitle || "");
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_");

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Resume-Pages": String(pageCount),
        "X-Resume-Target-Pages": desiredPages,
        "X-Resume-Density": density,
        "X-Resume-Overflow": overflow ? "true" : "false",
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
