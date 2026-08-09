import { jsonCompletion } from "./ai";
import type { Optimization, Resume } from "./types";

const SEMANTIC_REVIEW_SYSTEM = `You are a conservative resume evidence reviewer. Decide whether each candidate sentence is semantically supported by the supplied source evidence.

Return ONLY JSON:
{
  "valid": boolean,
  "issues": [{ "id": string, "reason": string }]
}

Review rules:
- Accept paraphrases, compression, reordered wording, standard aliases, and reasonable implications that are clearly entailed by the evidence.
- Accept weaker or more general claims than the evidence.
- Do not require exact keyword overlap.
- Reject only a material new fact, responsibility, tool, metric, scope, result, employer, customer, credential, or contradiction that the evidence does not support.
- Do not reject style, grammar, brevity, or missing detail.
- Keep reasons short and factual.`;

type SemanticReview = {
  valid?: boolean;
  issues?: Array<{ id?: string; reason?: string }>;
};

function sourceBulletMap(resume: Resume): Map<string, string> {
  return new Map(
    [
      ...resume.experience.flatMap((role) => role.bullets),
      ...(resume.projects ?? []).flatMap((project) => project.bullets),
      ...(resume.additionalSections ?? []).flatMap((section) =>
        section.items.flatMap((item) => item.bullets),
      ),
    ].map((bullet) => [bullet.id, bullet.text]),
  );
}

export async function reviewSemanticGrounding({
  resume,
  candidate,
  model,
  timeoutMs = 8_000,
}: {
  resume: Resume;
  candidate: Optimization;
  model?: string;
  timeoutMs?: number;
}): Promise<string[]> {
  const source = sourceBulletMap(resume);
  const bullets = [
    ...candidate.roles.flatMap((role) => role.bullets),
    ...(candidate.projects ?? []).flatMap((project) => project.bullets),
    ...(candidate.additionalSections ?? []).flatMap((section) =>
      section.items.flatMap((item) => item.bullets),
    ),
  ].map((bullet) => ({
    id: bullet.id,
    candidate: bullet.text,
    evidence: bullet.evidence.map((id) => source.get(id) ?? "").filter(Boolean),
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const review = await jsonCompletion<SemanticReview>({
      system: SEMANTIC_REVIEW_SYSTEM,
      user: JSON.stringify({
        summary: {
          candidate: candidate.summary,
          source: resume.summary,
        },
        sourceContext: JSON.stringify(resume).slice(0, 24_000),
        bullets,
      }),
      model,
      maxTokens: 1200,
      signal: controller.signal,
    });
    if (review.valid !== false && !review.issues?.length) return [];
    const issues = (review.issues ?? [])
      .flatMap((issue) => {
        const id = typeof issue?.id === "string" ? issue.id.trim() : "";
        const reason =
          typeof issue?.reason === "string" ? issue.reason.trim() : "";
        return id && reason
          ? [`Semantic grounding failed for ${id}: ${reason}`]
          : [];
      })
      .slice(0, 12);
    return issues.length > 0
      ? issues
      : ["Semantic grounding review found an unsupported claim."];
  } catch (error) {
    // A checker outage must not discard a rewrite that already passed the
    // deterministic hard-fact, number, ownership, and lock validators.
    console.warn("semantic resume review unavailable", error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
