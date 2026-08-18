// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { AppShell } from "@/components/AppShell";
import { useFlow } from "@/lib/store";
import type { Resume, ResumeStyleSource } from "@/lib/types";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  FileText,
  Globe,
  ImageUp,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

const SAMPLE_JD = `Senior Product Engineer — Vercel

We're hiring a Senior Product Engineer to join the Frontend Platform team. You'll lead the design and implementation of features used by millions of developers every day. The ideal candidate has:

• 5+ years building production React/Next.js applications
• Deep experience with TypeScript and modern frontend architecture
• Proven track record shipping customer-facing features at scale
• Strong product instincts and an eye for design detail
• Experience collaborating with designers in Figma and shipping iteratively
• Familiarity with serverless infrastructure (AWS, Vercel) and edge runtimes
• Bonus: experience mentoring engineers and improving team velocity

You will:
• Own end-to-end delivery of frontend platform features
• Drive performance, accessibility, and DX initiatives
• Collaborate cross-functionally with product, design, and infra teams
• Define and uphold engineering standards across the org`;

async function fingerprintFile(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return `${file.size}:${file.lastModified}:${file.name}`;
  }
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

type ParseResponse = {
  resume: Resume;
  styleSource?: ResumeStyleSource | null;
  error?: string;
};

// /api/parse-resume is a single request with no server-sent progress, so the
// bar is genuinely measured for the upload half (XHR reports bytes sent) and an
// easing estimate for the AI parse half: it creeps toward 92% and only snaps to
// 100 when the response actually lands. Better than a spinner because the two
// phases have very different durations and users need to see the file leave.
function uploadResume(
  file: File,
  onProgress: (pct: number, phase: string) => void,
): Promise<ParseResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append("file", file);

    let creep: ReturnType<typeof setInterval> | null = null;
    let pct = 0;
    const stopCreep = () => {
      if (creep) clearInterval(creep);
      creep = null;
    };

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      pct = (e.loaded / e.total) * 35;
      onProgress(Math.round(pct), "Uploading");
    };

    xhr.upload.onload = () => {
      pct = Math.max(pct, 35);
      onProgress(Math.round(pct), "Extracting text");
      creep = setInterval(() => {
        pct += (92 - pct) * 0.05;
        onProgress(
          Math.round(pct),
          pct > 62 ? "Structuring with AI" : "Extracting text",
        );
      }, 220);
    };

    xhr.onload = () => {
      stopCreep();
      let data: ParseResponse | Record<string, never> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // fall through to the status check below
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(("error" in data && data.error) || "Parse failed"));
        return;
      }
      onProgress(100, "Done");
      resolve(data as ParseResponse);
    };

    xhr.onerror = () => {
      stopCreep();
      reject(new Error("Network error while uploading."));
    };

    xhr.open("POST", "/api/parse-resume");
    xhr.send(fd);
  });
}

// Numbered heading so the two inputs read as an ordered pair on one page
// instead of one long undifferentiated form.
function SectionHeading({
  n,
  title,
  hint,
  done,
}: {
  n: number;
  title: string;
  hint: string;
  done?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`w-6 h-6 mt-0.5 shrink-0 rounded-full inline-flex items-center justify-center text-xs font-medium ${
          done ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-500"
        }`}
      >
        {done ? <CheckCircle2 size={13} strokeWidth={2.5} /> : n}
      </span>
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-900">
          {title}
        </h2>
        <p className="text-sm text-ink-500 mt-0.5">{hint}</p>
      </div>
    </div>
  );
}

