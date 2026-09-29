// Copyright (c) 2026 HowBe LLC. All rights reserved.
import { NextRequest, NextResponse } from 'next/server';
import { jsonCompletion } from '@/lib/ai';
import { requirePaidOrder } from '@/lib/entitlement';
import { rateLimitGuard } from '@/lib/ratelimit';
import { agentTargets, runResumeAgent } from '@/lib/resumeAgent';
import { runRefinementHarness } from '@/lib/refinementHarness';
import { normalizePriorEvidence, refinementEvidenceLedger } from '@/lib/evidenceLedger';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(req: NextRequest) {
  const limited = rateLimitGuard(req, { key: 'resume-agent', limit: 5, windowMs: 60_000 });
  if (limited) return limited;
  const entitlement = await requirePaidOrder(req);
  if (!entitlement.ok) return entitlement.response;
  try {
    const text = await req.text();
    if (text.length > 250_000) return NextResponse.json({ error: 'Resume request is too large.' }, { status: 413 });
    const { instruction, resume, optimization, job, model, locked = [] } = JSON.parse(text);
    if (typeof instruction !== 'string' || instruction.trim().length < 4 || instruction.length > 4000 || !Array.isArray(resume?.experience) || !Array.isArray(optimization?.roles) || !Array.isArray(optimization?.projects) || !Array.isArray(locked) || locked.some((v: unknown) => typeof v !== 'string') || (model !== undefined && typeof model !== 'string')) return NextResponse.json({ error: 'Provide a resume and an editing request of 4–4000 characters.' }, { status: 400 });
    let targets;
    try { targets = agentTargets(resume, optimization, locked); }
    catch { return NextResponse.json({ error: 'Invalid resume content.' }, { status: 400 }); }
    const deadline = AbortSignal.any([req.signal, AbortSignal.timeout(150_000)]);
    const result = await runResumeAgent({ instruction, job, targets }, {
      complete: args => jsonCompletion({ ...args, model, signal: AbortSignal.any([deadline, AbortSignal.timeout(20_000)]) }),
      refine: target => runRefinementHarness({
        instruction, current: target.current.text, originalBullet: target.original, originalBulletId: target.id, turns: [], job, model,
        ledger: refinementEvidenceLedger({ source: target.original, prior: normalizePriorEvidence(target.current.evidenceLedger), notes: '', estimates: [], instructions: [instruction], now: new Date().toISOString() }),
      }, args => jsonCompletion({ ...args, model, signal: AbortSignal.any([deadline, ...(args.signal ? [args.signal] : [])]) })),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('resume-agent failed', error);
    return NextResponse.json({ error: 'The editing assistant could not finish. Your resume is unchanged; please try again.' }, { status: 503 });
  }
}
