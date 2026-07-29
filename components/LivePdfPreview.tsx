// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import type { Resume, Optimization } from "@/lib/types";
import { useEffect, useState } from "react";

export function LivePdfPreview({
  resume,
  optimization,
}: {
  resume: Resume;
  optimization: Optimization | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);

    void fetch("/api/export/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resume,
        optimization,
        style: "classic",
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Preview failed.");
        }
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch((previewError) => {
        if (active) {
          setError(
            previewError instanceof Error
              ? previewError.message
              : "Preview failed.",
          );
        }
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [optimization, resume]);

  if (error) {
    return (
      <div
        role="alert"
        className="h-full w-full grid place-items-center p-6 text-sm text-rose-700"
      >
        {error}
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
    <iframe
      src={`${url}#toolbar=1&view=FitH`}
      title="Edited resume PDF preview"
      className="h-full w-full rounded-lg"
    />
  );
}
