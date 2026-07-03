import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import type { JobAnalysis, OptimizedBullet } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 45;

const SYSTEM = `You rewrite a SINGLE resume bullet based on what the candidate said ALOUD about what they actually did.

Absolute rules:
- Use ONLY facts the candidate mentioned in their voice transcript. Do not invent skills, technologies, metrics, or responsibilities.
- If the candidate used vague language ("a lot", "some", "improved things"), keep it qualitative. Never fabricate a number.
- The transcript is the ground truth. The previous bullet is context, not license to embellish.
- Start with a strong ownership verb (Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered).
- Output must be one bullet, under 240 characters.

Output ONLY valid JSON:

{
  "id": "voice",
  "text": string,
  "evidence": string[],       // Include the original bullet id (echoed from input). Plus "voice-transcript" as a signal.
  "matchedKeywords": string[],// 1-3 JD keywords this bullet now satisfies
  "rationale": string         // 1 sentence on how the voice input strengthened the bullet
}`;

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.voiceRewrite);
  if (rl) return rl;

  try {
    const { transcript, originalBullet, originalBulletId, job, model } =
      (await req.json()) as {
        transcript: string;
        originalBullet: string;
        originalBulletId: string;
        job: JobAnalysis | null;
        model?: string;
      };

    if (!transcript || transcript.trim().length < 8) {
      return NextResponse.json(
        { error: "Transcript is too short. Try recording a full sentence." },
        { status: 400 },
      );
    }

    const bullet = await jsonCompletion<OptimizedBullet>({
      system: SYSTEM,
      user: `Candidate's voice transcript:\n"""${transcript.trim()}"""\n\nPrevious bullet (for context, id=${originalBulletId}):\n"""${originalBullet || ""}"""\n\nJob analysis:\n${JSON.stringify(job || {})}`,
      model,
      maxTokens: 600,
    });

    // Guarantee the original id + voice signal are in evidence.
    const evidence = new Set(bullet.evidence || []);
    if (originalBulletId) evidence.add(originalBulletId);
    evidence.add("voice-transcript");
    bullet.evidence = Array.from(evidence);

    return NextResponse.json({ bullet });
  } catch (e) {
    console.error("voice-rewrite failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Voice rewrite failed" },
      { status: 500 },
    );
  }
}
