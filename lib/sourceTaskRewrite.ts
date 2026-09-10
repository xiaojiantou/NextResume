// Copyright (c) 2026 HowBe LLC. All rights reserved.
import { explicitTaskRevision } from "./contentQuality.ts";
import type { Optimization, Resume } from "./types";

const pastTasks: Record<string, string> = {
  writing: "Wrote", maintaining: "Maintained", documenting: "Documented",
  testing: "Tested", reviewing: "Reviewed", updating: "Updated", adding: "Added",
  implementing: "Implemented", configuring: "Configured", building: "Built",
};

/** A proposal, not an approval. Only the past responsibility prefix changes;
 * the entire object and evidence remain verbatim for normal independent review. */
export function sourceTaskText(source: string): string | undefined {
  if (!explicitTaskRevision(source) || /[\r\n]/.test(source)) return undefined;
  const match = source.match(/^(?:I\s+)?was\s+responsible for (?:the task of )?(writing|maintaining|documenting|testing|reviewing|updating|adding|implementing|configuring|building)(\s+.+)$/i);
  if (!match) return undefined;
  // Assignment alone does not establish completion. Avoid speculative,
  // assisted or coordinated tasks that a prefix replacement cannot resolve.
  if (/\b(?:not|never|yet|only|help(?:ed|ing)?|assist(?:ed|ing|ance)?|supporting|assigned|expected|intended|attempt(?:ed|ing)?|trying|aim(?:ed|ing)?|could|should|might|may|pending|incomplete|unfinished)\b/i.test(source)) return undefined;
  if (/(?:\b(?:and|or|while|as well as)\s+|[,&]\s*)(?:(?:also|then|\w+ly)\s+)*\w+ing\b/i.test(match[2])) return undefined;
  return pastTasks[match[1].toLowerCase()] + match[2];
}

/** Offer a source edit only for an explicitly selected retry. Invalid citations,
 * locks, approved siblings and unrelated bullets must remain untouched. */
export function proposeSourceTaskEdits(
  resume: Resume, candidate: Optimization, eligibleIds: ReadonlySet<string>,
  locked: string[] = [], approvedIds: ReadonlySet<string> = new Set(),
): { optimization: Optimization; proposedIds: string[] } {
  const sources = new Map([...resume.experience, ...(resume.projects ?? [])].map(entry => [entry.id, new Map(entry.bullets.map(b => [b.id, b.text]))]));
  const locks = new Set(locked), proposedIds: string[] = [];
  const propose = (entry: Optimization["roles"][number]) => ({
    ...entry,
    bullets: entry.bullets.map(bullet => {
      if (!eligibleIds.has(bullet.id) || approvedIds.has(bullet.id) || locks.has(entry.id) || locks.has(bullet.id)) return bullet;
      const source = sources.get(entry.id);
      const text = source?.get(bullet.id);
      if (!text || !bullet.evidence.length || bullet.evidence.some(id => !source?.has(id))) return bullet;
      const proposal = sourceTaskText(text);
      if (!proposal) return bullet;
      proposedIds.push(bullet.id);
      return { ...bullet, text: proposal, evidence: [bullet.id], matchedKeywords: [], contentReview: undefined,
        rationale: "Proposed a direct description of the documented task while preserving the remaining source verbatim; pending review." };
    }),
  });
  return { optimization: { ...candidate, roles: candidate.roles.map(propose), projects: (candidate.projects ?? []).map(propose) }, proposedIds };
}
