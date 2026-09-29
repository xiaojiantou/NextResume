// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { useI18n } from "@/components/LanguageProvider";
import { EditableResumeCanvas } from "./EditableResumeCanvas";
import type { Resume, Optimization } from "@/lib/types";
import { useState, type ReactNode } from "react";

export function EditorWithPreview({
  resume,
  optimization,
  preview,
  onResumeChange,
  onRegenerate,
  regenerating,
  keptContentIds,
  lockedContentIds,
  onToggleKeep,
}: {
  resume: Resume;
  optimization: Optimization | null;
  preview: ReactNode;
  onResumeChange: (resume: Resume) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  keptContentIds?: string[];
  lockedContentIds?: string[];
  onToggleKeep?: (contentId: string) => void;
}) {
  const { t } = useI18n();
  const [layout, setLayout] = useState<"split" | "editor" | "preview">("split");

  return (
    <div className="space-y-4">
      {/* Layout Toggle */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-1 bg-ink-50 rounded-lg p-1">
          <button
            onClick={() => setLayout("split")}
            className={`px-3 py-1.5 rounded text-sm font-medium transition ${
              layout === "split"
                ? "bg-white text-ink-900 shadow-soft"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            {t("Split")}</button>
          <button
            onClick={() => setLayout("editor")}
            className={`px-3 py-1.5 rounded text-sm font-medium transition ${
              layout === "editor"
                ? "bg-white text-ink-900 shadow-soft"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            {t("Editor Only")}</button>
          <button
            onClick={() => setLayout("preview")}
            className={`px-3 py-1.5 rounded text-sm font-medium transition ${
              layout === "preview"
                ? "bg-white text-ink-900 shadow-soft"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            {t("Preview Only")}</button>
        </div>
      </div>

      {/* Content */}
      {layout === "split" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Editor Side: grows with the page instead of scrolling inside a
              viewport-height box; the preview stays pinned beside it. */}
          <div className="min-w-0 pr-4 pb-4">
            <EditableResumeCanvas
              resume={resume}
              optimizedPreview={Boolean(optimization)}
              onResumeChange={onResumeChange}
              onRegenerate={onRegenerate}
              regenerating={regenerating}
              keptContentIds={keptContentIds}
              lockedContentIds={lockedContentIds}
              onToggleKeep={onToggleKeep}
            />
          </div>

          {/* Share the deliverable preview with the Side-by-side view. */}
          <div className="min-w-0">{preview}</div>
        </div>
      ) : layout === "editor" ? (
        <div className="overflow-y-auto">
          <EditableResumeCanvas
            resume={resume}
            optimizedPreview={Boolean(optimization)}
            onResumeChange={onResumeChange}
            onRegenerate={onRegenerate}
            regenerating={regenerating}
            keptContentIds={keptContentIds}
            lockedContentIds={lockedContentIds}
            onToggleKeep={onToggleKeep}
          />
        </div>
      ) : (
        <div className="min-w-0">{preview}</div>
      )}
    </div>
  );
}
