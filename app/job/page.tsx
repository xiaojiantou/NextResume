"use client";

import { AppShell } from "@/components/AppShell";
import { useFlow } from "@/lib/store";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Globe,
  ImageUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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

export default function JobPage() {
  const {
    jobDescription,
    setJobDescription,
    jobUrl,
    setJobUrl,
    setJob,
    job,
  } = useFlow();
  const [mode, setMode] = useState<"paste" | "url" | "image">("paste");
  const [importing, setImporting] = useState(false);
  const [importingImage, setImportingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const importFromUrl = async () => {
    setImporting(true);
    setError(null);
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
      setError(e instanceof Error ? e.message : "Could not import job URL.");
    } finally {
      setImporting(false);
    }
  };

  const importFromImage = async (file: File) => {
    setImportingImage(true);
    setError(null);
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
      setError(e instanceof Error ? e.message : "Could not read job image.");
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
    setError(null);
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
      setError(e instanceof Error ? e.message : "Could not analyze JD.");
    } finally {
      setSubmitting(false);
    }
  };

  const ready = jobDescription.trim().length > 80;

  return (
    <AppShell step="job">
      <div className="container-x py-10 max-w-3xl">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Tell us about the job
        </h1>
        <p className="text-ink-500 mt-2">
          Paste the full job description, or try importing a public job URL.
        </p>

        <div className="mt-6 inline-flex bg-ink-100 p-1 rounded-lg">
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

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="hairline my-10" />
        <div className="flex items-center justify-between">
          <Link href="/upload" className="btn btn-ghost">
            <ArrowLeft size={14} /> Back
          </Link>
          <button
            disabled={!ready || submitting}
            onClick={onContinue}
            className="btn btn-primary"
          >
            {submitting ? "Analyzing JD…" : "Run free analysis"}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </AppShell>
  );
}
