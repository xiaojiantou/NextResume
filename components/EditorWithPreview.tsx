// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { EditableResumeCanvas } from "./EditableResumeCanvas";
import { LivePdfPreview } from "./LivePdfPreview";
import type {
  Resume,
  Optimization,
  ResumePageSpec,
  ResumeStyleProfile,
} from "@/lib/types";
import type { PdfStyle, TargetPages } from "@/lib/pdf/config";
import type { ResumeFitVariant } from "@/lib/resumeFit";
import { Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";

export function EditorWithPreview({
  resume,
  optimization,
  pdfStyle,
  pdfPalette,
  targetPages,
  pageSize,
  personalizedStyleProfile,
  previewTargetPages,
  previewFitVariant,
  sourceRevision,
  personalizedStatus,
  personalizedError,
  onRetryPersonalized,
  onResumeChange,
  onRegenerate,
  regenerating,
  keptContentIds,
  lockedContentIds,
  onToggleKeep,
  includeSummary,
}: {
  resume: Resume;
  optimization: Optimization | null;
  pdfStyle: PdfStyle;
  pdfPalette: string;
  targetPages: TargetPages;
  pageSize: ResumePageSpec;
  personalizedStyleProfile: ResumeStyleProfile | null;
  previewTargetPages?: TargetPages;
  previewFitVariant?: ResumeFitVariant | null;
  sourceRevision?: string | null;
  personalizedStatus?: "idle" | "generating" | "ready" | "failed";
  personalizedError?: string | null;
  onRetryPersonalized?: () => void;
  onResumeChange: (resume: Resume) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  keptContentIds?: string[];
  lockedContentIds?: string[];
  onToggleKeep?: (contentId: string) => void;
  includeSummary?: boolean;
}) {
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
            Split
          </button>
          <button
            onClick={() => setLayout("editor")}
            className={`px-3 py-1.5 rounded text-sm font-medium transition ${
              layout === "editor"
                ? "bg-white text-ink-900 shadow-soft"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            Editor Only
          </button>
          <button
            onClick={() => setLayout("preview")}
            className={`px-3 py-1.5 rounded text-sm font-medium transition ${
              layout === "preview"
                ? "bg-white text-ink-900 shadow-soft"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            Preview Only
          </button>
        </div>
      </div>

      {/* Content */}
      {layout === "split" ? (
        <div className="grid h-[calc(100dvh-8rem)] min-h-[720px] grid-cols-2 gap-6">
          {/* Editor Side */}
          <div className="overflow-y-auto pr-4 pb-4">
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

          {/* Preview Side */}
          <div className="overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
            <LivePdfPreview
              resume={resume}
              optimization={optimization}
              style={pdfStyle}
              palette={pdfPalette}
              targetPages={previewTargetPages ?? targetPages}
              pageSize={pageSize}
              personalizedStyleProfile={personalizedStyleProfile}
              fitVariant={previewFitVariant}
              sourceRevision={sourceRevision}
              personalizedStatus={personalizedStatus}
              personalizedError={personalizedError}
              onRetryPersonalized={onRetryPersonalized}
              includeSummary={includeSummary}
            />
          </div>
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
        <div className="h-[calc(100dvh-8rem)] min-h-[760px] overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
          <LivePdfPreview
            resume={resume}
            optimization={optimization}
            style={pdfStyle}
            palette={pdfPalette}
            targetPages={previewTargetPages ?? targetPages}
            pageSize={pageSize}
            personalizedStyleProfile={personalizedStyleProfile}
            fitVariant={previewFitVariant}
            sourceRevision={sourceRevision}
            personalizedStatus={personalizedStatus}
            personalizedError={personalizedError}
            onRetryPersonalized={onRetryPersonalized}
            includeSummary={includeSummary}
          />
        </div>
      )}
    </div>
  );
}
