// Copyright (c) 2026 HowBe LLC. All rights reserved.
'use client';
import { useI18n } from "@/components/LanguageProvider";
import { useEffect, useRef, useState } from 'react';
import { useFlow, orderAuthHeaders } from '@/lib/store';
import { agentTargets, type AgentChange } from '@/lib/resumeAgent';
import { AgentDictation } from './AgentDictation';

export function ResumeAgent() {
  const { t } = useI18n();
  const { resume, optimization, job, selectedModel, lockedContentIds, replaceOptimizedBullet } = useFlow();
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState<{ message: string; changes: AgentChange[] } | null>(null);
  const [handled, setHandled] = useState<Record<string, string>>({});
  const snapshot = useRef<unknown>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function ask() {
    if (!resume || !optimization || busy || dictating) return;
    const requestController = new AbortController();
    controller.current = requestController;
    snapshot.current = { resume, optimization, job, selectedModel, lockedContentIds };
    setBusy(true); setError(''); setReply(null); setHandled({});
    try {
      const response = await fetch('/api/resume-agent', { method: 'POST', headers: { 'Content-Type': 'application/json', ...orderAuthHeaders() }, signal: requestController.signal,
        body: JSON.stringify({ instruction, resume, optimization, job, model: selectedModel, locked: lockedContentIds }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not prepare changes.');
      if (!Array.isArray(data.changes) || typeof data.message !== 'string') throw new Error('The assistant returned an incomplete response.');
      setReply(data);
    } catch (e) { if (!requestController.signal.aborted) setError(e instanceof Error ? e.message : 'Request failed.'); }
    finally { setBusy(false); }
  }
  function accept(change: AgentChange) {
    const state = useFlow.getState();
    const prior = snapshot.current as { resume: unknown; optimization: unknown; job: unknown; selectedModel: unknown; lockedContentIds: unknown };
    if (!state.resume || !state.optimization || state.resume !== prior.resume || state.optimization !== prior.optimization || state.job !== prior.job || state.selectedModel !== prior.selectedModel || state.lockedContentIds !== prior.lockedContentIds) {
      setError('Your resume or settings changed. Ask again to prepare changes for the current version.'); return;
    }
    const target = agentTargets(state.resume, state.optimization, state.lockedContentIds).find(t => t.id === change.id && t.roleId === change.roleId);
    if (!target || target.current.text !== change.before) { setError('This achievement changed or is locked. Ask again for a fresh proposal.'); return; }
    replaceOptimizedBullet(change.roleId, change.id, change.after);
    const updated = useFlow.getState();
    snapshot.current = { resume: updated.resume, optimization: updated.optimization, job: updated.job, selectedModel: updated.selectedModel, lockedContentIds: updated.lockedContentIds };
    setHandled(old => ({ ...old, [change.id]: 'Accepted' }));
  }
  return <section className="mt-6 rounded-xl border border-ink-200 bg-white p-4 sm:p-5" aria-label={t("Resume editing assistant")}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold text-ink-900">{t("Edit with your assistant")}</h2>
      <span className="text-xs text-ink-500">{t("Up to 3 achievement edits · Review before applying")}</span>
    </div>
    <p className="mt-1 text-sm text-ink-500">{t("Describe what to change in any language. Each suggestion is checked against your evidence. Locked achievements stay protected.")}</p>
    <form className="mt-4" onSubmit={e => { e.preventDefault(); void ask(); }}>
      <AgentDictation value={instruction} disabled={busy} onChange={setInstruction} onActiveChange={setDictating} />
      <label htmlFor="resume-agent-request" className="sr-only">{t("What would you like to change?")}</label>
      <textarea id="resume-agent-request" value={instruction} onChange={e => setInstruction(e.target.value)} maxLength={4000} rows={3} disabled={busy} readOnly={dictating}
        placeholder={t("Make my AI project achievements more concise, and keep the original tone.")}
        className="w-full resize-y rounded-lg border border-ink-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400 disabled:opacity-60" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-400">{t("Edits achievement wording; page layout, summary and skills use the existing controls.")}</p>
        {busy ? <button type="button" className="btn btn-secondary" onClick={() => controller.current?.abort()}>{t("Cancel")}</button> : <button className="btn btn-primary shrink-0" disabled={dictating || instruction.trim().length < 4}>{t("Suggest changes")}</button>}
      </div>
    </form>
    {busy && <p role="status" className="mt-3 text-sm text-ink-500">{t("Choosing achievements, rewriting and checking evidence…")}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{t(error)}</p>}
    {reply && <div className="mt-4 border-t border-ink-100 pt-4">
      <p className="whitespace-pre-wrap text-sm text-ink-700" role="status">{reply.message}</p>
      {reply.changes.map(change => <article key={change.id} className="mt-4 rounded-lg border border-ink-200 p-3">
        <div className="mb-2 text-xs font-medium text-ink-500">{change.label}</div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div><p className="mb-1 text-xs text-ink-400">{t("Current")}</p><p className="whitespace-pre-wrap text-ink-600">{change.before}</p></div>
          <div className="rounded bg-emerald-50 p-2"><p className="mb-1 text-xs text-emerald-700">{t("Suggested")}</p><p className="whitespace-pre-wrap text-ink-900">{change.after.text}</p></div>
        </div>
        <p className="mt-2 text-xs text-ink-500">{change.after.rationale}</p>
        <div className="mt-3 flex gap-2">{handled[change.id] ? <span role="status" className="text-sm text-ink-500">{t(handled[change.id])}</span> : <><button type="button" className="btn btn-primary" onClick={() => accept(change)}>{t("Accept change")}</button><button type="button" className="btn btn-secondary" onClick={() => setHandled(old => ({ ...old, [change.id]: 'Dismissed' }))}>{t("Dismiss")}</button></>}</div>
      </article>)}
    </div>}
  </section>;
}
