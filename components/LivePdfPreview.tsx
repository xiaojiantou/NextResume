// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import type {
  Resume,
  Optimization,
  ResumePageSpec,
  ResumeStyleProfile,
} from "@/lib/types";
import type { PdfStyle, TargetPages } from "@/lib/pdf/config";
import type { ResumeFitVariant } from "@/lib/resumeFit";
import { orderAuthHeaders } from "@/lib/store";
import {
  createPdfPreviewCacheEntry,
  loadPdfPreviewCache,
  savePdfPreviewCache,
} from "@/lib/pdfPreviewCache";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function LivePdfPreview({
  resume,
  optimization,
  style,
  palette,
  targetPages,
  pageSize,
  personalizedStyleProfile,
  fitVariant,
  sourceRevision,
  personalizedStatus,
  personalizedError,
  onRetryPersonalized,
  includeSummary,
}: {
  resume: Resume;
  optimization: Optimization | null;
  style: PdfStyle;
  palette: string;
  targetPages: TargetPages;
  pageSize: ResumePageSpec;
  personalizedStyleProfile: ResumeStyleProfile | null;
  fitVariant?: ResumeFitVariant | null;
  sourceRevision?: string | null;
  personalizedStatus?: "idle" | "generating" | "ready" | "failed";
  personalizedError?: string | null;
  onRetryPersonalized?: () => void;
  includeSummary?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const [approximateLayout, setApproximateLayout] = useState(false);
  const currentUrlRef = useRef<string | null>(null);
  const lastCacheBypassNonceRef = useRef(0);
  const retryUntilRef = useRef(0);
  const cacheEntry = useMemo(
    () =>
      createPdfPreviewCacheEntry({
        resume,
        optimization,
        style,
        palette,
        targetPages,
        pageSize,
        personalizedStyleProfile,
        fitVariant: fitVariant ?? null,
        sourceRevision,
        includeSummary,
      }),
    [
      resume,
      optimization,
      style,
      palette,
      targetPages,
      pageSize,
      personalizedStyleProfile,
      fitVariant,
      sourceRevision,
      includeSummary,
    ],
  );

  useEffect(() => {
    if (style === "personalized" && !personalizedStyleProfile) {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
      setUrl(null);
      setError(null);
      setLoading(false);
      setApproximateLayout(false);
      return;
    }
    if (Date.now() < retryUntilRef.current) return;

    let active = true;
    let timer: number | null = null;
    const controller = new AbortController();
    const bypassCache = retryNonce !== lastCacheBypassNonceRef.current;
    if (bypassCache) lastCacheBypassNonceRef.current = retryNonce;

    const applyPreviewBlob = (blob: Blob, approximate: boolean) => {
      if (!active) return;
      const nextUrl = URL.createObjectURL(blob);
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
      }
      currentUrlRef.current = nextUrl;
      setUrl(nextUrl);
      setError(null);
      setApproximateLayout(approximate);
      setRetrySeconds(0);
      retryUntilRef.current = 0;
    };

    const fetchPreview = () => {
      setLoading(true);
      setError(null);
      void fetch("/api/export/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Resume-Preview": "1",
          ...orderAuthHeaders(),
        },

        signal: controller.signal,
        body: JSON.stringify({
          resume,
          optimization,
          style,
          palette,
          targetPages,
          pageSize,
          fitVariant: fitVariant ?? undefined,
          sourceRevision: sourceRevision ?? undefined,
          personalizedStyleProfile:
            style === "personalized" ? personalizedStyleProfile : undefined,
          includeSummary,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const retryAfter = Number(
              response.headers.get("Retry-After") ||
                data.retryAfterSec ||
                0,
            );
            if (response.status === 429 && retryAfter > 0) {
              retryUntilRef.current = Date.now() + retryAfter * 1_000;
              setRetrySeconds(retryAfter);
            }
            throw new Error(data.error || "Preview failed.");
          }
          const approximate =
            response.headers.get("X-Resume-Layout") === "approximate";
          return response.blob().then((blob) => ({ blob, approximate }));
        })
        .then(({ blob, approximate }) => {
          if (!active) return;
          applyPreviewBlob(blob, approximate);
          void savePdfPreviewCache(cacheEntry, blob, approximate);
        })
        .catch((previewError) => {
          if (
            active &&
            !(previewError instanceof DOMException &&
              previewError.name === "AbortError")
          ) {
            setError(
              previewError instanceof Error
                ? previewError.message
                : "Preview failed.",
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    const queueFetch = (delayMs: number) => {
      timer = window.setTimeout(fetchPreview, delayMs);
    };

    if (bypassCache) {
      queueFetch(0);
    } else {
      void loadPdfPreviewCache(cacheEntry).then((cached) => {
        if (!active) return;
        if (cached) {
          applyPreviewBlob(cached.blob, cached.approximateLayout);
          setLoading(false);
          return;
        }
        queueFetch(900);
      });
    }

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    cacheEntry,
    optimization,
    pageSize,
    palette,
    personalizedStyleProfile,
    personalizedStatus,
    resume,
    fitVariant,
    includeSummary,
    retryNonce,
    sourceRevision,
    style,
    targetPages,
  ]);

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setRetrySeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  useEffect(
    () => () => {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
    },
    [],
  );

  if (style === "personalized" && !personalizedStyleProfile) {
    const failed = personalizedStatus === "failed";
    return (
      <div
        role={failed ? "alert" : "status"}
        className="grid h-full w-full place-items-center p-6 text-center"
      >
        <div className="max-w-sm">
          <span
            className={`mx-auto grid h-10 w-10 place-items-center rounded-full ${
              failed
                ? "bg-amber-50 text-amber-700"
                : "bg-accent-50 text-accent-700"
            }`}
          >
            <RefreshCw
              size={18}
              className={failed ? undefined : "animate-spin"}
            />
          </span>
          <div className="mt-3 text-sm font-medium text-ink-900">
            {failed
              ? "Original-inspired style is not ready"
              : "Preparing the Original-inspired layout…"}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {failed
              ? personalizedError ||
                "The layout could not be generated. Retry it or choose another PDF style."
              : "The PDF preview will appear automatically when the layout is ready."}
          </p>
          {failed && onRetryPersonalized ? (
            <button
              type="button"
              onClick={onRetryPersonalized}
              className="btn btn-outline mt-4 min-h-11 bg-white"
            >
              <RefreshCw size={14} /> Retry layout
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (error && !url) {
    return (
      <div
        role="alert"
        className="grid h-full w-full place-items-center p-6 text-center"
      >
        <div className="max-w-sm">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-rose-50 text-rose-700">
            <AlertTriangle size={18} />
          </span>
          <div className="mt-3 text-sm font-medium text-ink-900">
            Preview could not update
          </div>
          <p className="mt-1 text-sm text-rose-700">{error}</p>
          <button
            type="button"
            disabled={retrySeconds > 0 || loading}
            onClick={() => {
              retryUntilRef.current = 0;
              setRetrySeconds(0);
              setLoading(true);
              setRetryNonce((value) => value + 1);
            }}
            className="btn btn-outline mt-4 min-h-11 bg-white"
          >
            <RefreshCw
              size={14}
              className={loading ? "animate-spin" : undefined}
            />
            {retrySeconds > 0
              ? `Retry in ${retrySeconds}s`
              : loading
                ? "Retrying…"
                : "Retry preview"}
          </button>
        </div>
      </div>
    );
  }

  if (!url) {
    return (
      <div
        role="status"
        className="h-full w-full grid place-items-center text-sm text-ink-500"
      >
        Generating preview…
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <iframe
        src={`${url}#toolbar=1&view=FitH`}
        title="Edited resume PDF preview"
        className="h-full w-full rounded-lg"
      />
      {loading ? (
        <div
          role="status"
          className="absolute right-3 top-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-ink-100 bg-white/95 px-3 text-xs font-medium text-ink-600 shadow-soft"
        >
          <RefreshCw size={13} className="animate-spin" />
          Updating preview…
        </div>
      ) : null}
      {approximateLayout && !loading ? (
        <div
          role="status"
          className="absolute left-3 top-3 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs font-medium text-amber-900 shadow-soft"
        >
          Approximate original-inspired layout — detected page geometry used
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-white/95 px-3 py-2 text-xs text-rose-800 shadow-soft"
        >
          <span>The latest preview could not replace this saved version: {error}</span>
          <button
            type="button"
            disabled={retrySeconds > 0 || loading}
            onClick={() => {
              retryUntilRef.current = 0;
              setRetrySeconds(0);
              setLoading(true);
              setRetryNonce((value) => value + 1);
            }}
            className="btn btn-outline min-h-11 bg-white"
          >
            <RefreshCw size={14} />
            {retrySeconds > 0 ? `Retry in ${retrySeconds}s` : "Retry"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
