// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { ResumePdf } from "@/lib/pdf/ResumePdf";
import { ResumePdfSidebar } from "@/lib/pdf/ResumePdfSidebar";
import { ResumePdfMinimal } from "@/lib/pdf/ResumePdfMinimal";
import { ResumePdfDistinctive } from "@/lib/pdf/ResumePdfDistinctive";
import { renderPersonalizedPdf } from "@/lib/personalizedResume";
import { rateLimitGuard } from "@/lib/ratelimit";
import {
  getResumePalette,
  isPdfStyle,
  normalizeTargetPages,
  type FixedPdfStyle,
  type PdfStyle,
  type ResumePalette,
  type TargetPages,
} from "@/lib/pdf/config";
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

// Discrete density presets keep exports visually intentional. Body type never
// shrinks below the 10pt floor enforced by every template; whitespace and
// leading absorb page-fit pressure first.
const FIT_PRESETS = [
  {
    id: "relaxed",
    fontScale: 1.05,
    spacingScale: 1.18,
    lineHeightScale: 1.05,
  },
  {
    id: "standard",
    fontScale: 1,
    spacingScale: 1,
    lineHeightScale: 1,
  },
  {
    id: "compact",
    fontScale: 1,
    spacingScale: 0.88,
    lineHeightScale: 0.95,
  },
  {
    id: "tight-safe",
    fontScale: 1,
    spacingScale: 0.78,
    lineHeightScale: 0.9,
  },
] as const;

type FitPreset = (typeof FIT_PRESETS)[number];

function fixedTemplate({
  style,
  palette,
  resume,
  optimization,
  includeSummary,
  fit,
}: {
  style: FixedPdfStyle;
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary: boolean | undefined;
  fit: FitPreset;
}) {
  if (style === "sidebar") {
    return (
      <ResumePdfSidebar
        resume={resume}
        optimization={optimization}
        palette={palette}
        includeSummary={includeSummary}
        {...fit}
      />
    );
  }
  if (style === "minimal") {
    return (
      <ResumePdfMinimal
        resume={resume}
        optimization={optimization}
        palette={palette}
        includeSummary={includeSummary}
        {...fit}
      />
    );
  }
  if (
    style === "academic" ||
    style === "executive" ||
    style === "tech" ||
    style === "elegant"
  ) {
    return (
      <ResumePdfDistinctive
        variant={style}
        resume={resume}
        optimization={optimization}
        palette={palette}
        includeSummary={includeSummary}
        {...fit}
      />
    );
  }
  return (
    <ResumePdf
      resume={resume}
      optimization={optimization}
      palette={palette}
      includeSummary={includeSummary}
      {...fit}
    />
  );
}

async function renderFixedAtDensity({
  style,
  palette,
  resume,
  optimization,
  includeSummary,
  fit,
}: {
  style: FixedPdfStyle;
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary: boolean | undefined;
  fit: FitPreset;
}) {
  const buffer = await renderToBuffer(
    fixedTemplate({
      style,
      palette,
      resume,
      optimization,
      includeSummary,
      fit,
    }),
  );
  const pageCount = (await PDFDocument.load(buffer)).getPageCount();
  return { buffer, pageCount, density: fit.id };
}

async function renderFittedToTarget({
  style,
  palette,
  resume,
  optimization,
  includeSummary,
  targetPages,
}: {
  style: FixedPdfStyle;
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary: boolean | undefined;
  targetPages: TargetPages;
}) {
  const cache = new Map<
    FitPreset["id"],
    Awaited<ReturnType<typeof renderFixedAtDensity>>
  >();
  const render = async (fit: FitPreset) => {
    const cached = cache.get(fit.id);
    if (cached) return cached;
    const result = await renderFixedAtDensity({
      style,
      palette,
      resume,
      optimization,
      includeSummary,
      fit,
    });
    cache.set(fit.id, result);
    return result;
  };

  const baseline = await render(FIT_PRESETS[1]);
  const desiredPages =
    targetPages === "auto"
      ? Math.min(10, Math.max(1, baseline.pageCount))
      : targetPages;

  let last = baseline;
  for (const fit of FIT_PRESETS) {
    const rendered = await render(fit);
    last = rendered;
    if (rendered.pageCount <= desiredPages) {
      return {
        ...rendered,
        desiredPages,
        overflow: false,
      };
    }
  }
  return {
    ...last,
    desiredPages,
    overflow: last.pageCount > desiredPages,
  };
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
      palette,
      targetPages,
      personalizedStyleProfile,
      includeSummary,
    } =
      (await req.json()) as {
        resume: Resume;
        optimization: Optimization | null;
        targetTitle?: string;
        style?: PdfStyle;
        palette?: string;
        targetPages?: TargetPages;
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
        resume,
        optimization,
        includeSummary,
        targetPages: selectedTargetPages,
      });
    } else {
      const selectedPalette = getResumePalette(selectedStyle, palette);
      const fitted = await renderFittedToTarget({
        style: selectedStyle,
        palette: selectedPalette,
        resume,
        optimization,
        includeSummary,
        targetPages: selectedTargetPages,
      });
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
