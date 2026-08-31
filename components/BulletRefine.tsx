// Copyright (c) 2026 HowBe LLC. All rights reserved.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Mic,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { orderAuthHeaders } from "@/lib/store";

import type { JobAnalysis, OptimizedBullet } from "@/lib/types";

// Kept in sync with MAX_TURNS in app/api/refine-bullet/route.ts, which is the
// authority — this only decides when to stop offering another round.
const MAX_TURNS = 6;

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

const DICTATION_LANGS = [
  { id: "en-US", label: "EN" },
  { id: "zh-CN", label: "中文" },
] as const;
type DictationLang = (typeof DICTATION_LANGS)[number]["id"];

// The browser's own locale is a better first guess than a hardcoded en-US,
// which silently produced garbage for anyone dictating Chinese.
function defaultDictationLang(): DictationLang {
  if (typeof navigator === "undefined") return "en-US";
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

type Turn = { instruction: string; bullet: OptimizedBullet };

/** True when this browser can dictate at all, so callers can label the trigger. */
export function dictationSupported(): boolean {
  return getSpeechRecognition() !== null;
}

// Open state lives with the caller: the trigger belongs in the row's action
// bar, but the panel has to expand across the full row beneath it, and one
// component cannot render into two places.
export function BulletRefine({
  roleId,
  bullet,
  sourceText,
  job,
  model,
  quotaRemaining,
  onAccept,
  onQuotaConsume,
  onClose,
}: {
  roleId: string;
  bullet: OptimizedBullet;
  /** The candidate's own wording, used to pin the output language. */
  sourceText: string;
  job: JobAnalysis | null;
  model: string;
  quotaRemaining: number;
  onAccept: (roleId: string, bulletId: string, next: OptimizedBullet) => void;
  onQuotaConsume: () => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [recording, setRecording] = useState(false);
  const [lang, setLang] = useState<DictationLang>("en-US");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [shown, setShown] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  // Dictation appends to whatever is already typed, so the base text has to
  // survive the interim results that arrive on every syllable.
  const baseRef = useRef("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  const supported = getSpeechRecognition() !== null;
  const turnsUsed = turns.length;
  const atTurnLimit = turnsUsed >= MAX_TURNS;
  const suggested = turns[shown]?.bullet ?? null;

  useEffect(() => setLang(defaultDictationLang()), []);

  const stopRecording = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setRecording(false);
  };

  useEffect(() => () => stopRecording(), []);

  const startRecording = () => {
    setError(null);
    const SR = getSpeechRecognition();
    if (!SR) {
      setError("Voice input isn't supported in this browser. Try Chrome or Safari.");
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    baseRef.current = instruction ? `${instruction.trimEnd()} ` : "";
    let full = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) full += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setInstruction((baseRef.current + full + interim).trimStart());
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
    const text = instruction.trim();
    if (!text || processing) return;
    stopRecording();
    setProcessing(true);
    setError(null);
    try {
      const res = await fetch("/api/refine-bullet", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orderAuthHeaders() },
        body: JSON.stringify({
          instruction: text,
          // Refine from the version on screen, not always the original.
          current: suggested?.text ?? bullet.text,
          originalBullet: sourceText || bullet.text,
          originalBulletId: bullet.id,
          turns: turns.map((turn) => ({
            instruction: turn.instruction,
            result: turn.bullet.text,
          })),
          job,
          model,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Rewrite failed");
      setTurns((prev) => {
        const next = [...prev, { instruction: text, bullet: data.bullet }];
        setShown(next.length - 1);
        return next;
      });
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rewrite failed.");
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    stopRecording();
    setInstruction("");
    setTurns([]);
    setShown(0);
    setError(null);
    onClose();
  };

  const accept = () => {
    if (!suggested) return;
    onAccept(roleId, bullet.id, suggested);
    onQuotaConsume();
    reset();
  };

  return (
    <div className="mt-3 w-full rounded-lg border border-accent-200 bg-white p-3 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-accent-700 inline-flex items-center gap-1.5">
          <Sparkles size={12} />
          Refine · {quotaRemaining} left
        </div>
        <div className="flex items-center gap-2">
          {supported && (
            <div className="flex items-center rounded-md bg-ink-50 p-0.5">
              {DICTATION_LANGS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setLang(option.id)}
                  disabled={recording}
                  className={cn(
                    "px-1.5 py-0.5 text-[10px] font-medium rounded transition",
                    lang === option.id
                      ? "bg-white text-ink-900 shadow-soft"
                      : "text-ink-500 hover:text-ink-900",
                    recording && "cursor-not-allowed opacity-50",
                  )}
                  title={`Dictate in ${option.label}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={reset}
            className="text-ink-400 hover:text-ink-700"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {turns.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {turns.map((turn, i) => (
            <button
              key={i}
              onClick={() => setShown(i)}
              className={cn(
                "block w-full truncate rounded px-2 py-1 text-left text-[11px] transition",
                i === shown
                  ? "bg-accent-50 text-accent-700 font-medium"
                  : "text-ink-400 hover:bg-ink-50 hover:text-ink-700",
              )}
              title={turn.instruction}
            >
              {i + 1}. “{turn.instruction}”
            </button>
          ))}
        </div>
      )}

      {suggested && (
        <div className="mt-2.5 rounded-md border border-accent-200 bg-accent-50/40 p-3 text-sm text-ink-900">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-widest text-accent-600">
              Suggestion
            </span>
            {turns.length > 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-500">
                <button
                  onClick={() => setShown((i) => Math.max(0, i - 1))}
                  disabled={shown === 0}
                  className="disabled:opacity-30"
                  aria-label="Previous version"
                >
                  <ChevronLeft size={13} />
                </button>
                {shown + 1}/{turns.length}
                <button
                  onClick={() =>
                    setShown((i) => Math.min(turns.length - 1, i + 1))
                  }
                  disabled={shown === turns.length - 1}
                  className="disabled:opacity-30"
                  aria-label="Next version"
                >
                  <ChevronRight size={13} />
                </button>
              </span>
            )}
          </div>
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

      {!atTurnLimit && (
        <div className="mt-2.5">
          <div className="relative">
            <textarea
              ref={boxRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={2}
              placeholder={
                suggested
                  ? "What should change about this version?"
                  : "Tell me what to change — type, paste, or dictate."
              }
              className="w-full resize-y rounded-md border border-ink-100 bg-white py-2 pl-2.5 pr-9 text-xs leading-relaxed text-ink-900 placeholder:text-ink-400 focus:border-accent-300 focus:outline-none focus:ring-2 focus:ring-accent-100"
            />
            {supported && (
              <button
                onClick={recording ? stopRecording : startRecording}
                className={cn(
                  "absolute right-1.5 top-1.5 rounded-md p-1.5 transition",
                  recording
                    ? "bg-rose-600 text-white"
                    : "text-ink-400 hover:bg-ink-50 hover:text-ink-700",
                )}
                aria-label={recording ? "Stop dictation" : "Dictate"}
                title={recording ? "Stop" : `Dictate in ${lang === "zh-CN" ? "中文" : "English"}`}
              >
                {recording ? (
                  <Square size={11} fill="currentColor" />
                ) : (
                  <Mic size={11} />
                )}
              </button>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-400">
              {recording ? (
                <span className="inline-flex items-center gap-1.5 text-rose-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                  Listening…
                </span>
              ) : turnsUsed ? (
                `Round ${turnsUsed + 1} of ${MAX_TURNS}`
              ) : (
                "⌘↵ to send"
              )}
            </span>
            <button
              onClick={submit}
              disabled={processing || !instruction.trim()}
              className="btn btn-primary !py-1.5 !px-3 text-xs disabled:opacity-40"
            >
              {processing ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Rewriting…
                </>
              ) : suggested ? (
                "Refine again"
              ) : (
                "Rewrite"
              )}
            </button>
          </div>
        </div>
      )}

      {atTurnLimit && (
        <div className="mt-2.5 text-[11px] text-ink-500">
          {MAX_TURNS} rounds used. Pick a version above, or discard and start over.
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
