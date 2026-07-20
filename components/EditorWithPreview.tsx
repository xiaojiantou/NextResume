"use client";

import { EditableResumeCanvas } from "./EditableResumeCanvas";
import { LivePdfPreview } from "./LivePdfPreview";
import type { Resume, Optimization } from "@/lib/types";
import { Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";

export function EditorWithPreview({
  resume,
  optimization,
  onResumeChange,
  onRegenerate,
  regenerating,
}: {
  resume: Resume;
  optimization: Optimization | null;
  onResumeChange: (resume: Resume) => void;
  onRegenerate: () => void;
  regenerating: boolean;
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
        <div className="grid grid-cols-2 gap-6 h-[calc(100vh-300px)]">
          {/* Editor Side */}
          <div className="overflow-y-auto pr-4 pb-4">
            <EditableResumeCanvas
              resume={resume}
              onResumeChange={onResumeChange}
              onRegenerate={onRegenerate}
              regenerating={regenerating}
            />
          </div>

          {/* Preview Side */}
          <div className="overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
            <LivePdfPreview resume={resume} optimization={optimization} />
          </div>
        </div>
      ) : layout === "editor" ? (
        <div className="overflow-y-auto">
          <EditableResumeCanvas
            resume={resume}
            onResumeChange={onResumeChange}
            onRegenerate={onRegenerate}
            regenerating={regenerating}
          />
        </div>
      ) : (
        <div className="h-[calc(100vh-200px)] rounded-lg border border-ink-100 bg-ink-50 overflow-hidden">
          <LivePdfPreview resume={resume} optimization={optimization} />
        </div>
      )}
    </div>
  );
}
