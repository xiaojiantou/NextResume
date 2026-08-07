import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { ResumePdf } from "./ResumePdf";
import { ResumePdfDistinctive } from "./ResumePdfDistinctive";
import { ResumePdfMinimal } from "./ResumePdfMinimal";
import { ResumePdfSidebar } from "./ResumePdfSidebar";
import { partitionResumeForPages } from "./balancedPages";
import type {
  FixedPdfStyle,
  ResumePalette,
  TargetPages,
} from "./config";
import type { FitDensity } from "../resumeFit";
import type { Optimization, Resume, ResumePageSpec } from "../types";

export type FixedFitPreset = {
  id: Exclude<FitDensity, "source">;
  fontScale: number;
  spacingScale: number;
  lineHeightScale: number;
  minimumBodyPt: number;
  minimumMarginPt: number;
};

// Ordered from roomiest to most compact. Text reduction is deliberately
// modest; once minimum-safe still overflows, the content-fit layer must make
// evidence-backed choices instead of producing unreadable type.
export const FIXED_FIT_PRESETS: readonly FixedFitPreset[] = [
  {
    id: "very-relaxed",
    fontScale: 1.1,
    spacingScale: 1.38,
    lineHeightScale: 1.08,
    minimumBodyPt: 10,
    minimumMarginPt: 36,
  },
  {
    id: "relaxed",
    fontScale: 1.05,
    spacingScale: 1.18,
    lineHeightScale: 1.04,
    minimumBodyPt: 10,
    minimumMarginPt: 36,
  },
  {
    id: "standard",
    fontScale: 1,
    spacingScale: 1,
    lineHeightScale: 1,
    minimumBodyPt: 10,
    minimumMarginPt: 36,
  },
  {
    id: "compact",
    fontScale: 1,
    spacingScale: 0.86,
    lineHeightScale: 0.95,
    minimumBodyPt: 9.5,
    minimumMarginPt: 32,
  },
  {
    id: "tight",
    fontScale: 0.97,
    spacingScale: 0.74,
    lineHeightScale: 0.9,
    minimumBodyPt: 9.25,
    minimumMarginPt: 30,
  },
  {
    id: "minimum-safe",
    fontScale: 0.94,
    spacingScale: 0.64,
    lineHeightScale: 0.86,
    minimumBodyPt: 9,
    minimumMarginPt: 28.8,
  },
] as const;

function fixedTemplate({
  style,
  palette,
  resume,
  optimization,
  includeSummary,
  page,
  fit,
}: {
  style: FixedPdfStyle;
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  page: ResumePageSpec;
  fit: FixedFitPreset;
}) {
  const common = {
    resume,
    optimization,
    includeSummary,
    palette,
    pageSize: page,
    fontScale: fit.fontScale,
    spacingScale: fit.spacingScale,
    lineHeightScale: fit.lineHeightScale,
    minimumBodyPt: fit.minimumBodyPt,
    minimumMarginPt: fit.minimumMarginPt,
  };
  if (style === "sidebar") return <ResumePdfSidebar {...common} />;
  if (style === "minimal") return <ResumePdfMinimal {...common} />;
  if (
    style === "academic" ||
    style === "executive" ||
    style === "tech" ||
    style === "elegant"
  ) {
    return <ResumePdfDistinctive variant={style} {...common} />;
  }
  return <ResumePdf {...common} />;
}

export async function renderFixedAtPreset({
  style,
  palette,
  resume,
  optimization,
  includeSummary,
  page,
  fit,
}: {
  style: FixedPdfStyle;
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  page: ResumePageSpec;
  fit: FixedFitPreset;
}) {
  const buffer = await renderToBuffer(
    fixedTemplate({
      style,
      palette,
      resume,
      optimization,
      includeSummary,
      page,
      fit,
    }),
  );
  const pageCount = (await PDFDocument.load(buffer)).getPageCount();
  return {
    buffer,
    pageCount,
    density: fit.id,
  };
}

