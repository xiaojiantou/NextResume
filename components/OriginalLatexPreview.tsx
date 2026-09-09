// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

// The "original" pane for a .tex upload.
//
// The honest original is the user's own template compiled as uploaded, so
// that is what this shows: the unchanged .tex built by the compile service,
// page-shaped to line up with the optimized PDF beside it. Re-typesetting the
// parsed content in one of our styles would read as a before/after of a
// restyle that never happens on this path. When the service is not available
// (or the template does not build), the source listing with its changed-line
// highlights is the fallback, and it stays one click away otherwise.
import { orderAuthHeaders } from "@/lib/store";
import type { Optimization, Resume } from "@/lib/types";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { LatexSourcePreview } from "./LatexSourcePreview";

type Compiled = { blob: Blob } | { error: string };

// One compile per source per page load: the pane unmounts every time the
// user switches views, and the original never changes underneath it.
const compiled = new Map<string, Promise<Compiled>>();

function compileOriginal(sourceTex: string): Promise<Compiled> {
  let pending = compiled.get(sourceTex);
  if (!pending) {
    pending = fetch("/api/export/tex/original", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orderAuthHeaders() },
      body: JSON.stringify({ sourceTex }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return {
            error:
              (typeof data.error === "string" && data.error) ||
              `Could not compile the original (${res.status}).`,
          };
        }
        return { blob: await res.blob() };
      })
      .catch(() => ({ error: "Could not reach the server." }));
    compiled.set(sourceTex, pending);
    // A network failure should not be remembered for the rest of the session.
    void pending.then((result) => {
      if ("error" in result) compiled.delete(sourceTex);
    });
  }
  return pending;
}

export function OriginalLatexPreview({
  sourceTex,
  source,
  resume,
  optimization,
  includeSummary,
  pageSize,
}: {
  /** The uploaded .tex, base64 as stored in the flow. */
  sourceTex: string;
  /** The same file decoded, for the source listing. */
  source: string;
  resume: Resume;
  optimization: Optimization | null;
  includeSummary: boolean;
  pageSize: { widthPt: number; heightPt: number };
}) {
  const [status, setStatus] = useState<"compiling" | "ready" | "failed">(
    "compiling",
  );
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setStatus("compiling");
    void compileOriginal(sourceTex).then((result) => {
      if (!active) return;
      if ("error" in result) {
        setError(result.error);
        setStatus("failed");
        return;
      }
      objectUrl = URL.createObjectURL(result.blob);
      setUrl(objectUrl);
      setError(null);
      setStatus("ready");
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [sourceTex]);

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
          className="overflow-hidden rounded-lg border border-ink-100 bg-ink-50 shadow-soft"
          style={{ aspectRatio: `${pageSize.widthPt} / ${pageSize.heightPt}` }}
        >
          {status === "ready" && url ? (
            <iframe
              src={`${url}#toolbar=1&view=Fit`}
              title="Original LaTeX compiled to PDF"
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