export default function UploadPage() {
  const {
    fileName,
    fileType,
    fileSize,
    resume,
    setFileMeta,
    setResume,
    setResumeStyleSource,
    clearFile,
    jobDescription,
    setJobDescription,
    jobUrl,
    setJobUrl,
    setJob,
    job,
  } = useFlow();

  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("Uploading");
  const [resumeError, setResumeError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<"paste" | "url" | "image">("paste");
  const [importing, setImporting] = useState(false);
  const [importingImage, setImportingImage] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const handle = useCallback(
    async (f: File) => {
      setResumeError(null);
      const ext = f.name.split(".").pop()?.toLowerCase();
      const t = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : null;
      if (!t) {
        setResumeError("Please upload a PDF or DOCX file.");
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        setResumeError("File too large. Max 10MB.");
        return;
      }

      setParsing(true);
      setProgress(0);
      setPhase("Reading file");
      // A newly selected file is a new source document, not a manual edit of
      // the previous resume. Clear resume-scoped ids, locks, variants and Fit
      // state before b1/r1 ids are reused by the new parse.
      clearFile();

      try {
        const fingerprint = await fingerprintFile(f);
        setFileMeta(f.name, t, f.size, fingerprint);
        const data = await uploadResume(f, (pct, ph) => {
          setProgress(pct);
          setPhase(ph);
        });
        setResume(data.resume);
        setResumeStyleSource(data.styleSource ?? null);
      } catch (e) {
        setResumeError(
          e instanceof Error ? e.message : "Could not parse resume.",
        );
        clearFile();
      } finally {
        setParsing(false);
      }
    },
    [setFileMeta, setResume, setResumeStyleSource, clearFile],
  );

  const importFromUrl = async () => {
    setImporting(true);
    setJobError(null);
    try {
      const res = await fetch("/api/import-job-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jobUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setJobDescription(data.text);
      setMode("paste");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "Could not import job URL.");
    } finally {
      setImporting(false);
    }
  };

  const importFromImage = async (file: File) => {
    setImportingImage(true);
    setJobError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import-job-image", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setJobDescription(data.text);
      setMode("paste");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "Could not read job image.");
    } finally {
      setImportingImage(false);
    }
  };

  // Pulls an image out of a clipboard paste event and hands it to
  // importFromImage, giving it a real filename since pasted blobs usually
  // don't have one (the backend's file-type check needs the extension).
  const handlePasteImage = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type !== "image/png" && item.type !== "image/jpeg") continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      e.preventDefault();
      const ext = item.type === "image/png" ? "png" : "jpg";
      const file = new File([blob], `pasted-image.${ext}`, {
        type: item.type,
      });
      importFromImage(file);
      break;
    }
  };

  const onContinue = async () => {
    setSubmitting(true);
    setJobError(null);
    try {
      const res = await fetch("/api/parse-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: jobDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Parse failed");
      setJob(data.analysis);
      router.push("/analysis");
    } catch (e) {
      setJobError(e instanceof Error ? e.message : "Could not analyze JD.");
    } finally {
      setSubmitting(false);
    }
  };

  const bulletCount =
    (resume?.experience.reduce((n, r) => n + r.bullets.length, 0) ?? 0) +
    (resume?.projects?.reduce((n, p) => n + p.bullets.length, 0) ?? 0);

  const jdReady = jobDescription.trim().length > 80;
  const canContinue = !!resume && !parsing && jdReady && !submitting;

  // The resume parses in the background while the JD is being pasted, so the
  // only reason to block here is one of the two halves not being done yet.
  const blockedHint = parsing
    ? "Still parsing your resume…"
    : !resume
      ? "Add your resume to continue"
      : !jdReady
        ? "Paste the job description to continue"
        : null;

  return (
    <AppShell step="upload">
      <div className="container-x py-10 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Your resume and the job
        </h1>
        <p className="text-ink-500 mt-2">
          Add both and we'll score the match for free — no account needed.
        </p>

        {/* ---------------------------- Resume ---------------------------- */}
        <div className="mt-9">
          <SectionHeading
            n={1}
            title="Upload your resume"
            hint="PDF or DOCX, up to 10MB. We'll extract the structure automatically."
            done={!!resume && !parsing}
          />

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
              className={`mt-4 card p-10 text-center cursor-pointer transition-all ${
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
            <div className="mt-4 card p-5 flex items-center gap-4">
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
                    ? `${phase} — keep going below`
                    : resume
                      ? `Parsed: ${resume.experience.length} roles, ${bulletCount} bullets`
                      : ""}
                </div>
                {parsing && (
                  <div className="mt-2.5 max-w-xs flex items-center gap-2">
                    <div
                      className="h-1.5 flex-1 bg-ink-100 rounded-full overflow-hidden"
                      role="progressbar"
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Resume upload progress"
                    >
                      <div
                        className="h-full bg-ink-900 rounded-full transition-[width] duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-ink-400 tabular-nums w-8 text-right">
                      {progress}%
                    </span>
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

          {resumeError && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {resumeError}
            </div>
          )}
        </div>

        <div className="hairline my-9" />

        {/* ------------------------ Job description ------------------------ */}
        <div>
          <SectionHeading
            n={2}
            title="Tell us about the job"
            hint="Paste the full job description, or import it from a URL or screenshot."
            done={jdReady}
          />

          <div className="mt-4 inline-flex bg-ink-100 p-1 rounded-lg">
            <button
              onClick={() => setMode("paste")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                mode === "paste"
                  ? "bg-white text-ink-900 shadow-soft"
                  : "text-ink-500"
              }`}
            >
              <Briefcase size={13} className="inline mr-1.5 -mt-0.5" />
              Paste description
            </button>
            <button
              onClick={() => setMode("url")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                mode === "url"
                  ? "bg-white text-ink-900 shadow-soft"
                  : "text-ink-500"
              }`}
            >
              <Globe size={13} className="inline mr-1.5 -mt-0.5" />
              Import from URL
            </button>
            <button
              onClick={() => setMode("image")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                mode === "image"
                  ? "bg-white text-ink-900 shadow-soft"
                  : "text-ink-500"
              }`}
            >
              <ImageUp size={13} className="inline mr-1.5 -mt-0.5" />
              Upload image
            </button>
          </div>

          {mode === "paste" ? (
            <div className="mt-4 card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-ink-100 flex items-center justify-between bg-ink-50/50">
                <span className="text-xs text-ink-500">
                  Job description ·{" "}
                  <span className="tabular-nums">
                    {jobDescription.length.toLocaleString()}
                  </span>{" "}
                  characters
                </span>
                <button
                  onClick={() => setJobDescription(SAMPLE_JD)}
                  className="text-xs text-accent-600 hover:text-accent-700"
                >
                  Use sample JD
                </button>
              </div>
              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the full job description here. Include responsibilities, requirements, and any 'nice to haves'."
                className="w-full h-72 p-4 text-sm text-ink-800 placeholder:text-ink-300 resize-none outline-none font-sans leading-relaxed"
              />
            </div>
          ) : mode === "url" ? (
            <div className="mt-4 card p-5">
              <label className="text-sm text-ink-700 font-medium">
                Job posting URL
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  value={jobUrl}
                  onChange={(e) => setJobUrl(e.target.value)}
                  placeholder="https://jobs.example.com/posting/123"
                  className="flex-1 px-3 py-2.5 border border-ink-200 rounded-lg text-sm outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/10"
                />
                <button
                  disabled={!jobUrl || importing}
                  onClick={importFromUrl}
                  className="btn btn-primary"
                >
                  {importing ? "Importing…" : "Import"}
                </button>
              </div>
              <p className="text-xs text-ink-400 mt-3">
                Some job boards block automated reading. If import fails, paste
                the description directly.
              </p>
            </div>
          ) : (
            <div
              tabIndex={0}
              onClick={() => imageInputRef.current?.click()}
              onPaste={handlePasteImage}
              className="mt-4 card p-10 text-center cursor-pointer transition-all hover:border-ink-300 outline-none focus:border-ink-900 focus:ring-2 focus:ring-ink-900/10"
            >
              <input
                ref={imageInputRef}
                type="file"
                hidden
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importFromImage(f);
                }}
              />
              <div className="w-12 h-12 rounded-xl bg-ink-900 text-white mx-auto inline-flex items-center justify-center">
                <ImageUp size={20} />
              </div>
              <div className="mt-4 font-medium text-ink-900">
                {importingImage
                  ? "Reading image…"
                  : "Click here, then paste (Ctrl/Cmd+V) — or click to browse"}
              </div>
              <div className="text-sm text-ink-400 mt-1">
                JPG or PNG · Max 10MB
              </div>
            </div>
          )}

          {job && (
            <div className="mt-5 card p-4 bg-ink-50/30">
              <div className="text-xs text-ink-500 mb-2">
                Detected signals · {job.title} ({job.seniority})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {job.requiredKeywords.slice(0, 12).map((k) => (
                  <span
                    key={k}
                    className="text-xs px-2 py-0.5 rounded-md bg-white border border-ink-100 text-ink-700"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {jobError && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {jobError}
            </div>
          )}
        </div>

        <div className="mt-8 flex items-start gap-2 text-xs text-ink-400">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          <p>
            Your resume is processed in-memory and removed within 24 hours. We
            never use your data to train models.
          </p>
        </div>

        <div className="hairline my-8" />

        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="btn btn-ghost">
            Cancel
          </Link>
          <div className="flex items-center gap-3">
            {blockedHint && (
              <span className="text-xs text-ink-400 hidden sm:inline">
                {blockedHint}
              </span>
            )}
            <button
              disabled={!canContinue}
              onClick={onContinue}
              className="btn btn-primary"
            >
              {submitting ? "Analyzing…" : "Run free analysis"}
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
