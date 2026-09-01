// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Prompt construction for a single-bullet refinement conversation.
//
// Split out of the route so the parts worth pinning down — that earlier rounds
// survive, that the latest instruction is last, and that the original bullet
// is always present as the language anchor — can be asserted without paying
// for a model call.

/**
 * Past this a conversation has stopped converging, and every round carries all
 * prior rounds, so a runaway thread costs quadratically.
 */
export const MAX_TURNS = 6;

export const REFINE_SYSTEM = `You rewrite a SINGLE resume bullet according to what the candidate tells you about what they actually did.

Absolute rules:
- Use ONLY facts the candidate stated. Do not invent skills, technologies, metrics, or responsibilities.
- If the candidate is vague ("a lot", "some", "improved things"), keep it qualitative. Never fabricate a number.
- The candidate's instructions are the ground truth. The previous bullet is context, not license to embellish.
- Start with a strong ownership verb (Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered).
- Output must be one bullet, under 240 characters.

Language:
- The candidate may instruct you in ANY language.
- Write "text" in the SAME LANGUAGE as the ORIGINAL BULLET, never the language of the instruction. A Chinese instruction about an English bullet produces an English bullet.
- Write "rationale" in the language the candidate used for their latest instruction.

Conversation:
- Earlier rounds are context and still apply. Keep satisfying them unless the latest instruction overrides them.
- On a direct conflict, the latest instruction wins.

Output ONLY valid JSON:

{
  "id": "refined",
  "text": string,
  "evidence": string[],       // Include the original bullet id (echoed from input). Plus "voice-transcript" as a signal.
  "matchedKeywords": string[],// 1-3 JD keywords this bullet now satisfies
  "rationale": string         // 1 sentence on how the instruction strengthened the bullet
}`;

export type RefineTurn = { instruction?: string; result?: string };

/** Drops half-formed rounds — a failed request leaves an instruction with no result. */
export function normalizeTurns(turns: RefineTurn[] | undefined): Array<{
  instruction: string;
  result: string;
}> {
  return (turns ?? [])
    .filter((turn) => turn.instruction?.trim() && turn.result?.trim())
    .map((turn) => ({
      instruction: turn.instruction!.trim(),
      result: turn.result!.trim(),
    }));
}

export function buildRefineUserMessage({
  instruction,
  current,
  originalBullet,
  originalBulletId,
  turns,
  job,
}: {
  instruction: string;
  current?: string;
  originalBullet: string;
  originalBulletId: string;
  turns: Array<{ instruction: string; result: string }>;
  job: unknown;
}): string {
  const conversation = turns
    .map(
      (turn, i) =>
        `Round ${i + 1}\nCandidate asked: """${turn.instruction}"""\nYou produced: """${turn.result}"""`,
    )
    .join("\n\n");

  return [
    `ORIGINAL BULLET (the candidate's own resume, id=${originalBulletId}) — match this language:\n"""${originalBullet}"""`,
    `CURRENT BULLET (what they are refining now):\n"""${(current || originalBullet).trim()}"""`,
    conversation ? `EARLIER ROUNDS:\n${conversation}` : "",
    `LATEST INSTRUCTION:\n"""${instruction.trim()}"""`,
    `JOB ANALYSIS:\n${JSON.stringify(job || {})}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
