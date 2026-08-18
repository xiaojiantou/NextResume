// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { AppShell } from "@/components/AppShell";
import { ModelPicker } from "@/components/ModelPicker";
import { PdfStylePicker } from "@/components/PdfStylePicker";
import { PdfPalettePicker } from "@/components/PdfPalettePicker";
import { TargetPagesPicker } from "@/components/TargetPagesPicker";
import { ContentStructurePicker } from "@/components/ContentStructurePicker";
import { OriginalDocumentPreview } from "@/components/OriginalDocumentPreview";
import {
  FIT_PROGRESS_STAGES,
  ResumeFitPanel,
  type FitProgressStage,
} from "@/components/ResumeFitPanel";
import { ResumeView } from "@/components/ResumeView";
import { EditorWithPreview } from "@/components/EditorWithPreview";
import { VoiceRefine } from "@/components/VoiceRefine";
import { findModel } from "@/lib/models";
import { applyOptimizationToResume } from "@/lib/applyOptimization";
import { VOICE_QUOTA, orderAuthHeaders, useFlow } from "@/lib/store";

import { cn } from "@/lib/cn";
import {
  PDF_STYLE_DEFINITIONS,
  getDefaultPaletteId,
  type FixedPdfStyle,
  type PdfStyle,
} from "@/lib/pdf/config";
import {
  createFitCacheKey,
  createFitLayoutRevision,
  createResumeRevision,
  defaultResumePage,
  findFitVariant,
  type FitConflict,
} from "@/lib/resumeFit";
import { isCurrentResumeStyleProfile } from "@/lib/resumeStyle";
import {
  createOptimizationCacheKey,
  findOptimizationVariant,
} from "@/lib/resumeStructure";
import type {
  ContentStructureMode,
  AtsReport,
  JobAnalysis,
  OptimizedBullet,
  Resume,
  ResumeBullet,
  StructureIntegrity,
} from "@/lib/types";
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  Columns2,
  Cpu,
  Download,
  Eye,
  FileDown,
  Info,
  Layers,
  Lock,
  Mic,
  RotateCcw,
  ShieldCheck,
  Unlock,
  Sparkles,
  Pencil,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type View = "split" | "optimized" | "original" | "edit";
type ContentVersion = "full" | "fitted";

// The rewrite is one non-streaming request, so there is no real completion
// percentage to report. These name the work /api/optimize actually does, in
// the order it does it, and the bar tracks the stage — it never claims to
// know how much is left, and it never reaches 100% before the response lands.
const REWRITE_PROGRESS_STAGES = [
  "Reading your experience",
  "Matching against the job description",
  "Rewriting bullets with evidence",
  "Checking every claim against your resume",
  "Reordering for the target role",
  "Scoring the result",
] as const;

const REWRITE_STAGE_MS = 5_000;

// A platform-level failure (gateway timeout, crashed function) answers with an
// HTML body, so `data.error` is undefined and the user used to get a bare
// "Optimization failed" with nothing to act on. Name the failure by status.
function describeFailure(status: number): string {
  if (status === 504 || status === 408) {
    return "The optimizer timed out. Retry, or pick a faster model.";
  }
  if (status === 502 || status === 503) {
    return "The optimizer is temporarily unavailable. Try again in a moment.";
  }
  if (status === 413) {
    return "This resume is too large to optimize in one request.";
  }
  return `Optimization failed (HTTP ${status}).`;
}


export default function ResultPage() {
  return (
    <Suspense
      fallback={
        <AppShell step="result">
          <div className="container-x py-16 max-w-2xl">
            <div className="card p-10 text-center text-ink-500 text-sm">
              Loading…
            </div>
          </div>
        </AppShell>
      }
    >
      <ResultPageInner />
    </Suspense>
  );
}

