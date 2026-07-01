"use client";

import { AppShell } from "@/components/AppShell";
import { useFlow } from "@/lib/store";
import type { PreviewBullet } from "@/lib/types";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Lock,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const STAGES = [
  "Parsing resume structure",
  "Extracting job requirements",
  "Cross-referencing experience",
  "Scoring ATS compatibility",
  "Identifying keyword gaps",
];

export default function AnalysisPage() {
  const {
    resume,
    job,
    report,
    preview,
    selectedModel,
    setReport,
    setPreview,
  } = useFlow();
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const router = useRouter();
  const ran = useRef(false);
  const previewRan = useRef(false);

  // Kick off the free preview bullet rewrite as soon as report is ready.
  useEffect(() => {
    if (!report || !resume || !job || preview || previewRan.current) return;
    previewRan.current = true;
    setPreviewLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume,
            job,
            report,
            mode: "preview",
            model: selectedModel,
          }),
        });
        const data = await res.json();
        if (res.ok && data.preview) {
          setPreview({
            preview: data.preview,
            targetBulletId: data.targetBulletId,
            targetBulletText: data.targetBulletText,
          });
        }
      } catch {
        // Preview failure is non-fatal — paid path still works.
      } finally {
        setPreviewLoading(false);
      }
    })();
  }, [report, resume, job, preview, selectedModel, setPreview]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!resume || !job) {
      router.replace(!resume ? "/upload" : "/job");
      return;
    }

    if (report) {
      setStage(STAGES.length);
      return;
    }

    let cancelled = false;
    const tick = setInterval(() => {
      if (!cancelled) setStage((s) => Math.min(s + 1, STAGES.length - 1));
    }, 900);

    (async () => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume, job, model: selectedModel }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        if (!cancelled) {
          setReport(data.report);
          setStage(STAGES.length);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Analysis failed.");
        }
      } finally {
        clearInterval(tick);
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalBullets =
    resume?.experience.reduce((n, r) => n + r.bullets.length, 0) ?? 0;

  return (
    <AppShell step="analysis">
      <div className="container-x py-10 max-w-5xl">
        {error ? (
          <ErrorBox message={error} />
        ) : !report ? (
          <Analyzing stage={stage} />
        ) : (
          <Report
            preview={preview}
            previewLoading={previewLoading}
            totalBullets={totalBullets}
          />
        )}
      </div>
    </AppShell>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="card p-8 text-center">
      <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 mx-auto inline-flex items-center justify-center">
        <AlertCircle size={20} />
      </div>
      <h2 className="text-xl font-semibold mt-4 text-ink-900">
        Analysis failed
      </h2>
      <p className="text-ink-500 text-sm mt-2">{message}</p>
      <Link href="/job" className="btn btn-outline mt-5 inline-flex">
        Try again
      </Link>
    </div>
  );
}

