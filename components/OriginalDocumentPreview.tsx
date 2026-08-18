// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import Image from "next/image";
import type { ResumeStyleSource } from "@/lib/types";

export function OriginalDocumentPreview({
  source,
}: {
  source: ResumeStyleSource;
}) {
  const screenshots = source.screenshots.filter(Boolean);

  return (
    <div
      className="space-y-3 rounded-lg border border-ink-100 bg-ink-50 p-2 shadow-soft"
      role="region"
      aria-label="Original uploaded resume pages"
    >
      {screenshots.map((screenshot, index) => (
        <figure
          key={`${index}:${screenshot.slice(-24)}`}
          className="overflow-hidden rounded-md border border-ink-200 bg-white"
        >
          <Image
            src={screenshot}
            alt={`Original uploaded resume page ${index + 1}`}
            width={850}
            height={1100}
            unoptimized
            className="block h-auto w-full"
            priority={index === 0}
          />
          {screenshots.length > 1 ? (
            <figcaption className="border-t border-ink-100 px-3 py-2 text-center text-[11px] text-ink-400">
              Source preview {index + 1} of {screenshots.length}
            </figcaption>
          ) : null}
        </figure>
      ))}
      {source.pageCount > screenshots.length ? (
        <p className="px-2 pb-1 text-center text-xs leading-5 text-ink-500">
          Showing the first {screenshots.length} of {source.pageCount} source
          pages.
        </p>
      ) : null}
    </div>
  );
}
