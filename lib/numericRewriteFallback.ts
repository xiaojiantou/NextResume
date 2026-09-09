// Copyright (c) 2026 HowBe LLC. All rights reserved.
import { numbersAreGrounded } from "./resumeStructure.ts";
import type { Optimization, Resume } from "./types";

/** Last-attempt recovery: keep source wording for ungrounded numeric rewrites.
 * This does not approve a derived figure or bypass the remaining validators. */
export function restoreUnsupportedNumericText(resume: Resume, candidate: Optimization, locked: string[] = []): { optimization: Optimization; restoredIds: string[] } {
  const source = new Map([...resume.experience, ...(resume.projects ?? [])].map(entry => [entry.id, new Map(entry.bullets.map(bullet => [bullet.id, bullet]))]));
  const locks = new Set(locked), restoredIds: string[] = [];
  const restore = (entry: Optimization["roles"][number]) => ({
    ...entry,
    bullets: entry.bullets.map(bullet => {
      const entrySource = source.get(entry.id);
      const original = entrySource?.get(bullet.id);
      if (!original || locks.has(entry.id) || locks.has(bullet.id) || !bullet.evidence.length || bullet.evidence.some(id => !entrySource?.has(id))) return bullet;
      const evidenceText = bullet.evidence.map(id => entrySource!.get(id)!.text).join(" ");
      if (numbersAreGrounded(bullet.text, evidenceText)) return bullet;
      restoredIds.push(bullet.id);
      return { ...bullet, text: original.text, evidence: [original.id], matchedKeywords: [], rationale: "Kept the original measurement and context after numeric rewrite retries failed.", contentReview: undefined };
    }),
  });
  const optimization: Optimization = { ...candidate, roles: candidate.roles.map(restore), projects: (candidate.projects ?? []).map(restore) };
  if (!locks.has("summary") && !numbersAreGrounded(candidate.summary, JSON.stringify(resume))) {
    optimization.summary = resume.summary;
    restoredIds.push("summary");
  }
  return { optimization, restoredIds };
}
