"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Mic, Square, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { JobAnalysis, OptimizedBullet } from "@/lib/types";

type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResult = {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
};
type SpeechRecognitionEvent = {
  results: ArrayLike<SpeechRecognitionResult>;
  resultIndex: number;
};
type SpeechRecognitionErrorEvent = { error: string };
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceRefine({
  roleId,
  bullet,
  job,
  model,
  quotaRemaining,
  onAccept,
  onQuotaConsume,
}: {
  roleId: string;
  bullet: OptimizedBullet;
  job: JobAnalysis | null;
  model: string;
  quotaRemaining: number;
  onAccept: (roleId: string, bulletId: string, next: OptimizedBullet) => void;
  onQuotaConsume: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [processing, setProcessing] = useState(false);
  const [suggested, setSuggested] = useState<OptimizedBullet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const supported = getSpeechRecognition() !== null;
  const quotaExhausted = quotaRemaining <= 0;

  const stopRecording = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setRecording(false);
  };

  useEffect(() => () => stopRecording(), []);

  const startRecording = () => {
    setError(null);
    setTranscript("");
    setSuggested(null);
    const SR = getSpeechRecognition();
    if (!SR) {
      setError("Voice input isn't supported in this browser. Try Chrome or Safari.");
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let full = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) full += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setTranscript((full + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") return;
      setError(
        e.error === "not-allowed"
          ? "Microphone access denied. Enable it in your browser settings."
          : `Mic error: ${e.error}`,
      );
      setRecording(false);
    };
    rec.onend = () => setRecording(false);
    try {
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start recording.");
    }
  };

  const submit = async () => {
    if (!transcript.trim()) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await fetch("/api/voice-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          originalBullet: bullet.text,
          originalBulletId: bullet.id,
          job,
          model,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Voice rewrite failed");
      setSuggested(data.bullet);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice rewrite failed.");
    } finally {
      setProcessing(false);
    }
  };

  const accept = () => {
    if (!suggested) return;
    onAccept(roleId, bullet.id, suggested);
    onQuotaConsume();
    reset();
  };

  const reset = () => {
    stopRecording();
    setTranscript("");
    setSuggested(null);
    setError(null);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={!supported || quotaExhausted}
        className={cn(
          "inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border transition",
          quotaExhausted
            ? "border-ink-100 bg-ink-50 text-ink-400 cursor-not-allowed"
            : "border-accent-200 bg-white text-accent-700 hover:bg-accent-50",
        )}
        title={
          !supported
            ? "Voice input isn't supported in this browser"
            : quotaExhausted
              ? "Voice refinements used up for this resume"
              : "Refine this bullet by speaking"
        }
      >
        <Mic size={11} />
        Refine by voice
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-accent-200 bg-white p-3 shadow-soft">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-accent-700 inline-flex items-center gap-1.5">
          <Mic size={12} />
          Refine by voice · {quotaRemaining} left
        </div>
        <button
          onClick={reset}
          className="text-ink-400 hover:text-ink-700"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {!recording ? (
          <button
            onClick={startRecording}
            disabled={processing || !!suggested}
            className="btn btn-primary !py-1.5 !px-3 text-xs"
          >
            <Mic size={12} />
            {transcript ? "Re-record" : "Start recording"}
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="btn btn-primary !py-1.5 !px-3 text-xs !bg-rose-600"
          >
            <Square size={10} fill="currentColor" />
            Stop
          </button>
        )}
        {recording && (
          <span className="inline-flex items-center gap-1.5 text-xs text-rose-600">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            Listening…
          </span>
        )}
      </div>

      {transcript && (
        <div className="mt-2.5 rounded-md bg-ink-50 border border-ink-100 p-2.5 text-xs text-ink-700 italic leading-relaxed">
          “{transcript}”
        </div>
      )}

      {transcript && !suggested && !recording && (
        <div className="mt-2.5">
          <button
            onClick={submit}
            disabled={processing}
            className="btn btn-primary !py-1.5 !px-3 text-xs"
          >
            {processing ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Rewriting…
              </>
            ) : (
              "Rewrite with this"
            )}
          </button>
        </div>
      )}

      {suggested && (
        <div className="mt-3 rounded-md border border-accent-200 bg-accent-50/40 p-3 text-sm text-ink-900">
          {suggested.text}
          {suggested.matchedKeywords?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggested.matchedKeywords.map((k) => (
                <span
                  key={k}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-accent-100 text-accent-700 font-medium"
                >
                  +{k}
                </span>
              ))}
            </div>
          ) : null}
          {suggested.rationale && (
            <div className="mt-2 text-xs text-ink-500 italic">
              {suggested.rationale}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={accept}
              className="btn btn-primary !py-1.5 !px-3 text-xs"
            >
              <Check size={12} strokeWidth={3} />
              Use this bullet
            </button>
            <button onClick={reset} className="btn btn-ghost !py-1.5 !px-3 text-xs">
              Discard
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-2.5 text-xs text-rose-700 inline-flex items-start gap-1.5">
          <AlertCircle size={11} className="mt-0.5" />
          {error}
        </div>
      )}
    </div>
  );
}