export async function renderFixedCandidates({
  style,
  palette,
  resume,
  optimization,
  includeSummary,
  page,
}: {
  style: FixedPdfStyle;
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  page: ResumePageSpec;
}) {
  const rendered = [];
  for (const fit of FIXED_FIT_PRESETS) {
    rendered.push(
      await renderFixedAtPreset({
        style,
        palette,
        resume,
        optimization,
        includeSummary,
        page,
        fit,
      }),
    );
  }
  return rendered;
}

export async function renderFixedBalanced({
  style,
  palette,
  resume,
  optimization,
  includeSummary,
  page,
  targetPages,
}: {
  style: FixedPdfStyle;
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  page: ResumePageSpec;
  targetPages: number;
}) {
  const chunks = partitionResumeForPages({
    resume,
    optimization,
    pageCount: targetPages,
  });
  if (!chunks) return null;

  for (const fit of FIXED_FIT_PRESETS) {
    const renderedChunks = [];
    let allSinglePage = true;
    for (const chunk of chunks) {
      const rendered = await renderFixedAtPreset({
        style,
        palette,
        resume: chunk.resume,
        optimization: chunk.optimization,
        includeSummary,
        page,
        fit,
      });
      if (rendered.pageCount !== 1) {
        allSinglePage = false;
        break;
      }
      renderedChunks.push(rendered);
    }
    if (!allSinglePage) continue;

    const merged = await PDFDocument.create();
    merged.setTitle(`${resume.name} — Resume`);
    merged.setAuthor(resume.name);
    merged.setCreator("NextResume");
    merged.setProducer("NextResume");
    for (const rendered of renderedChunks) {
      const source = await PDFDocument.load(rendered.buffer);
      const [copied] = await merged.copyPages(source, [0]);
      merged.addPage(copied);
    }
    return {
      buffer: Buffer.from(await merged.save()),
      pageCount: targetPages,
      density: fit.id,
      balanced: true,
    };
  }
  return null;
}

export async function renderFixedFitted({
  style,
  palette,
  resume,
  optimization,
  includeSummary,
  page,
  targetPages,
  requireExact = false,
}: {
  style: FixedPdfStyle;
  palette: ResumePalette;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary?: boolean;
  page: ResumePageSpec;
  targetPages: TargetPages;
  requireExact?: boolean;
}) {
  const candidates = await renderFixedCandidates({
    style,
    palette,
    resume,
    optimization,
    includeSummary,
    page,
  });
  const standard =
    candidates.find((candidate) => candidate.density === "standard") ??
    candidates[0];
  const desiredPages =
    targetPages === "auto" ? standard.pageCount : targetPages;
  const exact = candidates.find(
    (candidate) => candidate.pageCount === desiredPages,
  );
  if (exact) {
    return {
      ...exact,
      desiredPages,
      exact: true,
      overflow: false,
    };
  }
  const maximumObserved = Math.max(
    ...candidates.map((candidate) => candidate.pageCount),
  );
  if (
    typeof desiredPages === "number" &&
    desiredPages > maximumObserved
  ) {
    const balanced = await renderFixedBalanced({
      style,
      palette,
      resume,
      optimization,
      includeSummary,
      page,
      targetPages: desiredPages,
    });
    if (balanced) {
      return {
        ...balanced,
        desiredPages,
        exact: true,
        overflow: false,
      };
    }
  }
  if (requireExact) {
    return {
      ...standard,
      desiredPages,
      exact: false,
      overflow: standard.pageCount > desiredPages,
      observedPages: candidates.map((candidate) => candidate.pageCount),
    };
  }

  const fitting = candidates.find(
    (candidate) => candidate.pageCount <= desiredPages,
  );
  const fallback = fitting ?? candidates[candidates.length - 1];
  return {
    ...fallback,
    desiredPages,
    exact: fallback.pageCount === desiredPages,
    overflow: fallback.pageCount > desiredPages,
    observedPages: candidates.map((candidate) => candidate.pageCount),
  };
}
