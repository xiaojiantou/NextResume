// Copyright (c) 2026 HowBe LLC. All rights reserved.
'use client';
import { useI18n } from "@/components/LanguageProvider";
import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

type Recognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
function recognitionConstructor() {
  const browser = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export function AgentDictation({ value, disabled, onChange, onActiveChange }: {
  value: string; disabled: boolean; onChange: (value: string) => void; onActiveChange: (active: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [language, setLanguage] = useState('en-US');
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const recognition = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setSupported(Boolean(recognitionConstructor()));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      const rec = recognition.current;
      if (rec) { rec.onresult = null; rec.onerror = null; rec.onend = null; rec.abort(); }
    };
  }, []);
  useEffect(() => { if (!recognition.current) setLanguage(locale === 'zh' ? 'zh-CN' : 'en-US'); }, [locale]);
  function start() {
    if (disabled || recognition.current) return;
    const Constructor = recognitionConstructor();
    if (!Constructor) return;
    setError('');
    const rec = new Constructor();
    const base = value.trimEnd();
    rec.lang = language; rec.continuous = true; rec.interimResults = true;
    recognition.current = rec;
    const finish = () => {
      if (timer.current) clearTimeout(timer.current);
      recognition.current = null;
      rec.onresult = null; rec.onerror = null; rec.onend = null;
      setActive(false); onActiveChange(false);
    };
    rec.onresult = event => {
      // Rebuild from the session's complete results, avoiding duplicate finals.
      const spoken = Array.from(event.results).map(result => result[0].transcript).join(' ');
      const next = [base, spoken].filter(Boolean).join(' ');
      onChange(next.slice(0, 4000));
      if (next.length >= 4000) { setError('The 4,000-character limit was reached. Review the text before continuing.'); rec.stop(); }
    };
    rec.onerror = event => {
      setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access was denied. Allow it in browser settings, or type your request.'
        : event.error === 'no-speech' ? 'No speech detected. Try again or type your request.'
        : 'Voice transcription could not finish. Check your microphone and connection, or type your request.');
      rec.abort(); finish();
    };
    rec.onend = finish;
    try {
      rec.start(); setActive(true); onActiveChange(true);
      timer.current = setTimeout(() => rec.stop(), 120_000);
    } catch {
      finish(); setError('Could not start voice input. Try again or type your request.');
    }
  }
  return <div className="mb-2">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled || !supported} aria-pressed={active}
        onClick={() => active ? recognition.current?.stop() : start()}
        className="btn btn-secondary text-sm">
        {active ? <Square size={14} /> : <Mic size={14} />}{t(active ? 'Stop dictation' : 'Voice input')}
      </button>
      <label className="inline-flex items-center gap-2 text-xs text-ink-500">{t("Spoken language")}<select aria-label={t("Spoken language")} value={language} disabled={active || disabled} onChange={e => setLanguage(e.target.value)} className="rounded border border-ink-200 bg-white px-2 py-1.5 text-sm">
          <option value="en-US">{t("English")}</option><option value="zh-CN">中文</option>
        </select>
      </label>
      <span role="status" className="text-xs text-ink-500">{t(active ? 'Listening… Stop to review and edit your text.' : supported === false ? 'Voice input is unavailable in this browser. You can still type below.' : 'Transcribe, review, then suggest changes.')}</span>
    </div>
    <p className="mt-1 text-xs text-ink-400">{t("Voice input uses your browser’s speech service.")}</p>
    {error && <p role="alert" className="mt-1 text-xs text-red-600">{t(error)}</p>}
  </div>;
}