function Analyzing({ stage }: { stage: number }) {
  return (
    <div className="card p-10 text-center">
      <div className="w-12 h-12 rounded-xl bg-ink-900 text-white mx-auto inline-flex items-center justify-center">
        <Sparkles size={20} />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight mt-5 text-ink-900">
        Analyzing your resume…
      </h2>
      <p className="text-ink-500 mt-2">
        Running against the job description. About 20 seconds.
      </p>
      <div className="mt-8 max-w-md mx-auto text-left space-y-2.5">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center gap-3 text-sm">
            <span
              className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] shrink-0 ${
                i < stage
                  ? "bg-ink-900 text-white"
                  : i === stage
                    ? "bg-accent-100 text-accent-700"
                    : "bg-ink-100 text-ink-400"
              }`}
            >
              {i < stage ? (
                <Check size={11} strokeWidth={3} />
              ) : i === stage ? (
                <span className="w-2 h-2 rounded-full bg-accent-600 animate-pulse" />
              ) : (
                i + 1
              )}
            </span>
            <span className={i <= stage ? "text-ink-900" : "text-ink-400"}>
              {s}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Report({
  preview,
  previewLoading,
  totalBullets,
}: {
  preview: PreviewBullet | null;
  previewLoading: boolean;
  totalBullets: number;
}) {
  const { report } = useFlow();
  if (!report) return null;
  const remainingBullets = Math.max(totalBullets - 1, 0);

  return (
    <div className="space-y-6 animate-rise">
      <div className="card p-6 grid md:grid-cols-3 gap-6 items-center">
        <div className="text-center md:text-left md:col-span-1">
          <div className="text-xs text-ink-500">Your current ATS score</div>
          <div className="mt-1 flex items-baseline gap-2 justify-center md:justify-start">
            <span className="text-5xl font-semibold tracking-tight tabular-nums text-ink-900">
              {report.overallBefore}
            </span>
            <span className="text-ink-400 text-sm">/ 100</span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
            <AlertTriangle size={11} />
            {report.overallBefore < 65 ? "Needs work" : "Decent · room to grow"}
          </div>
        </div>
        <div className="md:col-span-2 rounded-xl bg-gradient-to-br from-ink-900 to-ink-700 text-white p-5">
          <div className="text-xs text-white/60">
            With NextResume optimization
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-5xl font-semibold tracking-tight tabular-nums">
              {report.overallAfter}
            </span>
            <span className="text-white/60 text-sm">/ 100</span>
            <span className="ml-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-300">
              <TrendingUp size={14} />+
              {report.overallAfter - report.overallBefore} points
            </span>
          </div>
          <p className="mt-2 text-sm text-white/70 max-w-md">
            Unlock the full rewrite to apply all improvements. Every change is
            evidence-backed and traceable to your real experience.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-5">
          <h3 className="font-semibold text-ink-900">Category breakdown</h3>
          <p className="text-xs text-ink-500 mt-1">
            How the AI scores your resume against this job.
          </p>
          <div className="mt-4 space-y-3">
            {report.categoriesBefore.map((c, i) => {
              const after = report.categoriesAfter[i]?.score ?? c.score;
              return (
                <div key={c.label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink-800 font-medium">{c.label}</span>
                    <span className="tabular-nums text-ink-400">
                      {c.score} → <span className="text-ink-900">{after}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-ink-100 rounded-full relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-ink-300"
                      style={{ width: `${c.score}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent-500 to-accent-700 mix-blend-multiply"
                      style={{ width: `${after}%`, opacity: 0.85 }}
                    />
                  </div>
                  <p className="text-xs text-ink-500 mt-1.5">{c.detail}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-ink-900">Missing keywords</h3>
          <p className="text-xs text-ink-500 mt-1">
            Terms from the JD that don't appear in your resume.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {report.missingKeywords.map((k) => (
              <span
                key={k}
                className="text-xs px-2 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-100"
              >
                — {k}
              </span>
            ))}
          </div>

          {report.presentKeywords.length > 0 && (
            <>
              <div className="hairline my-5" />
              <h4 className="font-semibold text-ink-900 text-sm">
                Where you're strong
              </h4>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {report.presentKeywords.map((k) => (
                  <span
                    key={k}
                    className="text-xs px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100"
                  >
                    ✓ {k}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <PreviewBulletBlock
        preview={preview}
        loading={previewLoading}
        remaining={remainingBullets}
      />

      <div className="card p-6 bg-gradient-to-br from-white to-accent-50/40 border-accent-100">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-ink-900 text-white inline-flex items-center justify-center shrink-0">
            <Lock size={16} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-ink-900">
              Unlock the optimized resume
            </h3>
            <p className="text-sm text-ink-500 mt-1">
              One-time $9.99. Tailored rewrite, Evidence Mode, side-by-side
              comparison, and browser PDF export.
            </p>
          </div>
          <Link href="/checkout" className="btn btn-primary">
            Unlock for $9.99
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Link href="/job" className="btn btn-ghost">
          <ArrowLeft size={14} /> Edit job description
        </Link>
        <Link href="/checkout" className="btn btn-accent !px-5">
          Unlock optimized resume
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function PreviewBulletBlock({
  preview,
  loading,
  remaining,
}: {
  preview: PreviewBullet | null;
  loading: boolean;
  remaining: number;
}) {
  if (!preview && !loading) return null;

  return (
    <div className="card overflow-hidden border-accent-200">
      <div className="px-5 py-3 bg-gradient-to-r from-accent-50/60 to-white border-b border-accent-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="pill !text-accent-700 !border-accent-200 !bg-white">
            <Sparkles size={11} />
            Free preview · 1 bullet rewritten
          </span>
        </div>
        <span className="text-xs text-ink-400 hidden sm:inline">
          See how Evidence Mode works before you pay
        </span>
      </div>

      {loading || !preview ? (
        <div className="p-6 grid md:grid-cols-2 gap-4">
          <PreviewSkeleton label="Your original" />
          <PreviewSkeleton label="Tailored rewrite" tone="accent" />
        </div>
      ) : (
        <div className="p-5 grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-ink-400 font-medium mb-1.5">
              Your original bullet
            </div>
            <div className="rounded-lg border border-ink-100 bg-white p-3 text-sm text-ink-700">
              <span className="evidence-active px-1.5 py-0.5">
                {preview.targetBulletText}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-accent-600 font-medium mb-1.5">
              Rewritten for this job
            </div>
            <div className="rounded-lg border border-accent-200 bg-accent-50/40 p-3 text-sm text-ink-900">
              {preview.preview.text}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {preview.preview.matchedKeywords.map((k) => (
                  <span
                    key={k}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-accent-100 text-accent-700 font-medium"
                  >
                    +{k}
                  </span>
                ))}
              </div>
              {preview.preview.rationale && (
                <div className="mt-3 text-xs text-ink-500 italic">
                  Why this is stronger: {preview.preview.rationale}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="px-5 py-3 bg-ink-50/50 border-t border-ink-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-sm text-ink-700">
          <span className="font-medium text-ink-900">
            {remaining > 0
              ? `${remaining} more ${remaining === 1 ? "bullet" : "bullets"} to rewrite.`
              : "Unlock the full rewrite."}
          </span>{" "}
          <span className="text-ink-500">
            Includes Evidence Mode, side-by-side, and exports.
          </span>
        </div>
        <Link href="/checkout" className="btn btn-primary">
          Unlock the rest for $9.99
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

function PreviewSkeleton({
  label,
  tone,
}: {
  label: string;
  tone?: "accent";
}) {
  return (
    <div>
      <div
        className={`text-[10px] uppercase tracking-widest font-medium mb-1.5 ${
          tone === "accent" ? "text-accent-600" : "text-ink-400"
        }`}
      >
        {label}
      </div>
      <div
        className={`rounded-lg p-3 space-y-2 ${
          tone === "accent"
            ? "border border-accent-200 bg-accent-50/40"
            : "border border-ink-100 bg-white"
        }`}
      >
        <div className="h-3 rounded shimmer bg-ink-100" />
        <div className="h-3 rounded shimmer bg-ink-100 w-5/6" />
        <div className="h-3 rounded shimmer bg-ink-100 w-2/3" />
      </div>
    </div>
  );
}
