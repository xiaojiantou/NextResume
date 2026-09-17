// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The "optimized" pane for a .tex upload, compiled the same way the "PDF
// from your LaTeX" download is: the rewritten wording spliced into the
// user's own template and built with their declared/required engine. The
// live preview used to fall back to one of our own fixed styles for every
// upload, LaTeX included, so what a .tex user previewed while editing never
// matched what they actually downloaded — different font, different
// spacing, sometimes a different page count entirely, discovered only after
// paying and opening the file.
//
// Compiling is real CPU on a metered service, so unlike the deterministic
// template preview this one debounces: it waits for edits to settle before
// asking the compiler for a new page, and keeps showing the last good page
// while a new one is pending rather than blanking the pane on every change.
import { orderAuthHeaders } from "@/lib/store";
import type { Optimization, Resume } from "@/lib/types";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LatexSourcePreview } from "./LatexSourcePreview";

const DEBOUNCE_MS = 1500;

type CompileResult = { blob: Blob } | { error: string };

async function compile(body: Record<string, unknown>): Promise<CompileResult> {
  try {
    const res = await fetch("/api/export/tex/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Resume-Preview": "1",
        ...orderAuthHeaders(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        return { error: "Too many compiles right now — showing the last preview." };
      }
      return {
        error:
          (typeof data.error === "string" && data.error) ||
          `Could not compile the rewrite (${res.status}).`,
      };
    }
    return { blob: await res.blob() };
  } catch {
    return { error: "Could not reach the server." };
  }
}

export function CompiledOptimizedTexPreview({
  sourceTex,
  source,
  resume,
  optimization,
  includeSummary,
  targetTitle,
  pageSize,
}: {
  /** The uploaded .tex, base64 as stored in the flow. */
  sourceTex: string;
  /** The same file decoded, for the source listing. */
  source: string;
  resume: Resume;
  optimization: Optimization;
  includeSummary: boolean;
  targetTitle?: string;
  pageSize: { widthPt: number; heightPt: number };
}) {
  const [status, setStatus] = useState<"compiling" | "ready" | "failed">(
    "compiling",
  );
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    setUpdating(true);

    const run = () => {
      void compile({
        resume,
        optimization,
        sourceTex,
        targetTitle: targetTitle || "",
        includeSummary,
      }).then((result) => {
        if (!active) return;
        setUpdating(false);
        if ("error" in result) {
          // A stale preview beats no preview: once something has compiled
          // successfully, a later failure is surfaced as a small notice
          // over the last good page rather than replacing it. Only the very
          // first compile (nothing to show yet) is a hard failure.
          setError(result.error);
          if (!urlRef.current) setStatus("failed");
          return;
        }
        const nextUrl = URL.createObjectURL(result.blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = nextUrl;
        setUrl(nextUrl);
        setError(null);
        setStatus("ready");
      });
    };

    timer = window.setTimeout(run, urlRef.current ? DEBOUNCE_MS : 0);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, optimization, sourceTex, includeSummary]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const listing = (
    <LatexSourcePreview
      source={source}
      resume={resume}
      optimization={optimization}
      includeSummary={includeSummary}
      pageSize={pageSize}
    />
  );

  if (status === "failed") {
    return (
      <>
        <p role="status" className="mb-2 text-xs leading-5 text-ink-500">
          Showing your source instead of a compiled page: {error}
        </p>
        {listing}
      </>
    );
  }

  return (
    <>
      {showSource ? (
        listing
      ) : (
        <div
          className="relative overflow-hidden rounded-lg border border-ink-100 bg-ink-50 shadow-soft"
          style={{ aspectRatio: `${pageSize.widthPt} / ${pageSize.heightPt}` }}
        >
          {status === "ready" && url ? (
            <iframe
              src={`${url}#toolbar=1&view=Fit`}
              title="Optimized resume compiled from your LaTeX"
              className="h-full w-full rounded-lg"
            />
          ) : (
            <div
              role="status"
              className="grid h-full w-full place-items-center p-6 text-center text-sm text-ink-500"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                Compiling your LaTeX…
              </span>
            </div>
          )}
          {updating && status === "ready" ? (
            <div
              role="status"
              aria-label="Updating preview"
              className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-ink-100 bg-white/90 px-2 py-1 text-[11px] text-ink-500 shadow-soft"
            >
              <RefreshCw size={11} className="animate-spin" />
              Updating…
            </div>
          ) : null}
          {error && status === "ready" ? (
            <div
              role="status"
              className="absolute inset-x-0 bottom-0 bg-amber-50/95 px-3 py-1.5 text-[11px] text-amber-800"
            >
              {error}
            </div>
          ) : null}
        </div>
      )}
      <button
        type="button"
        onClick={() => setShowSource((value) => !value)}
        className="mt-2 text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
      >
        {showSource
          ? "Show the compiled page"
          : "Show LaTeX source and the lines that change"}
      </button>
    </>
  );
}