function ResultPageInner() {
  const {
    resume,
    job,
    report,
    optimization,
    optimizationModel,
    optimizationStructureMode,
    optimizationVariants,
    contentStructure,
    selectedModel,
    pdfStyle,
    includeSummary,
    setIncludeSummary,
    pdfPalette,
    targetPages,
    fitVariants,
    fitKeepIds,
    fitPriorityIds,
    lockedContentIds,
    resumeStyleSource,
    personalizedStyleProfile,
    personalizedStatus,
    paid,
    setResume,
    setJob,
    setReport,
    setMeasuredScore,
    setOptimization,
    setOptimizationVariants,
    setContentStructure,
    setSelectedModel,
    setPdfStyle,
    setPdfPalette,
    setTargetPages,
    setFitVariants,
    setFitKeepIds,
    setLockedContentIds,
    toggleLockedContentId,
    upsertFitVariant,
    toggleFitKeepId,
    clearFitVariantsForStyle,
    setResumeStyleSource,
    setPersonalizedStyleProfile,
    setPersonalizedStatus,
    clearOptimization,
    markPaid,
    setOrderAccess,
  } = useFlow();

  const [view, setView] = useState<View>("split");
  const [contentVersion, setContentVersion] =
    useState<ContentVersion>("full");
  const [evidenceMode, setEvidenceMode] = useState(true);
  const [hoveredOptimizedId, setHoveredOptimizedId] = useState<string | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [hydrating, setHydrating] = useState(false);
  const [rewriteStage, setRewriteStage] = useState(0);

  const ran = useRef(false);
  const personalizeRan = useRef(false);
  const fitAbortRef = useRef<AbortController | null>(null);
  const fitCancelledRef = useRef(false);
  const fitRequestKeyRef = useRef<string | null>(null);
  const latestFitKeyRef = useRef<string | null>(null);
  const runFitRef = useRef<() => Promise<void>>(async () => undefined);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Email-link identity: if URL has ?order=xxx&token=yyy, this is the
  // "return by email" flow. It grants access regardless of localStorage.
  const orderIdFromUrl = searchParams?.get("order") || null;
  const tokenFromUrl = searchParams?.get("token") || null;
  const hasEmailAccess = !!(orderIdFromUrl && tokenFromUrl);

  // Auto default: keep the AI summary only when the source resume already
  // had a summary section. Users whose resume had none opt in explicitly.
  const summaryEnabled = includeSummary ?? Boolean(resume?.summary);

  // The rewrite screen is up whenever there is no optimization to show yet.
  const rewriting = generating || !optimization;


  // Re-score the rewritten resume with the same rubric the original was
  // scored with, so the "after" number the user sees is measured, not the
  // pre-purchase projection. Best-effort: a failure just leaves the
  // projected score in place.
  const rescoreOptimized = async (
    optimized: NonNullable<typeof optimization>,
    modelId: string,
    resumeArg = resume,
    jobArg = job,
  ) => {
    if (!resumeArg || !jobArg) return;
    try {
      const state = useFlow.getState();
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: applyOptimizationToResume(resumeArg, optimized, {
            includeSummary:
              state.includeSummary ?? Boolean(resumeArg.summary),
          }),
          job: jobArg,
          model: modelId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.report?.overallBefore === "number") {
        setMeasuredScore(
          data.report.overallBefore,
          data.report.categoriesBefore ?? [],
        );
      }
    } catch {
      /* non-fatal — projected score stays */
    }
  };

  const runOptimize = async (
    modelId: string,
    structureMode: ContentStructureMode = contentStructure,
    source?: {
      resume: Resume;
      job: JobAnalysis;
      report: AtsReport;
    },
  ) => {
    const sourceResume = source?.resume ?? resume;
    const sourceJob = source?.job ?? job;
    const sourceReport = source?.report ?? report;
    if (!sourceResume || !sourceJob || !sourceReport) return;
    setGenerating(true);
    setError(null);
    setErrorDetails([]);
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAuthHeaders() },

        body: JSON.stringify({
          resume: sourceResume,
          job: sourceJob,
          report: sourceReport,
          model: modelId,
          structureMode,
          lockedContentIds,
          baselineOptimization: optimization,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorDetails(
          Array.isArray(data.issues)
            ? data.issues.filter(
                (issue: unknown): issue is string =>
                  typeof issue === "string",
              )
            : [],
        );
        throw new Error(data.error || describeFailure(res.status));
      }
      setOptimization(data.optimization, modelId, structureMode);
      void rescoreOptimized(
        data.optimization,
        modelId,
        sourceResume,
        sourceJob,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed.");
    } finally {
      setGenerating(false);
    }
  };

  const regenerate = async (
    modelId: string,
    structureMode: ContentStructureMode = contentStructure,
  ) => {
    clearOptimization();
    setHoveredOptimizedId(null);
    await runOptimize(modelId, structureMode);
  };

  const switchStructureMode = (mode: ContentStructureMode) => {
    setContentStructure(mode);
    setContentVersion("full");
    setFitConflict(null);
    setFitError(null);
    setExportError(null);
    if (!resume || !job) return;
    const modelId = optimizationModel ?? selectedModel;
    const cacheKey = createOptimizationCacheKey({
      resume,
      job,
      modelId,
      structureMode: mode,
    });
    const cached = findOptimizationVariant(optimizationVariants, cacheKey);
    if (cached) {
      setOptimization(cached.optimization, modelId, mode);
      return;
    }
    void regenerate(modelId, mode);
  };

  const switchOptimizationModel = (modelId: string) => {
    setSelectedModel(modelId);
    if (!resume || !job) {
      void regenerate(modelId, contentStructure);
      return;
    }
    const cacheKey = createOptimizationCacheKey({
      resume,
      job,
      modelId,
      structureMode: contentStructure,
    });
    const cached = findOptimizationVariant(optimizationVariants, cacheKey);
    if (cached) {
      setOptimization(cached.optimization, modelId, contentStructure);
      setContentVersion("full");
      setFitConflict(null);
      setFitError(null);
      return;
    }
    void regenerate(modelId, contentStructure);
  };

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedPages, setExportedPages] = useState<number | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [fitting, setFitting] = useState(false);
  const [fitStage, setFitStage] = useState<FitProgressStage | null>(null);
  const [fitError, setFitError] = useState<string | null>(null);
  const [fitConflict, setFitConflict] = useState<FitConflict | null>(null);
  const [personalizedError, setPersonalizedError] = useState<string | null>(
    null,
  );

  const sourceRevision = useMemo(() => {
    if (!resume) return null;
    return createResumeRevision({
      resume,
      optimization,
      job,
      modelId: optimizationModel,
    });
  }, [job, optimization, optimizationModel, resume]);
  const recommendedPages = useMemo(() => {
    if (!resume) return 1;
    const publicationCount = (resume.additionalSections ?? [])
      .filter((section) => section.kind === "publications")
      .reduce((total, section) => total + section.items.length, 0);
    const bulletCount =
      resume.experience.reduce(
        (total, role) => total + role.bullets.length,
        0,
      ) +
      (resume.projects ?? []).reduce(
        (total, project) => total + project.bullets.length,
        0,
      );
    if (publicationCount >= 8) return 3;
    if (
      resume.experience.length >= 5 ||
      bulletCount >= 18 ||
      /(research|scientist|professor|academic)/i.test(job?.title ?? "")
    ) {
      return 2;
    }
    return 1;
  }, [job?.title, resume]);
  const outputPage = useMemo(
    () =>
      defaultResumePage(
        resumeStyleSource?.page ?? personalizedStyleProfile?.page,
      ),
    [personalizedStyleProfile?.page, resumeStyleSource?.page],
  );
  const protectedContentIds = useMemo(
    () => [...new Set([...fitKeepIds, ...lockedContentIds])],
    [fitKeepIds, lockedContentIds],
  );
  const activeFitKey = useMemo(() => {
    if (
      targetPages === "auto" ||
      !sourceRevision ||
      !optimizationModel ||
      optimizationStructureMode !== contentStructure
    ) {
      return null;
    }
    return createFitCacheKey({
      sourceRevision,
      targetPages,
      style: pdfStyle,
      page: outputPage,
      modelId: optimizationModel,
      layoutRevision: createFitLayoutRevision(
        pdfStyle === "personalized" ? personalizedStyleProfile : null,
      ),
      keptContentIds: protectedContentIds,
    });
  }, [
    protectedContentIds,
    optimizationModel,
    optimizationStructureMode,
    contentStructure,
    outputPage,
    pdfStyle,
    personalizedStyleProfile,
    sourceRevision,
    targetPages,
  ]);
  const activeFitVariant = useMemo(
    () =>
      activeFitKey ? findFitVariant(fitVariants, activeFitKey) : null,
    [activeFitKey, fitVariants],
  );
  const activeFitVariantId = activeFitVariant?.id ?? null;
  useEffect(() => {
    latestFitKeyRef.current = activeFitKey;
    if (
      fitRequestKeyRef.current &&
      fitRequestKeyRef.current !== activeFitKey
    ) {
      fitCancelledRef.current = true;
      fitAbortRef.current?.abort();
    }
  }, [activeFitKey]);
  useEffect(() => {
    if (targetPages === "auto") {
      setContentVersion("full");
      return;
    }
    if (activeFitVariantId) {
      setContentVersion("fitted");
    }
  }, [activeFitVariantId, targetPages]);
  const hasOutdatedFit =
    targetPages !== "auto" &&
    fitVariants.some(
      (variant) =>
        variant.style === pdfStyle &&
        variant.targetPages === targetPages &&
        variant.modelId === optimizationModel &&
        variant.cacheKey !== activeFitKey,
    );
  const fittedViewActive =
    contentVersion === "fitted" && Boolean(activeFitVariant);
  const displayedResume =
    fittedViewActive && activeFitVariant
      ? activeFitVariant.fittedResume
      : resume;
  const displayedOptimization =
    fittedViewActive && activeFitVariant
      ? activeFitVariant.fittedOptimization
      : optimization;
  const optimizationNeedsStructureUpgrade =
    contentStructure === "optimize" &&
    optimizationStructureMode === "optimize" &&
    Boolean(optimization) &&
    (!optimization?.sectionOrder?.length || !optimization.sectionLabels);
  const structureStale =
    Boolean(optimization) &&
    (optimizationStructureMode !== contentStructure ||
      optimizationNeedsStructureUpgrade);

  const runFit = async () => {
    if (
      !resume ||
      !optimization ||
      !job ||
      !report ||
      !optimizationModel ||
      structureStale ||
      targetPages === "auto" ||
      !activeFitKey
    ) {
      return;
    }
    fitAbortRef.current?.abort();
    const requestKey = activeFitKey;
    fitRequestKeyRef.current = requestKey;
    setFitting(true);
    setFitError(null);
    setFitConflict(null);
    setExportError(null);
    fitCancelledRef.current = false;
    setFitStage(FIT_PROGRESS_STAGES[0]);
    let stageIndex = 0;
    const progressTimer = window.setInterval(() => {
      stageIndex = Math.min(
        FIT_PROGRESS_STAGES.length - 1,
        stageIndex + 1,
      );
      setFitStage(FIT_PROGRESS_STAGES[stageIndex]);
    }, 6_500);
    const controller = new AbortController();
    fitAbortRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 85_000);
    try {
      const response = await fetch("/api/fit-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAuthHeaders() },

        signal: controller.signal,
        body: JSON.stringify({
          resume,
          optimization,
          job,
          report,
          model: optimizationModel,
          style: pdfStyle,
          palette: pdfPalette,
          targetPages,
          pageSize: outputPage,
          resumeStyleSourcePage: resumeStyleSource?.page ?? null,
          personalizedStyleProfile:
            pdfStyle === "personalized"
              ? personalizedStyleProfile
              : undefined,
          keptContentIds: protectedContentIds,
          priorityContentIds: fitPriorityIds,
          lockedContentIds,
          structureMode: contentStructure,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.conflict) {
        setFitConflict(data.conflict as FitConflict);
        return;
      }
      if (!response.ok || !data.variant) {
        throw new Error(data.error || "Could not fit the resume.");
      }
      if (latestFitKeyRef.current !== requestKey) return;
      upsertFitVariant(data.variant);
      setContentVersion("fitted");
    } catch (fitFailure) {
      if (fitCancelledRef.current) return;
      setFitError(
        fitFailure instanceof DOMException && fitFailure.name === "AbortError"
          ? "Page fitting exceeded 85 seconds. Try again or choose a nearby page count."
          : fitFailure instanceof Error
            ? fitFailure.message
            : "Could not fit the resume.",
      );
    } finally {
      window.clearInterval(progressTimer);
      window.clearTimeout(timeout);
      if (fitRequestKeyRef.current === requestKey) {
        fitAbortRef.current = null;
        fitRequestKeyRef.current = null;
      }
      fitCancelledRef.current = false;
      setFitStage(null);
      setFitting(false);
    }
  };
  runFitRef.current = runFit;

  useEffect(() => {
    if (
      !activeFitKey ||
      activeFitVariantId ||
      targetPages === "auto" ||
      structureStale ||
      fitting ||
      generating ||
      fitError ||
      fitConflict ||
      (pdfStyle === "personalized" &&
        (!personalizedStyleProfile || personalizedStatus === "generating"))
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void runFitRef.current();
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [
    activeFitKey,
    activeFitVariantId,
    fitConflict,
    fitError,
    fitting,
    generating,
    pdfStyle,
    personalizedStatus,
    personalizedStyleProfile,
    structureStale,
    targetPages,
  ]);

  const downloadPdf = async () => {
    if (!resume || !optimization) return;
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      if (structureStale) {
        throw new Error(
          `Regenerate with ${contentStructure === "preserve" ? "the original structure" : "role-optimized structure"} before downloading.`,
        );
      }
      if (
        contentStructure === "preserve" &&
        optimization.structureIntegrity?.valid === false
      ) {
        throw new Error(
          "Structure integrity checks failed. Regenerate before downloading.",
        );
      }
      if (targetPages !== "auto" && !activeFitVariant) {
        throw new Error(
          `Fit the latest resume to exactly ${targetPages} ${
            targetPages === 1 ? "page" : "pages"
          } before downloading.`,
        );
      }
      if (pdfStyle === "personalized" && !personalizedStyleProfile) {
        throw new Error(
          personalizedStatus === "failed"
            ? personalizedError ||
                "Original-inspired layout failed. Retry or choose Classic."
            : "Original-inspired layout is still generating.",
        );
      }
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAuthHeaders() },

        body: JSON.stringify({
          resume,
          optimization,
          targetTitle: job?.title || "",
          style: pdfStyle,
          includeSummary: summaryEnabled,
          palette: pdfPalette,
          targetPages,
          pageSize: outputPage,
          fitVariant:
            targetPages === "auto" ? undefined : activeFitVariant,
          sourceRevision: sourceRevision ?? undefined,
          lockedContentIds,
          personalizedStyleProfile:
            pdfStyle === "personalized"
              ? personalizedStyleProfile
              : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `PDF export failed (${res.status})`);
      }
      const actualPages = Number(res.headers.get("X-Resume-Pages") || "0");
      setExportedPages(
        Number.isFinite(actualPages) && actualPages > 0 ? actualPages : null,
      );
      const desiredPages = res.headers.get("X-Resume-Target-Pages");
      const overflow = res.headers.get("X-Resume-Overflow") === "true";
      if (overflow && actualPages > 0 && desiredPages) {
        setExportNotice(
          `The complete resume needs ${actualPages} pages at the safe readability limit, so it exceeds the ${desiredPages}-page target.`,
        );
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(
        /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i,
      );
      const filename = match
        ? decodeURIComponent(match[1])
        : `${resume.name || "resume"}.pdf`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (downloadFailure) {
      setExportError(
        downloadFailure instanceof Error
          ? downloadFailure.message
          : "PDF export failed.",
      );
    } finally {
      setExporting(false);
    }
  };

  const generatePersonalized = useCallback(async () => {
    if (!resumeStyleSource) {
      setPersonalizedError(
        "The original resume style source is unavailable. Re-upload the resume or choose Classic.",
      );
      setPersonalizedStatus("failed");
      return;
    }
    setPersonalizedStatus("generating");
    setPersonalizedError(null);
    try {
      const res = await fetch("/api/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAuthHeaders() },

        body: JSON.stringify({
          styleSource: resumeStyleSource,
          sourceLayout: resume?.sourceLayout ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.styleProfile) {
        throw new Error(data.error || "Original-inspired layout generation failed.");
      }
      clearFitVariantsForStyle("personalized");
      setPersonalizedStyleProfile(data.styleProfile);
    } catch (personalizeFailure) {
      setPersonalizedStatus("failed");
      setPersonalizedError(
        personalizeFailure instanceof Error
          ? personalizeFailure.message
          : "Original-inspired layout generation failed.",
      );
    }
  }, [
    resumeStyleSource,
    resume?.sourceLayout,
    clearFitVariantsForStyle,
    setPersonalizedStatus,
    setPersonalizedStyleProfile,
  ]);

  useEffect(() => {
    if (
      personalizedStyleProfile &&
      !isCurrentResumeStyleProfile(personalizedStyleProfile)
    ) {
      clearFitVariantsForStyle("personalized");
      setPersonalizedStyleProfile(null);
      personalizeRan.current = false;
    }
  }, [
    clearFitVariantsForStyle,
    personalizedStyleProfile,
    setPersonalizedStyleProfile,
  ]);

  // Runs alongside runOptimize (not blocking it) — the personalized style
  // takes far longer than the fixed templates, so it shouldn't hold up the
  // rest of the page. Only fires once per resume, at most.
  // Advance the rewrite stages while that screen is up, holding on the last
  // one until the request resolves.
  useEffect(() => {
    if (!rewriting) {
      setRewriteStage(0);
      return;
    }
    const timer = window.setInterval(() => {
      setRewriteStage((stage) =>
        Math.min(stage + 1, REWRITE_PROGRESS_STAGES.length - 1),
      );
    }, REWRITE_STAGE_MS);
    return () => window.clearInterval(timer);
  }, [rewriting]);

  useEffect(() => {
    if (!paid || !resume) return;
    if (pdfStyle !== "personalized") return;

    if (personalizedStyleProfile || personalizedStatus !== "idle") return;
    if (personalizeRan.current) return;
    personalizeRan.current = true;
    void generatePersonalized();
  }, [
    generatePersonalized,
    paid,
    pdfStyle,
    personalizedStatus,
    personalizedStyleProfile,
    resume,
  ]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // Path A: hydrate from email link. Bypasses localStorage / paid check.
    if (hasEmailAccess) {
      // Adopt the link's credentials before anything calls a paid endpoint,
      // so this device authenticates the same way a fresh purchase does.
      setOrderAccess({ orderId: orderIdFromUrl!, token: tokenFromUrl! });
      (async () => {
        setHydrating(true);

        try {
          const res = await fetch(
            `/api/order/${encodeURIComponent(orderIdFromUrl!)}?token=${encodeURIComponent(tokenFromUrl!)}`,
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Could not open resume.");
          const snap = data.snapshot;
          const order = data.order;
          const restoredReport: AtsReport = snap?.report ?? {
            overallBefore: 0,
            overallAfter: snap?.optimization?.atsScore ?? 0,
            categoriesBefore: [],
            categoriesAfter: [],
            missingKeywords: [],
            presentKeywords: [],
          };

          if (snap?.resume) setResume(snap.resume);
          if (snap?.job) setJob(snap.job);
          setReport(restoredReport);
          if (snap?.resumeStyleSource) {
            setResumeStyleSource(snap.resumeStyleSource);
          }
          if (snap?.personalizedStyleProfile) {
            setPersonalizedStyleProfile(snap.personalizedStyleProfile);
          }
          // Snapshots predate the report, so email sessions need a stub for
          // the page to render; the real "after" number comes from re-scoring.
          const stubReport = {
            overallBefore: 0,
            overallAfter: 0,
            categoriesBefore: [],
            categoriesAfter: [],
            missingKeywords: [],
            presentKeywords: [],
          };
          if (snap?.pdfStyle) setPdfStyle(snap.pdfStyle);
          if (snap?.pdfPalette) setPdfPalette(snap.pdfPalette);
          if (snap?.targetPages !== undefined) {
            setTargetPages(snap.targetPages);
          }
          if (Array.isArray(snap?.fitVariants)) {
            setFitVariants(snap.fitVariants);
          }
          if (Array.isArray(snap?.fitKeepIds)) {
            setFitKeepIds(snap.fitKeepIds);
          }
          if (Array.isArray(snap?.lockedContentIds)) {
            setLockedContentIds(snap.lockedContentIds);
          }
          if (Array.isArray(snap?.optimizationVariants)) {
            setOptimizationVariants(snap.optimizationVariants);
          }
          if (
            snap?.contentStructure === "optimize" ||
            snap?.contentStructure === "preserve"
          ) {
            setContentStructure(snap.contentStructure);
          }
          if (snap?.optimization && snap?.optimizationModel) {
            setOptimization(
              snap.optimization,
              snap.optimizationModel,
              snap.optimizationStructureMode ??
                snap.optimization.structureMode ??
                snap.contentStructure ??
                "optimize",
            );
            if (!useFlow.getState().report) setReport(stubReport);
            if (snap?.resume && snap?.job) {
              void rescoreOptimized(
                snap.optimization,
                snap.optimizationModel,
                snap.resume,
                snap.job,
              );
            }
          }
          if (order?.status === "paid") markPaid();
          setHydrating(false);

          // If snapshot has no optimization yet, run it now.
          if (!snap?.optimization && snap?.resume && snap?.job) {
            await runOptimize(
              selectedModel,
              snap?.contentStructure ?? "optimize",
              {
                resume: snap.resume,
                job: snap.job,
                report: restoredReport,
              },
            );
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not open resume.");
          setHydrating(false);
        }
      })();
      return;
    }

    // Path B: localStorage flow (same device that paid).
    if (!paid) {
      router.replace("/checkout");
      return;
    }
    // Unlocked locally but with no order credentials to prove it — a session
    // that predates the server-side paywall. The emailed link still works.
    if (!useFlow.getState().orderId || !useFlow.getState().orderToken) {
      setError(
        "This browser is missing the unlock token for your order. Open your resume from the link in your confirmation email.",
      );
      return;
    }

    if (!resume || !job || !report) {
      router.replace("/upload");
      return;
    }
    if (optimization) return;
    runOptimize(selectedModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist optimization back to Redis whenever it changes on an email-link session.
  useEffect(() => {
    if (!hasEmailAccess || !optimization || !optimizationModel) return;
    fetch(
      `/api/order/${encodeURIComponent(orderIdFromUrl!)}?token=${encodeURIComponent(tokenFromUrl!)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          optimization,
          optimizationModel,
          report,
          resume,
          personalizedStyleProfile,
          pdfStyle,
          pdfPalette,
          targetPages,
          fitVariants,
          fitKeepIds,
          optimizationStructureMode,
          optimizationVariants,
          contentStructure,
          lockedContentIds,
        }),
      },
    ).catch(() => {
      /* non-fatal — user still sees the resume */
    });
  }, [
    optimization,
    optimizationModel,
    report,
    resume,
    personalizedStyleProfile,
    pdfStyle,
    pdfPalette,
    targetPages,
    fitVariants,
    fitKeepIds,
    optimizationStructureMode,
    optimizationVariants,
    contentStructure,
    lockedContentIds,
    hasEmailAccess,
    orderIdFromUrl,
    tokenFromUrl,
  ]);

  const allOptimized = useMemo(
    () => [
      ...(optimization?.roles.flatMap((r) => r.bullets) ?? []),
      ...(optimization?.projects?.flatMap((p) => p.bullets) ?? []),
      ...(optimization?.additionalSections?.flatMap((section) =>
        section.items.flatMap((item) => item.bullets),
      ) ?? []),
    ],
    [optimization],
  );

  if (hydrating || !resume || !job || !report) {
    return (
      <AppShell step="result">
        <div className="container-x py-16 max-w-2xl">
          <div className="card p-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-ink-900 text-white mx-auto inline-flex items-center justify-center">
              <Sparkles size={20} />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight mt-5 text-ink-900">
              Loading your resume…
            </h2>
            <p className="text-ink-500 mt-2 max-w-md mx-auto">
              Restoring your order from the link in your email.
            </p>
            <div className="mt-6 max-w-xs mx-auto">
              <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-ink-900 shimmer" />
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const hoveredBullet =
    allOptimized.find((b) => b.id === hoveredOptimizedId) ?? null;
  const hoveredEvidence = hoveredBullet?.evidence ?? [];

  if (error) {
    return (
      <AppShell step="result">
        <div className="container-x py-10 max-w-2xl">
          <div className="card p-8 text-center" role="alert" aria-live="assertive">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 mx-auto inline-flex items-center justify-center">
              <AlertCircle size={20} />
            </div>
            <h2 className="text-xl font-semibold mt-4 text-ink-900">
              Optimization failed
            </h2>
            <div className="mt-2 inline-flex rounded-full border border-ink-100 bg-ink-50 px-2.5 py-1 text-xs font-medium text-ink-600">
              Mode: {contentStructure === "preserve" ? "Keep original" : "Optimize for role"}
            </div>
            <p className="text-ink-500 text-sm mt-2">{error}</p>
            {errorDetails.length > 0 ? (
              <ul className="mx-auto mt-3 max-w-lg list-disc space-y-1 rounded-lg border border-rose-100 bg-rose-50/60 px-5 py-3 text-left text-xs leading-5 text-rose-800">
                {errorDetails.slice(0, 5).map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
            <p className="text-ink-400 text-xs mt-3">
              {errorDetails.length > 0
                ? "Nothing unsafe was applied. Review the exact source/output mismatch above, then retry or switch structure mode."
                : "Your resume was left untouched. Retry, pick a different model, or switch structure mode."}
            </p>
            <div className="mt-3 flex justify-center">
              <ModelPicker
                current={selectedModel}
                onPick={(id) => {
                  setSelectedModel(id);
                  setError(null);
                  setErrorDetails([]);
                  regenerate(id);
                }}
              />
            </div>
            <button
              onClick={() => {
                setError(null);
                setErrorDetails([]);
                void regenerate(selectedModel, contentStructure);
              }}
              className="btn btn-primary mt-5 min-h-11"
            >
              Retry
            </button>
            {contentStructure === "preserve" ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setErrorDetails([]);
                  setContentStructure("optimize");
                  void regenerate(selectedModel, "optimize");
                }}
                className="btn btn-outline mt-3 ml-2 min-h-11"
              >
                Use Optimize for role
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setErrorDetails([]);
                  setContentStructure("preserve");
                  void regenerate(selectedModel, "preserve");
                }}
                className="btn btn-outline mt-3 ml-2 min-h-11"
              >
                Use Keep original
              </button>
            )}
          </div>
        </div>
      </AppShell>
    );
  }

  if (rewriting) {
    return (

      <AppShell step="result">
        <div className="container-x py-16 max-w-2xl">
          <div className="card p-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-ink-900 text-white mx-auto inline-flex items-center justify-center">
              <Sparkles size={20} />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight mt-5 text-ink-900">
              Rewriting your resume…
            </h2>
            <p className="text-ink-500 mt-2 max-w-md mx-auto">
              Tailoring every bullet to the job description. Each rewrite is
              cited back to your original experience.
            </p>
            <div className="mt-7 max-w-xs mx-auto">
              <div
                className="h-1.5 bg-ink-100 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={REWRITE_PROGRESS_STAGES.length}
                aria-valuenow={rewriteStage + 1}
                aria-valuetext={REWRITE_PROGRESS_STAGES[rewriteStage]}
              >
                <div
                  className="h-full bg-ink-900 rounded-full transition-[width] duration-700 ease-out"
                  style={{
                    // Denominator is stage count + 1 so the bar tops out short
                    // of full — it fills only when the rewrite actually lands.
                    width: `${((rewriteStage + 1) / (REWRITE_PROGRESS_STAGES.length + 1)) * 100}%`,
                  }}
                />
              </div>
              <div className="mt-3 text-xs text-ink-500" aria-live="polite">
                {REWRITE_PROGRESS_STAGES[rewriteStage]}
                <span className="text-ink-300 tabular-nums">
                  {" · "}
                  {rewriteStage + 1}/{REWRITE_PROGRESS_STAGES.length}
                </span>
              </div>
            </div>

          </div>
        </div>
      </AppShell>
    );
  }

  const bulletsRewritten = allOptimized.length;
  const pageLabel =
    Math.abs(outputPage.widthPt - 595) < 8 &&
    Math.abs(outputPage.heightPt - 842) < 8
      ? "A4"
      : Math.abs(outputPage.widthPt - 612) < 8 &&
          Math.abs(outputPage.heightPt - 792) < 8
        ? "Letter"
        : `${Math.round(outputPage.widthPt)}×${Math.round(outputPage.heightPt)}pt`;
  const needsFit =
    !structureStale && targetPages !== "auto" && !activeFitVariant;
  const primaryAction = structureStale
    ? () => regenerate(selectedModel, contentStructure)
    : needsFit
      ? runFit
      : downloadPdf;
  const primaryDisabled =
    fitting ||
    exporting ||
    generating ||
    !optimization ||
    (contentStructure === "preserve" &&
      optimization.structureIntegrity?.valid === false) ||
    (!structureStale &&
      pdfStyle === "personalized" &&
      personalizedStatus !== "ready");

  return (
    <AppShell step="result">
      <div className="container-x py-8 max-w-7xl">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="pill !text-emerald-700 !border-emerald-200 !bg-emerald-50">
              <Check size={12} strokeWidth={3} />
              Resume optimized
            </div>
            <h1 className="text-3xl font-semibold tracking-tight mt-3 text-ink-900">
              Your tailored resume is ready.
            </h1>
            <p className="text-ink-500 mt-1">
              Tailored for{" "}
              <span className="font-medium text-ink-900">
                {job.title}
                {job.company ? ` @ ${job.company}` : ""}
              </span>
              .{" "}
              {typeof activeFitVariant?.atsScore === "number" ? (
                <>
                  ATS score: {report.overallBefore} →{" "}
                  {activeFitVariant.atsScore}
                </>
              ) : typeof report.measuredAfter === "number" ? (
                <>
                  ATS score:{" "}
                  {report.overallBefore > 0 && (
                    <>{report.overallBefore} → </>
                  )}
                  <span className="font-medium text-ink-900">
                    {report.measuredAfter}
                  </span>{" "}
                  <span className="text-emerald-700">
                    (measured on the rewrite)
                  </span>
                </>
              ) : report.overallBefore > 0 ? (
                <>
                  ATS score: {report.overallBefore} → {report.overallAfter}{" "}
                  <span className="text-ink-400">(projected, measuring…)</span>
                </>
              ) : (
                <>Measuring ATS score…</>
              )}
            </p>
            {/* The headline barely moves on an already-strong resume, because
                most of the rubric is already near its ceiling. The per-category
                deltas are where the rewrite's actual work shows up. */}
            {report.measuredCategories?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {report.measuredCategories.map((after) => {
                  const before = report.categoriesBefore.find(
                    (c) => c.label === after.label,
                  );
                  const delta = before ? after.score - before.score : 0;
                  return (
                    <span
                      key={after.label}
                      title={after.detail}
                      className={
                        delta > 0
                          ? "pill !text-xs !text-emerald-700 !border-emerald-200 !bg-emerald-50"
                          : "pill !text-xs !text-ink-500"
                      }
                    >
                      {after.label}{" "}
                      {delta !== 0 && before ? (
                        <span className="font-medium">
                          {before.score} → {after.score}
                        </span>
                      ) : (
                        <span className="font-medium">{after.score}</span>
                      )}
                      {delta > 0 ? ` (+${delta})` : ""}
                    </span>
                  );
                })}
              </div>
            ) : null}
            {report.stuffingWarnings?.length ? (
              <div className="mt-2 space-y-1">
                {report.stuffingWarnings.map((warning) => (
                  <p key={warning} className="text-xs text-amber-700">
                    ⚠ {warning}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-outline"
              onClick={() => regenerate(selectedModel)}
              disabled={generating}
            >
              <FileDown size={14} /> New variation
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void primaryAction()}
              disabled={primaryDisabled}
            >
              {fitting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Fitting…
                </>
              ) : exporting ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Preparing…
                </>
              ) : structureStale ? (
                <>
                  <RefreshCw size={14} /> Regenerate with{" "}
                  {contentStructure === "preserve"
                    ? "original structure"
                    : "role optimization"}
                </>
              ) : needsFit ? (
                <>
                  <Sparkles size={14} /> Fit to {targetPages}{" "}
                  {targetPages === 1 ? "page" : "pages"}
                </>
              ) : (
                <>
                  <Download size={14} /> Download PDF
                </>
              )}
            </button>
          </div>
        </div>

        {resume.structureConfidence?.level === "low" ? (
          <div
            role="status"
            className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            <Info size={15} className="mt-0.5 shrink-0" />
            <span>
              Some source page regions were detected approximately.
              Original-inspired will preserve the closest safe layout without
              blocking your workflow; all parsed content remains editable.
            </span>
          </div>
        ) : null}

        {exportError && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {exportError}
          </div>
        )}
        {exportNotice && (
          <div
            role="status"
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            {exportNotice}
          </div>
        )}

        {exportedPages !== null && !exportError && (
          <div
            className={cn(
              "mt-3 rounded-lg border px-3 py-2 text-sm",
              exportedPages > 1
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            {exportedPages > 1 ? (
              <>
                Exported {exportedPages} pages — even at maximum compaction
                this content doesn't fit one page.{" "}
                {!resume.summary && optimization?.summary && summaryEnabled
                  ? "Try turning off the AI summary, or cut the bullets marked low-relevance in the diff below."
                  : "Try cutting the bullets marked low-relevance in the diff below."}
              </>
            ) : (
              <>Exported as a single page.</>
            )}
          </div>
        )}

        {pdfStyle === "personalized" &&
          personalizedStatus === "failed" && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex flex-wrap items-center justify-between gap-3"
            >
              <span>
                {personalizedError ||
                  "Original-inspired layout failed. Retry or choose Classic."}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-outline min-h-11"
                  onClick={() => {
                    personalizeRan.current = true;
                    void generatePersonalized();
                  }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="btn btn-outline min-h-11"
                  onClick={() => setPdfStyle("classic")}
                >
                  Use Classic
                </button>
              </div>
            </div>
          )}

        {/* Toolbar */}
        <div className="mt-6 card p-2 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-1">
            <ToolbarTab
              active={view === "split"}
              onClick={() => setView("split")}
              icon={<Columns2 size={14} />}
              label="Side-by-side"
            />
            <ToolbarTab
              active={view === "optimized"}
              onClick={() => setView("optimized")}
              icon={<Sparkles size={14} />}
              label="Optimized only"
            />
            <ToolbarTab
              active={view === "original"}
              onClick={() => setView("original")}
              icon={<Eye size={14} />}
              label="Original only"
            />
            <ToolbarTab
              active={view === "edit"}
              onClick={() => {
                if (resume) setView("edit");
              }}
              icon={<Pencil size={14} />}
              label="Edit Resume"
              disabled={!resume}
            />
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
              <span className="inline-flex items-center gap-1.5">
                <Layers size={14} className="text-accent-600" />
                Evidence Mode
              </span>
              <Switch
                checked={evidenceMode}
                onChange={() => setEvidenceMode((v) => !v)}
              />
            </label>
            {!resume.summary && optimization.summary ? (
              <label
                className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer"
                title="Your original resume has no summary section. Include the AI-written one?"
              >
                <span>AI summary</span>
                <Switch
                  checked={summaryEnabled}
                  onChange={() => setIncludeSummary(!summaryEnabled)}
                />
              </label>
            ) : null}
            <div className="h-5 w-px bg-ink-100 hidden sm:block" />
            <ModelPicker
              current={selectedModel}
              onPick={switchOptimizationModel}
              onRegenerate={() => regenerate(selectedModel)}
              regenerating={generating}
              compact
            />
            <div className="h-5 w-px bg-ink-100 hidden sm:block" />
            <span className="text-xs text-ink-500 hidden md:inline">
              Content structure
            </span>
            <ContentStructurePicker
              current={contentStructure}
              onPick={switchStructureMode}
              disabled={generating}
            />
            <div className="h-5 w-px bg-ink-100 hidden sm:block" />
            <span className="text-xs text-ink-500 hidden md:inline">
              PDF style
            </span>
            <PdfStylePicker
              current={pdfStyle}
              onPick={(id) => {
                setPdfStyle(id);
                setContentVersion("full");
                setFitConflict(null);
                setFitError(null);
                if (id !== "personalized") {
                  setPdfPalette(getDefaultPaletteId(id));
                }
                if (id === "personalized" && personalizedStatus === "failed") {
                  setPersonalizedError(null);
                  setPersonalizedStatus("idle");
                  personalizeRan.current = false;
                }
              }}
              personalizedStatus={personalizedStatus}
            />
            {pdfStyle === "personalized" && personalizedStyleProfile ? (
              <button
                type="button"
                disabled={personalizedStatus === "generating"}
                onClick={() => {
                  personalizeRan.current = true;
                  setContentVersion("full");
                  setFitConflict(null);
                  setFitError(null);
                  clearFitVariantsForStyle("personalized");
                  void generatePersonalized();
                }}
                className="btn btn-outline min-h-11 !px-2.5 text-xs"
                title="Rebuild the uploaded resume's page regions and visual style"
              >
                <RefreshCw
                  size={13}
                  className={
                    personalizedStatus === "generating"
                      ? "animate-spin"
                      : undefined
                  }
                />
                {personalizedStatus === "generating"
                  ? "Rebuilding layout…"
                  : "Rebuild layout"}
              </button>
            ) : null}
            {pdfStyle !== "personalized" ? (
              <PdfPalettePicker
                style={pdfStyle as FixedPdfStyle}
                current={pdfPalette}
                onPick={(palette) => {
                  setPdfPalette(palette);
                  setContentVersion("full");
                  setFitConflict(null);
                  setFitError(null);
                }}
              />
            ) : null}
            <div className="h-5 w-px bg-ink-100 hidden sm:block" />
            <span className="text-xs text-ink-500 hidden md:inline">
              Target length
            </span>
            <TargetPagesPicker
              current={targetPages}
              recommended={recommendedPages}
              onPick={(pages) => {
                setTargetPages(pages);
                setContentVersion("full");
                setFitConflict(null);
                setFitError(null);
              }}
            />
          </div>
        </div>

        {structureStale ? (
          <div
            role="status"
            className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div>
              <div className="font-medium">
                {optimizationNeedsStructureUpgrade
                  ? "Regenerate to apply optimized headings and order"
                  : `This result uses ${
                      optimizationStructureMode === "preserve"
                        ? "Keep original sections"
                        : "Optimize for role"
                    }`}
              </div>
              <p className="mt-0.5 text-xs text-amber-800">
                Generate a new version before fitting or downloading. Your
                current result remains visible and is saved in its own cache.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary min-h-11"
              disabled={generating}
              onClick={() =>
                void regenerate(selectedModel, contentStructure)
              }
            >
              <RefreshCw size={14} /> Regenerate with{" "}
              {contentStructure === "preserve"
                ? "original structure"
                : "role optimization"}
            </button>
          </div>
        ) : null}

        {!structureStale &&
        contentStructure === "preserve" &&
        optimization.structureIntegrity ? (
          <StructureIntegrityPanel
            integrity={optimization.structureIntegrity}
            sourceLayout={resume.sourceLayout}
            pdfStyle={pdfStyle}
          />
        ) : null}

        {optimizationModel && (
          <div className="mt-2 text-xs text-ink-400 flex items-center gap-1.5">
            <Cpu size={11} />
            Generated with{" "}
            <span className="text-ink-600 font-medium">
              {findModel(optimizationModel).name}
            </span>
            . Pick another model to compare rewrites.
          </div>
        )}

        {targetPages !== "auto" && !structureStale ? (
          <ResumeFitPanel
            fitting={fitting}
            stage={fitStage}
            variant={activeFitVariant}
            conflict={fitConflict}
            error={fitError}
            outdated={hasOutdatedFit}
            onFit={() => void runFit()}
            onCancel={() => {
              fitCancelledRef.current = true;
              setFitError("Page fitting was cancelled. Retry when you are ready.");
              fitAbortRef.current?.abort();
            }}
            onKeep={(contentId) => {
              toggleFitKeepId(contentId);
              setContentVersion("full");
              setFitConflict(null);
            }}
            onRestore={(contentId) => {
              toggleLockedContentId(contentId);
              setContentVersion("full");
              setFitConflict(null);
              setFitError(null);
            }}
          />
        ) : null}

        {activeFitVariant ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-100 bg-white px-3 py-2">
            <div>
              <div className="text-sm font-medium text-ink-900">
                Content version
              </div>
              <div className="text-xs text-ink-500">
                Page-fit choices never overwrite the complete optimized master.
              </div>
            </div>
            <div
              className="flex rounded-lg bg-ink-50 p-1"
              role="group"
              aria-label="Resume content version"
            >
              <button
                type="button"
                onClick={() => setContentVersion("full")}
                className={cn(
                  "min-h-10 rounded-md px-3 text-sm font-medium transition",
                  contentVersion === "full"
                    ? "bg-white text-ink-900 shadow-soft"
                    : "text-ink-500 hover:text-ink-900",
                )}
              >
                Full optimized
              </button>
              <button
                type="button"
                onClick={() => setContentVersion("fitted")}
                className={cn(
                  "min-h-10 rounded-md px-3 text-sm font-medium transition",
                  contentVersion === "fitted"
                    ? "bg-ink-900 text-white"
                    : "text-ink-500 hover:text-ink-900",
                )}
              >
                {targetPages}-page {pdfStyle}
              </button>
            </div>
          </div>
        ) : null}

        {evidenceMode && (
          <div className="mt-3 rounded-lg border border-accent-200 bg-accent-50/40 px-4 py-3 text-sm text-ink-700 flex items-start gap-2.5">
            <Info size={14} className="mt-0.5 text-accent-600 shrink-0" />
            <div>
              Hover any bullet in the{" "}
              <span className="font-medium">optimized resume</span> to see
              exactly which sentences from your original resume back it up. We
              never invent experience.
            </div>
          </div>
        )}

        {/* Main split view */}
        {view === "edit" ? (
          <div className="mt-5">
            {!resume ? (
              <div className="card p-8 text-center">
                <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 mx-auto inline-flex items-center justify-center">
                  <AlertCircle size={20} />
                </div>
                <h2 className="text-xl font-semibold mt-4 text-ink-900">
                  Upload a resume first
                </h2>
                <p className="text-ink-500 text-sm mt-2">
                  You need to upload and parse your resume before you can edit it.
                </p>
                <button
                  onClick={() => router.push("/upload")}
                  className="btn btn-primary mt-5"
                >
                  Upload Resume
                </button>
              </div>
            ) : (
              <EditorWithPreview
                resume={resume}
                optimization={optimization}
                pdfStyle={pdfStyle}
                pdfPalette={pdfPalette}
                targetPages={targetPages}
                previewTargetPages={
                  fittedViewActive ? targetPages : "auto"
                }
                previewFitVariant={
                  fittedViewActive ? activeFitVariant : null
                }
                sourceRevision={sourceRevision}
                pageSize={outputPage}
                personalizedStyleProfile={personalizedStyleProfile}
                personalizedStatus={personalizedStatus}
                personalizedError={personalizedError}
                includeSummary={summaryEnabled}
                onRetryPersonalized={() => {
                  personalizeRan.current = true;
                  void generatePersonalized();
                }}
                onResumeChange={(nextResume) => {
                  setContentVersion("full");
                  setFitConflict(null);
                  setFitError(null);
                  setResume(nextResume);
                }}
                onRegenerate={() => regenerate(selectedModel)}
                regenerating={generating}
                keptContentIds={protectedContentIds}
                lockedContentIds={lockedContentIds}
                onToggleKeep={(contentId) => {
                  toggleFitKeepId(contentId);
                  setContentVersion("full");
                  setFitConflict(null);
                  setFitError(null);
                }}
              />
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {(view === "split" || view === "original") && (
              <PaneWrapper
                title={
                  resumeStyleSource?.screenshots.length
                    ? "Original PDF"
                    : "Original content (reconstructed)"
                }
                tone="muted"
                meta={
                  resume.sourceLayout
                    ? `${resume.sourceLayout.pageCount} ${
                        resume.sourceLayout.pageCount === 1 ? "page" : "pages"
                      } · ${
                        resume.sourceLayout.maxColumns === 2
                          ? "Multi-column"
                          : "Single-column"
                      }`
                    : `${pageLabel} · Source content`
                }
              >
                {resumeStyleSource?.screenshots.length ? (
                  <OriginalDocumentPreview source={resumeStyleSource} />
                ) : (
                  <ResumeView
                    mode="original"
                    resume={resume}
                    optimization={optimization}
                    hoveredEvidence={hoveredEvidence}
                    hoveredOptimizedId={hoveredOptimizedId}
                    setHoveredOptimizedId={setHoveredOptimizedId}
                    evidenceMode={evidenceMode}
                  />
                )}
              </PaneWrapper>
            )}
            {(view === "split" || view === "optimized") && (
              <PaneWrapper
                title={
                  fittedViewActive
                    ? `${targetPages}-page version for ${job.title}`
                    : `Optimized for ${job.title}`
                }
                tone="accent"
                meta={
                  `${pageLabel} · ${
                    fittedViewActive
                      ? `Exactly ${targetPages} ${
                          targetPages === 1 ? "page" : "pages"
                        }`
                      : targetPages === "auto"
                        ? "Target · Auto"
                        : `Not fitted · ${targetPages}-page target`
                  }`
                }
              >
                <ResumeView
                  mode="optimized"
                  resume={displayedResume ?? resume}
                  optimization={displayedOptimization}
                  hoveredEvidence={hoveredEvidence}
                  hoveredOptimizedId={hoveredOptimizedId}
                  setHoveredOptimizedId={setHoveredOptimizedId}
                  evidenceMode={evidenceMode}
                  includeSummary={summaryEnabled}
                />
              </PaneWrapper>
            )}
          </div>
        )}

        {/* Evidence detail */}
        {view !== "edit" && evidenceMode && <EvidencePanel hoveredId={hoveredOptimizedId} />}

        {/* Bullet diff */}
        {view !== "edit" && <BulletDiff />}

        {view !== "edit" && (
          <>
            <div className="mt-12 flex items-center justify-between pb-12">
              <button
                className="btn btn-outline"
                onClick={() => regenerate(selectedModel)}
                disabled={generating}
              >
                <ArrowLeftRight size={14} /> Generate another variation
              </button>
              <button
                className="btn btn-primary !px-5"
                onClick={() => void primaryAction()}
                disabled={primaryDisabled}
              >
                {fitting ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Fitting…
                  </>
                ) : exporting ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Preparing…
                  </>
                ) : needsFit ? (
                  <>
                    <Sparkles size={14} /> Fit to {targetPages}{" "}
                    {targetPages === 1 ? "page" : "pages"}
                  </>
                ) : (
                  <>
                    <Download size={14} /> Download PDF
                  </>
                )}
              </button>
            </div>

            <div className="text-xs text-ink-400 text-center">
              {bulletsRewritten} bullets rewritten · Every change evidence-backed
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function PaneWrapper({
  title,
  children,
  tone,
  meta,
}: {
  title: string;
  children: React.ReactNode;
  tone: "muted" | "accent";
  meta: string;
}) {
  return (
    <div>
      <div
        className={cn(
          "flex items-center justify-between mb-2 text-xs",
          tone === "accent" ? "text-accent-700" : "text-ink-500",
        )}
      >
        <span className="font-medium">{title}</span>
        <span className="text-ink-400">{meta}</span>
      </div>
      {children}
    </div>
  );
}

function StructureIntegrityPanel({
  integrity,
  sourceLayout,
  pdfStyle,
}: {
  integrity: StructureIntegrity;
  sourceLayout?: Resume["sourceLayout"];
  pdfStyle: PdfStyle;
}) {
  const checks = [
    `${integrity.sectionsPreserved}/${integrity.totalSections} sections`,
    `${integrity.entriesPreserved}/${integrity.totalEntries} entries`,
    `${integrity.bulletsPreserved}/${integrity.totalBullets} bullets`,
    `${integrity.factualFieldsChanged} factual fields changed`,
  ];
  return (
    <div
      role={integrity.valid ? "status" : "alert"}
      className={cn(
        "mt-3 rounded-xl border px-4 py-3",
        integrity.valid
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-rose-200 bg-rose-50 text-rose-900",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {integrity.valid ? (
          <ShieldCheck size={16} />
        ) : (
          <AlertCircle size={16} />
        )}
        {integrity.valid
          ? "Full resume structure verified"
          : "Structure integrity failed"}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {checks.map((check) => (
          <span key={check}>{check}</span>
        ))}
      </div>
      {!integrity.valid && integrity.issues.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {integrity.issues.slice(0, 6).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {integrity.valid ? (
        <p className="mt-2 text-xs leading-5 text-emerald-800">
          The full optimized master preserves headings, section order, entries,
          and bullets. Exact page-fit versions keep every source heading and its
          order, but may shorten or omit lower-priority entries, bullets, and
          skills while leaving content under every heading. The
          source was detected as {sourceLayout?.maxColumns === 2 ? "multi-column" : "single-column"};{" "}
          {pdfStyle === "personalized"
            ? "Original-inspired controls the recreated visual layout."
            : `the output still uses the selected ${
                PDF_STYLE_DEFINITIONS.find((style) => style.id === pdfStyle)
                  ?.label ?? pdfStyle
              } visual layout.`}
        </p>
      ) : null}
    </div>
  );
}

function ToolbarTab({
  active,
  onClick,
  icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 transition",
        disabled
          ? "text-ink-300 cursor-not-allowed"
          : active
            ? "bg-ink-900 text-white"
            : "text-ink-600 hover:bg-ink-100",
      )}
      title={disabled ? "Upload a resume first" : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "w-9 h-5 rounded-full relative transition",
        checked ? "bg-ink-900" : "bg-ink-200",
      )}
      aria-pressed={checked}
    >
      <span
        className={cn(
          "absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white shadow-soft transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function EvidencePanel({ hoveredId }: { hoveredId: string | null }) {
  const { resume, optimization } = useFlow();
  if (!resume || !optimization) return null;
  const all = [
    ...optimization.roles.flatMap((r) => r.bullets),
    ...(optimization.projects?.flatMap((p) => p.bullets) ?? []),
  ];
  const bullet = all.find((b) => b.id === hoveredId);
  const orig = [
    ...resume.experience.flatMap((r) => r.bullets),
    ...(resume.projects?.flatMap((p) => p.bullets) ?? []),
  ].filter((b) => bullet?.evidence.includes(b.id));

  return (
    <div className="mt-5 card p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-ink-900">
        <Layers size={14} className="text-accent-600" />
        Evidence trace
        <span className="text-ink-400 font-normal text-xs ml-2">
          {bullet
            ? "Showing the original lines that back this rewrite."
            : "Hover an optimized bullet to inspect its source."}
        </span>
      </div>

      <div className="mt-4 grid md:grid-cols-2 gap-4 min-h-[120px]">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-ink-400 font-medium mb-1.5">
            Optimized
          </div>
          {bullet ? (
            <div className="rounded-lg border border-accent-200 bg-accent-50/40 p-3 text-sm text-ink-900">
              {bullet.text}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {bullet.matchedKeywords.map((k) => (
                  <span
                    key={k}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-accent-100 text-accent-700 font-medium"
                  >
                    {k}
                  </span>
                ))}
              </div>
              {bullet.rationale && (
                <div className="mt-3 text-xs text-ink-500 italic">
                  Why this change: {bullet.rationale}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 p-6 text-sm text-ink-400 text-center">
              No bullet selected
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-ink-400 font-medium mb-1.5">
            From your original resume
          </div>
          {orig.length ? (
            <div className="space-y-2">
              {orig.map((o) => (
                <div
                  key={o.id}
                  className="rounded-lg border border-ink-100 bg-white p-3 text-sm text-ink-700"
                >
                  <span className="evidence-active px-1.5 py-0.5">
                    {o.text}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 p-6 text-sm text-ink-400 text-center">
              {bullet ? "Inferred from full context" : "—"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BulletDiff() {
  const {
    resume,
    optimization,
    job,
    selectedModel,
    voiceCount,
    lockedContentIds,
    replaceOptimizedBullet,
    toggleLockedContentId,
    incrementVoiceCount,
  } = useFlow();
  if (!resume || !optimization) return null;
  const quotaRemaining = Math.max(0, VOICE_QUOTA - voiceCount);
  const renderActions = (
    ownerId: string,
    bullet: OptimizedBullet,
    source: ResumeBullet | null,
  ) => {
    const locked = lockedContentIds.includes(bullet.id);
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => toggleLockedContentId(bullet.id)}
          className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-ink-500 transition hover:bg-ink-50 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/10"
          aria-label={`${locked ? "Unlock" : "Lock"} rewritten bullet`}
          title={
            locked
              ? "Allow future regeneration and Fit to change this bullet"
              : "Keep this wording during future regeneration and Fit"
          }
        >
          {locked ? <Lock size={13} /> : <Unlock size={13} />}
          {locked ? "Locked" : "Lock"}
        </button>
        <button
          type="button"
          disabled={!source || bullet.text === source.text}
          onClick={() => {
            if (!source) return;
            replaceOptimizedBullet(ownerId, bullet.id, {
              ...bullet,
              text: source.text,
              evidence: [source.id],
              matchedKeywords: [],
              rationale: "Restored from the original resume by the user.",
            });
          }}
          className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-ink-500 transition hover:bg-ink-50 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-ink-900/10 disabled:cursor-not-allowed disabled:opacity-40"
          title="Restore the source wording and lock it"
        >
          <RotateCcw size={13} /> Restore original
        </button>
        <VoiceRefine
          roleId={ownerId}
          bullet={bullet}
          job={job}
          model={selectedModel}
          quotaRemaining={quotaRemaining}
          onAccept={replaceOptimizedBullet}
          onQuotaConsume={incrementVoiceCount}
        />
      </div>
    );
  };

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink-900">
          Bullet-by-bullet changes
        </h2>
        <div className="text-xs text-ink-400 flex items-center gap-3">
          <span>
            {optimization.roles.flatMap((r) => r.bullets).length +
              (optimization.projects?.flatMap((p) => p.bullets).length ?? 0) +
              (optimization.additionalSections?.flatMap((section) =>
                section.items.flatMap((item) => item.bullets),
              ).length ?? 0)}{" "}
            bullets rewritten
          </span>
          <span className="hidden sm:inline">·</span>
          <span
            className={cn(
              "inline-flex items-center gap-1",
              quotaRemaining === 0 && "text-rose-500",
            )}
          >
            <Mic size={12} /> {quotaRemaining}/{VOICE_QUOTA} voice refinements
          </span>
        </div>
      </div>

      <div className="mt-4 card overflow-hidden">
        {optimization.roles.map((role) => {
          const original = resume.experience.find((r) => r.id === role.id);
          if (!original) return null;
          return (
            <div key={role.id}>
              <div className="px-5 py-3 bg-ink-50/60 border-b border-ink-100 text-sm font-medium text-ink-900">
                {original.company}{" "}
                <span className="text-ink-500 font-normal">
                  · {original.title}
                </span>
              </div>
              <div className="divide-y divide-ink-100">
                {role.bullets.map((b, bulletIndex) => {
                  const orig = original.bullets.filter((o) =>
                    b.evidence.includes(o.id),
                  );
                  return (
                    <div
                      key={`${role.id}:${b.id}:${bulletIndex}`}
                      className="grid md:grid-cols-2 gap-0 md:gap-4 p-5 text-sm"
                    >
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-ink-400 font-medium mb-1.5">
                          Before
                        </div>
                        <div className="text-ink-500">
                          {orig.length
                            ? orig.map((o) => o.text).join(" / ")
                            : "Inferred from context"}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[10px] uppercase tracking-widest text-accent-600 font-medium">
                            After
                          </div>
                          {renderActions(
                            role.id,
                            b,
                            original.bullets.find(
                              (source) => source.id === b.id,
                            ) ?? orig[0] ?? null,
                          )}
                        </div>
                        <div className="text-ink-900">{b.text}</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {b.matchedKeywords.map((k) => (
                            <span
                              key={k}
                              className="text-[11px] px-2 py-0.5 rounded-md bg-accent-50 text-accent-700 border border-accent-100"
                            >
                              +{k}
                            </span>
                          ))}
                          {b.evidence.includes("voice-transcript") && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                              <Mic size={11} /> voice-attested
                            </span>
                          )}
                          {(b.suggestion === "cut" ||
                            b.suggestion === "trim") && (
                            <span
                              className={cn(
                                "text-[11px] px-2 py-0.5 rounded-md border font-medium",
                                b.suggestion === "cut"
                                  ? "bg-rose-50 text-rose-700 border-rose-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200",
                              )}
                              title={b.rationale || undefined}
                            >
                              {b.suggestion === "cut"
                                ? "Low relevance — consider cutting"
                                : "Consider trimming"}
                              {typeof b.relevance === "number"
                                ? ` · ${b.relevance}/100`
                                : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {optimization.projects?.map((project) => {
          const original = resume.projects?.find((p) => p.id === project.id);
          if (!original) return null;
          return (
            <div key={project.id}>
              <div className="px-5 py-3 bg-ink-50/60 border-b border-ink-100 text-sm font-medium text-ink-900">
                {original.name}{" "}
                <span className="text-ink-500 font-normal">
                  · {original.role}
                </span>
              </div>
              <div className="divide-y divide-ink-100">
                {project.bullets.map((b, bulletIndex) => {
                  const orig = original.bullets.filter((o) =>
                    b.evidence.includes(o.id),
                  );
                  return (
                    <div
                      key={`${project.id}:${b.id}:${bulletIndex}`}
                      className="grid md:grid-cols-2 gap-0 md:gap-4 p-5 text-sm"
                    >
                      <div>
                        <div className="text-[10px] uppercase tracking-widest text-ink-400 font-medium mb-1.5">
                          Before
                        </div>
                        <div className="text-ink-500">
                          {orig.length
                            ? orig.map((o) => o.text).join(" / ")
                            : "Inferred from context"}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[10px] uppercase tracking-widest text-accent-600 font-medium">
                            After
                          </div>
                          {renderActions(
                            project.id,
                            b,
                            original.bullets.find(
                              (source) => source.id === b.id,
                            ) ?? orig[0] ?? null,
                          )}
                        </div>
                        <div className="text-ink-900">{b.text}</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {b.matchedKeywords.map((k) => (
                            <span
                              key={k}
                              className="text-[11px] px-2 py-0.5 rounded-md bg-accent-50 text-accent-700 border border-accent-100"
                            >
                              +{k}
                            </span>
                          ))}
                          {b.evidence.includes("voice-transcript") && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                              <Mic size={11} /> voice-attested
                            </span>
                          )}
                          {(b.suggestion === "cut" ||
                            b.suggestion === "trim") && (
                            <span
                              className={cn(
                                "text-[11px] px-2 py-0.5 rounded-md border font-medium",
                                b.suggestion === "cut"
                                  ? "bg-rose-50 text-rose-700 border-rose-200"
                                  : "bg-amber-50 text-amber-700 border-amber-200",
                              )}
                              title={b.rationale || undefined}
                            >
                              {b.suggestion === "cut"
                                ? "Low relevance — consider cutting"
                                : "Consider trimming"}
                              {typeof b.relevance === "number"
                                ? ` · ${b.relevance}/100`
                                : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {optimization.additionalSections?.flatMap((section) => {
          const originalSection = resume.additionalSections?.find(
            (candidate) => candidate.id === section.id,
          );
          if (!originalSection) return [];
          return section.items.map((item) => {
            const originalItem = originalSection.items.find(
              (candidate) => candidate.id === item.id,
            );
            if (!originalItem) return null;
            return (
              <div key={`${section.id}:${item.id}`}>
                <div className="border-b border-ink-100 bg-ink-50/60 px-5 py-3 text-sm font-medium text-ink-900">
                  {originalSection.title}
                  {originalItem.heading ? (
                    <span className="font-normal text-ink-500">
                      {" "}· {originalItem.heading}
                    </span>
                  ) : null}
                </div>
                <div className="divide-y divide-ink-100">
                  {item.bullets.map((bullet, bulletIndex) => {
                    const evidence = originalItem.bullets.filter((source) =>
                      bullet.evidence.includes(source.id),
                    );
                    const source =
                      originalItem.bullets.find(
                        (candidate) => candidate.id === bullet.id,
                      ) ?? evidence[0] ?? null;
                    return (
                      <div
                        key={`${section.id}:${item.id}:${bullet.id}:${bulletIndex}`}
                        className="grid gap-4 p-5 text-sm md:grid-cols-2"
                      >
                        <div>
                          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-ink-400">
                            Before
                          </div>
                          <div className="text-ink-500">
                            {evidence.length
                              ? evidence.map((candidate) => candidate.text).join(" / ")
                              : "Inferred from context"}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <div className="text-[10px] font-medium uppercase tracking-widest text-accent-600">
                              After
                            </div>
                            {renderActions(item.id, bullet, source)}
                          </div>
                          <div className="text-ink-900">{bullet.text}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}
