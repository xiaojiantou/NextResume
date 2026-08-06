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
  validateLockedOptimization,
  validatePreservedFitOptimization,
  validatePreservedOptimization,
} from "@/lib/resumeStructure";
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
      lockedContentIds,
    } =
      (await req.json()) as {
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
        lockedContentIds?: string[];
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
    if (
      effectiveOptimization?.structureMode === "preserve"
    ) {
      const preservationIssues = usesFitVariant
        ? validatePreservedFitOptimization(
            resume,
            effectiveOptimization,
            optimization ?? effectiveOptimization,
          )
        : validatePreservedOptimization(resume, effectiveOptimization);
      const integrityIssues = [
        ...preservationIssues,
        ...validateLockedOptimization({
          resume,
          candidate: effectiveOptimization,
          baseline: optimization,
          lockedContentIds: Array.isArray(lockedContentIds)
            ? lockedContentIds
            : [],
        }),
      ];
      if (integrityIssues.length > 0) {
        return NextResponse.json(
          {
            error:
              usesFitVariant
                ? "The fitted version changed a protected section or entry. Fit the latest resume again before downloading."
                : "Structure integrity checks failed. Regenerate the original-structure version before downloading.",
            issues: [...new Set(integrityIssues)].slice(0, 12),
          },
          { status: 409 },
        );
      }
    }
    let buffer: Buffer;
    let density = "source";
    let desiredPages =
      selectedTargetPages === "auto" ? "auto" : String(selectedTargetPages);
    let overflow = false;
    let approximateLayout = false;

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
      approximateLayout = Boolean(personalizedStyleProfile.approximate);
      try {
        buffer = await renderPersonalizedPdf({
          styleProfile: personalizedStyleProfile,
          resume: effectiveResume,
          optimization: effectiveOptimization,
          includeSummary,
          targetPages: selectedTargetPages,
          allowMinimumTypography: usesFitVariant,
        });
      } catch (error) {
        console.warn(
          "original-inspired export fell back to a safe fixed layout",
          error,
        );
        const fallbackStyle =
          personalizedStyleProfile.layout === "single-column"
            ? "classic"
            : "sidebar";
        const fallback = await renderFixedFitted({
          style: fallbackStyle,
          palette: getResumePalette(fallbackStyle),
          resume: effectiveResume,
          optimization: effectiveOptimization,
          includeSummary,
          page: selectedPage,
          targetPages: selectedTargetPages,
          requireExact: usesFitVariant,
        });
        if (usesFitVariant && !fallback.exact) {
          return NextResponse.json(
            {
              error: `The latest fitted content rendered as ${fallback.pageCount} pages instead of ${selectedTargetPages}. Fit it again before downloading.`,
            },
            { status: 409 },
          );
        }
        buffer = fallback.buffer;
        density = fallback.density;
        desiredPages = String(fallback.desiredPages);
        overflow = fallback.overflow;
        approximateLayout = true;
      }
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
        "X-Resume-Layout": approximateLayout ? "approximate" : "matched",
      },
    });
  } catch (e) {
    console.error("pdf export failed", e);
    const message = e instanceof Error ? e.message : "PDF export failed";
    if (
      /^Personalized (?:PDF text|content) integrity failed:/.test(message)
    ) {
      return NextResponse.json(
        {
          error:
            "The Original-inspired layout could not safely render every field. Retry the preview or rebuild the layout.",
          issue: message,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
