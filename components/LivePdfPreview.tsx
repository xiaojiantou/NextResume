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
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const currentUrlRef = useRef<string | null>(null);
  const retryUntilRef = useRef(0);

  useEffect(() => {
    if (Date.now() < retryUntilRef.current) return;

    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetch("/api/export/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Resume-Preview": "1",
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
          return response.blob();
        })
        .then((blob) => {
          if (!active) return;
          const nextUrl = URL.createObjectURL(blob);
          if (currentUrlRef.current) {
            URL.revokeObjectURL(currentUrlRef.current);
          }
          currentUrlRef.current = nextUrl;
          setUrl(nextUrl);
          setRetrySeconds(0);
          retryUntilRef.current = 0;
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
    }, 900);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    optimization,
    pageSize,
    palette,
    personalizedStyleProfile,
    resume,
    fitVariant,
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

  if (error) {
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
    </div>
  );
}
