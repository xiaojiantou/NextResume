"use client";

import { AppShell } from "@/components/AppShell";
import { useFlow } from "@/lib/store";
import {
  AlertCircle,
  ArrowRight,
  FileText,
  Upload,
  X,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

export default function UploadPage() {
  const {
    fileName,
    fileType,
    fileSize,
    resume,
    setFileMeta,
    setResume,
    clearFile,
  } = useFlow();
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  const handle = useCallback(
    async (f: File) => {
      setError(null);
      const ext = f.name.split(".").pop()?.toLowerCase();
      const t = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : null;
      if (!t) {
        setError("Please upload a PDF or DOCX file.");
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        setError("File too large. Max 10MB.");
        return;
      }

      setParsing(true);
      setFileMeta(f.name, t, f.size);

      try {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/parse-resume", {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Parse failed");
        setResume(data.resume);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not parse resume.");
        clearFile();
      } finally {
        setParsing(false);
      }
    },
    [setFileMeta, setResume, clearFile],
  );

  const bulletCount =
    resume?.experience.reduce((n, r) => n + r.bullets.length, 0) ?? 0;

  return (
    <AppShell step="upload">
      <div className="container-x py-10 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Upload your resume
        </h1>
        <p className="text-ink-500 mt-2">
          PDF or DOCX, up to 10MB. We'll extract structure and never share your
          data.
        </p>

        {!fileName ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handle(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={`mt-8 card p-10 text-center cursor-pointer transition-all ${
              dragging
                ? "border-ink-900 bg-ink-50/60 shadow-pop"
                : "hover:border-ink-300"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handle(f);
              }}
            />
            <div className="w-12 h-12 rounded-xl bg-ink-900 text-white mx-auto inline-flex items-center justify-center">
              <Upload size={20} />
            </div>
            <div className="mt-4 font-medium text-ink-900">
              Drop your resume here, or click to browse
            </div>
            <div className="text-sm text-ink-400 mt-1">
              PDF or DOCX · Max 10MB
            </div>
          </div>
        ) : (
          <div className="mt-8 card p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-ink-100 text-ink-700 inline-flex items-center justify-center shrink-0">
              {parsing ? (
                <div className="w-4 h-4 border-2 border-ink-300 border-t-ink-900 rounded-full animate-spin" />
              ) : (
                <FileText size={20} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-ink-900 truncate">
                {fileName}
              </div>
              <div className="text-xs text-ink-400 mt-0.5">
                {fileType?.toUpperCase()} ·{" "}
                {((fileSize ?? 0) / 1024).toFixed(1)} KB ·{" "}
                {parsing
                  ? "Parsing with AI…"
                  : resume
                    ? `Parsed: ${resume.experience.length} roles, ${bulletCount} bullets`
                    : ""}
              </div>
              {parsing && (
                <div className="mt-2.5 max-w-xs">
                  <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
                    <div className="h-full w-1/3 bg-ink-900 shimmer" />
                  </div>
                </div>
              )}
            </div>
            {resume && !parsing && (
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            )}
            <button
              onClick={clearFile}
              disabled={parsing}
              className="btn btn-ghost !p-2 text-ink-400"
              aria-label="Remove file"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-6 flex items-start gap-2 text-xs text-ink-400">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          <p>
            Your resume is processed in-memory and removed within 24 hours. We
            never use your data to train models.
          </p>
        </div>

        <div className="hairline my-10" />

        <div className="flex items-center justify-between">
          <Link href="/" className="btn btn-ghost">
            Cancel
          </Link>
          <button
            disabled={!resume || parsing}
            onClick={() => router.push("/job")}
            className="btn btn-primary"
          >
            Continue
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </AppShell>
  );
}
