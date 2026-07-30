// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { AppShell } from "@/components/AppShell";
import { ModelPicker } from "@/components/ModelPicker";
import { PdfStylePicker } from "@/components/PdfStylePicker";
import { ResumeView } from "@/components/ResumeView";
import { EditorWithPreview } from "@/components/EditorWithPreview";
import { VoiceRefine } from "@/components/VoiceRefine";
import { findModel } from "@/lib/models";
import { applyOptimizationToResume } from "@/lib/applyOptimization";
import { VOICE_QUOTA, useFlow } from "@/lib/store";
import { cn } from "@/lib/cn";
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
  Sparkles,
  Pencil,
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
    selectedModel,
    pdfStyle,
    resumeStyleSource,
    personalizedStyleProfile,
    personalizedStatus,
    paid,
    setResume,
    setJob,
    setReport,
    setMeasuredScore,
    setOptimization,
    setSelectedModel,
    setPdfStyle,
    setResumeStyleSource,
    setPersonalizedStyleProfile,
    setPersonalizedStatus,
    clearOptimization,
    markPaid,
  } = useFlow();
  const [view, setView] = useState<View>("split");
  const [evidenceMode, setEvidenceMode] = useState(true);
  const [hoveredOptimizedId, setHoveredOptimizedId] = useState<string | null>(
    null,
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const ran = useRef(false);
  const personalizeRan = useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Email-link identity: if URL has ?order=xxx&token=yyy, this is the
  // "return by email" flow. It grants access regardless of localStorage.
  const orderIdFromUrl = searchParams?.get("order") || null;
  const tokenFromUrl = searchParams?.get("token") || null;
  const hasEmailAccess = !!(orderIdFromUrl && tokenFromUrl);

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
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: applyOptimizationToResume(resumeArg, optimized),
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

  const runOptimize = async (modelId: string) => {
    if (!resume || !job || !report) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume, job, report, model: modelId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Optimization failed");
      setOptimization(data.optimization, modelId);
      void rescoreOptimized(data.optimization, modelId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed.");
    } finally {
      setGenerating(false);
    }
  };

  const regenerate = async (modelId: string) => {
    clearOptimization();
    setHoveredOptimizedId(null);
    await runOptimize(modelId);
  };

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [personalizedError, setPersonalizedError] = useState<string | null>(
    null,
  );

  const downloadPdf = async () => {
    if (!resume || !optimization) return;
    setExporting(true);
    setExportError(null);
    try {
      if (pdfStyle === "personalized" && !personalizedStyleProfile) {
        throw new Error(
          personalizedStatus === "failed"
            ? personalizedError ||
                "Personalized layout failed. Retry or choose Classic."
            : "Personalized layout is still generating.",
        );
      }
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume,
          optimization,
          targetTitle: job?.title || "",
          style: pdfStyle,
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleSource: resumeStyleSource }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.styleProfile) {
        throw new Error(data.error || "Personalized layout generation failed.");
      }
      setPersonalizedStyleProfile(data.styleProfile);
    } catch (personalizeFailure) {
      setPersonalizedStatus("failed");
      setPersonalizedError(
        personalizeFailure instanceof Error
          ? personalizeFailure.message
          : "Personalized layout generation failed.",
      );
    }
  }, [
    resumeStyleSource,
    setPersonalizedStatus,
    setPersonalizedStyleProfile,
  ]);

  // Runs alongside runOptimize (not blocking it) — the personalized style
  // takes far longer than the fixed templates, so it shouldn't hold up the
  // rest of the page. Only fires once per resume, at most.
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

          if (snap?.resume) setResume(snap.resume);
          if (snap?.job) setJob(snap.job);
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
          if (snap?.optimization && snap?.optimizationModel) {
            setOptimization(snap.optimization, snap.optimizationModel);
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
            setReport(stubReport);
            await runOptimize(selectedModel);
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
          personalizedStyleProfile,
        }),
      },
    ).catch(() => {
      /* non-fatal — user still sees the resume */
    });
  }, [
    optimization,
    optimizationModel,
    personalizedStyleProfile,
    hasEmailAccess,
    orderIdFromUrl,
    tokenFromUrl,
  ]);

  const allOptimized = useMemo(
    () => [
      ...(optimization?.roles.flatMap((r) => r.bullets) ?? []),
      ...(optimization?.projects?.flatMap((p) => p.bullets) ?? []),
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
          <div className="card p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 mx-auto inline-flex items-center justify-center">
              <AlertCircle size={20} />
            </div>
            <h2 className="text-xl font-semibold mt-4 text-ink-900">
              Optimization failed
            </h2>
            <p className="text-ink-500 text-sm mt-2">{error}</p>
            <p className="text-ink-400 text-xs mt-3">
              If this model isn't available, try a different one.
            </p>
            <div className="mt-3 flex justify-center">
              <ModelPicker
                current={selectedModel}
                onPick={(id) => {
                  setSelectedModel(id);
                  setError(null);
                  regenerate(id);
                }}
              />
            </div>
            <button
              onClick={() => {
                setError(null);
                ran.current = false;
                location.reload();
              }}
              className="btn btn-primary mt-5"
            >
              Retry
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (generating || !optimization) {
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

  const bulletsRewritten = allOptimized.length;

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
              {typeof report.measuredAfter === "number" ? (
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
              onClick={downloadPdf}
              disabled={
                exporting ||
                generating ||
                !optimization ||
                (pdfStyle === "personalized" &&
                  personalizedStatus !== "ready")
              }
            >
              {exporting ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Preparing…
                </>
              ) : (
                <>
                  <Download size={14} /> Download PDF
                </>
              )}
            </button>
          </div>
        </div>

        {exportError && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          >
            {exportError}
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
                  "Personalized layout failed. Retry or choose Classic."}
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
            <div className="h-5 w-px bg-ink-100 hidden sm:block" />
            <ModelPicker
              current={selectedModel}
              onPick={(id) => {
                setSelectedModel(id);
                if (id !== optimizationModel) regenerate(id);
              }}
              onRegenerate={() => regenerate(selectedModel)}
              regenerating={generating}
              compact
            />
            <div className="h-5 w-px bg-ink-100 hidden sm:block" />
            <span className="text-xs text-ink-500 hidden md:inline">
              PDF style
            </span>
            <PdfStylePicker
              current={pdfStyle}
                onPick={(id) => {
                  setPdfStyle(id);
                  if (id === "personalized" && personalizedStatus === "failed") {
                    setPersonalizedError(null);
                    setPersonalizedStatus("idle");
                    personalizeRan.current = false;
                  }
              }}
              personalizedStatus={personalizedStatus}
            />
          </div>
        </div>

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
                onResumeChange={setResume}
                onRegenerate={() => regenerate(selectedModel)}
                regenerating={generating}
              />
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {(view === "split" || view === "original") && (
              <PaneWrapper title="Your original" tone="muted">
                <ResumeView
                  mode="original"
                  resume={resume}
                  optimization={optimization}
                  hoveredEvidence={hoveredEvidence}
                  hoveredOptimizedId={hoveredOptimizedId}
                  setHoveredOptimizedId={setHoveredOptimizedId}
                  evidenceMode={evidenceMode}
                />
              </PaneWrapper>
            )}
            {(view === "split" || view === "optimized") && (
              <PaneWrapper
                title={`Optimized for ${job.title}`}
                tone="accent"
              >
                <ResumeView
                  mode="optimized"
                  resume={resume}
                  optimization={optimization}
                  hoveredEvidence={hoveredEvidence}
                  hoveredOptimizedId={hoveredOptimizedId}
                  setHoveredOptimizedId={setHoveredOptimizedId}
                  evidenceMode={evidenceMode}
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
                onClick={downloadPdf}
                disabled={
                  exporting ||
                  generating ||
                  !optimization ||
                  (pdfStyle === "personalized" &&
                    personalizedStatus !== "ready")
                }
              >
                {exporting ? (
                  <>
                    <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Preparing…
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
}: {
  title: string;
  children: React.ReactNode;
  tone: "muted" | "accent";
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
        <span className="text-ink-400">Letter · 1 page</span>
      </div>
      {children}
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
          "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-soft transition-transform",
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
    replaceOptimizedBullet,
    incrementVoiceCount,
  } = useFlow();
  if (!resume || !optimization) return null;
  const quotaRemaining = Math.max(0, VOICE_QUOTA - voiceCount);

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink-900">
          Bullet-by-bullet changes
        </h2>
        <div className="text-xs text-ink-400 flex items-center gap-3">
          <span>
            {optimization.roles.flatMap((r) => r.bullets).length +
              (optimization.projects?.flatMap((p) => p.bullets).length ?? 0)}{" "}
            bullets rewritten
          </span>
          <span className="hidden sm:inline">·</span>
          <span
            className={cn(
              "inline-flex items-center gap-1",
              quotaRemaining === 0 && "text-rose-500",
            )}
          >
            🎙 {quotaRemaining}/{VOICE_QUOTA} voice refinements
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
                {role.bullets.map((b) => {
                  const orig = original.bullets.filter((o) =>
                    b.evidence.includes(o.id),
                  );
                  return (
                    <div
                      key={b.id}
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
                          <VoiceRefine
                            roleId={role.id}
                            bullet={b}
                            job={job}
                            model={selectedModel}
                            quotaRemaining={quotaRemaining}
                            onAccept={replaceOptimizedBullet}
                            onQuotaConsume={incrementVoiceCount}
                          />
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
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                              🎙 voice-attested
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
                {project.bullets.map((b) => {
                  const orig = original.bullets.filter((o) =>
                    b.evidence.includes(o.id),
                  );
                  return (
                    <div
                      key={b.id}
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
                          <VoiceRefine
                            roleId={project.id}
                            bullet={b}
                            job={job}
                            model={selectedModel}
                            quotaRemaining={quotaRemaining}
                            onAccept={replaceOptimizedBullet}
                            onQuotaConsume={incrementVoiceCount}
                          />
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
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
                              🎙 voice-attested
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
      </div>
    </div>
  );
}
