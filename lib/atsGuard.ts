// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { applyOptimizationToResume } from "./applyOptimization.ts";
import { countOccurrences, resumeToText, scoreResume } from "./atsScore.ts";
import type { JobAnalysis, Optimization, OptimizedBullet, Resume } from "./types";

export type AtsGuardRestoration = { id: string; reason: string };

/**
 * The deliverable must never score below the resume it started from on the
 * deterministic ATS rubric. A rewrite loses points in ways the model and the
 * content reviewer cannot see: a job keyword the source carried disappears
 * from a bullet or the summary, or the headline stops matching the posting.
 * Restore exactly the source field that carried what was lost; everything
 * else stays as reviewed.
 */
export function guardAtsRegression({
  resume,
  optimization,
  job,
  lockedContentIds = [],
}: {
  resume: Resume;
  optimization: Optimization;
  job: JobAnalysis;
  lockedContentIds?: string[];
}): { optimization: Optimization; restored: AtsGuardRestoration[] } {
  const locks = new Set(lockedContentIds);
  const restored: AtsGuardRestoration[] = [];
  let opt = optimization;
  const applied = () => applyOptimizationToResume(resume, opt);

  const keywords = [
    ...new Set([...(job.requiredKeywords ?? []), ...(job.niceToHaveKeywords ?? [])].filter(Boolean)),
  ];
  const sourceText = resumeToText(resume);
  const carried = keywords.filter((keyword) => countOccurrences(sourceText, keyword) > 0);

  const sourceBullets = new Map<string, { entryId: string; text: string }>();
  for (const entry of [...resume.experience, ...(resume.projects ?? [])]) {
    for (const bullet of entry.bullets) sourceBullets.set(bullet.id, { entryId: entry.id, text: bullet.text });
  }
  const restoreBullet = (bullet: OptimizedBullet, keyword: string): OptimizedBullet => ({
    ...bullet,
    text: sourceBullets.get(bullet.id)!.text,
    evidence: [bullet.id],
    matchedKeywords: [],
    rationale: `Kept the original wording: it carries the job keyword "${keyword}" that the rewrite dropped.`,
    contentReview: undefined,
  });

  for (let pass = 0; pass < keywords.length; pass += 1) {
    const current = resumeToText(applied()).toLowerCase();
    const lost = carried.filter((keyword) => countOccurrences(current, keyword) === 0);
    if (lost.length === 0) break;
    let changed = false;
    for (const keyword of lost) {
      let bulletRestored = false;
      const restoreEntry = <T extends { id: string; bullets: OptimizedBullet[] }>(entry: T): T => ({
        ...entry,
        bullets: entry.bullets.map((bullet) => {
          const source = sourceBullets.get(bullet.id);
          if (
            !source ||
            locks.has(entry.id) ||
            locks.has(bullet.id) ||
            source.text === bullet.text ||
            countOccurrences(source.text.toLowerCase(), keyword) === 0
          ) {
            return bullet;
          }
          bulletRestored = true;
          restored.push({ id: bullet.id, reason: `"${keyword}" was dropped from ${bullet.id}.` });
          return restoreBullet(bullet, keyword);
        }),
      });
      opt = {
        ...opt,
        roles: opt.roles.map(restoreEntry),
        projects: (opt.projects ?? []).map(restoreEntry),
      };
      if (bulletRestored) {
        changed = true;
        continue;
      }
      if (
        !locks.has("summary") &&
        opt.summary !== resume.summary &&
        countOccurrences((resume.summary ?? "").toLowerCase(), keyword) > 0
      ) {
        opt = { ...opt, summary: resume.summary };
        restored.push({ id: "summary", reason: `"${keyword}" was dropped from the summary.` });
        changed = true;
      }
    }
    if (!changed) break;
  }

  if (!locks.has("title") && opt.title !== resume.title) {
    const titleScore = (candidate: Resume) =>
      scoreResume(candidate, job).categories.find((category) => category.label === "Title match")?.score ?? 0;
    const before = titleScore(resume);
    if (titleScore(applied()) < before) {
      opt = { ...opt, title: resume.title };
      restored.push({ id: "title", reason: "The rewritten headline matched the posting's title less than the original." });
    }
  }

  return { optimization: opt, restored };
}
