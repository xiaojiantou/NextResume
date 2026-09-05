// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The rewrite is generated one resume entry at a time, in parallel, instead
// of as one whole-document completion. A single 7000-token generation took
// 60-120s on the default model, and every validation miss regenerated the
// whole document up to three times, so the route routinely hit its budget.
// Evidence for a bullet must come from its own entry anyway, so entries are
// independent for the model: they can be written concurrently and only the
// entry that failed a check is regenerated.

// Relative with an explicit extension: value imports must also resolve under
// the node test runner and the eval script, which do not know the "@/" alias.
import {
  MAX_KEYWORD_REPEATS,
  countOccurrences,
  resumeToText,
} from "./atsScore.ts";
import type {
  AtsReport,
  ContentStructureMode,
  JobAnalysis,
  Optimization,
  Resume,
} from "./types";

export type RewriteChunk =
  | { kind: "role"; id: string }
  | { kind: "project"; id: string }
  | { kind: "additional"; id: string }
  | { kind: "global" };

export const chunkKey = (chunk: RewriteChunk): string =>
  chunk.kind === "global" ? "global" : `${chunk.kind}:${chunk.id}`;

export function planRewriteChunks(
  resume: Resume,
  structureMode: ContentStructureMode,
): RewriteChunk[] {
  return [
    { kind: "global" },
    ...resume.experience
      .filter((role) => role.bullets.length > 0)
      .map((role) => ({ kind: "role" as const, id: role.id })),
    ...(resume.projects ?? [])
      .filter((project) => project.bullets.length > 0)
      .map((project) => ({ kind: "project" as const, id: project.id })),
    ...(structureMode === "preserve"
      ? (resume.additionalSections ?? [])
          .filter((section) => section.items.some((item) => item.bullets.length > 0))
          .map((section) => ({ kind: "additional" as const, id: section.id }))
      : []),
  ];
}

const FACTUAL_INTEGRITY = `Hard rules — factual integrity:
- A metric (number, percentage, dollar amount, latency) must stay attached to the exact action that produced it in the original bullet. Never move a metric onto a different action, tool, or system than the original credits.
- NEVER introduce a number the cited evidence does not already contain — no estimates, no approximations, no rounding a figure the source never stated. If the original bullet has no metric, stay qualitative.
- Version and product names carry digits (S3, EC2, p99, GPT-4, OAuth 2.0). Use one only if that exact name appears in the bullet you are rewriting.`;

const WRITING_STYLE = `Hard rules — writing style:
- Weave matched keywords into the factual claim itself — the tool used, the method applied, the thing built. NEVER append meta-commentary clauses such as "showcasing proficiency in X", "demonstrating expertise in Y", "highlighting Z", "proving ability to W". A bullet ends with a concrete outcome or fact, never with a comment about the candidate's skills.
- Start bullets with verbs from this set first: Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered. Vary sentence structure across bullets.
- State a job keyword once where it is load-bearing; do not repeat the same term across several bullets — ATS keyword-stuffing filters flag that density.`;

const KEYWORD_COVERAGE = `Hard rules — keyword coverage:
- The ATS gaps list the job's missing keywords. Walk that list. For each one, ask whether this entry ALREADY demonstrates the same thing under different wording — "K8s" for Kubernetes, "REST endpoints" for API development, "on-call" for production support. Where it does, say it in the posting's wording instead of the candidate's. That is a naming change, not a new claim, and it is where most of the real gain lives.
- Where the entry genuinely does not demonstrate a missing keyword, LEAVE IT OUT. An honest gap costs the candidate far less than a fabricated match.`;

const BULLET_SCHEMA = `{ "id": string, "text": string, "evidence": string[], "matchedKeywords": string[], "rationale": string }`;

const ENTRY_OPTIMIZE_SYSTEM = `You rewrite the achievements of ONE entry from a candidate's resume (a work role or a project) so they are tailored to a specific job description. This is the most important rule:

EVERY rewritten bullet MUST be grounded in the candidate's ACTUAL experience. You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. Every rewrite cites the original bullet id that justifies it.

Output ONLY valid JSON matching this schema:

{
  "id": string,          // the entry id exactly as given
  "bullets": [ ${BULLET_SCHEMA} ]
}

Hard rules — content preservation:
- Rewrite bullets ONE-TO-ONE. Return the SAME entry id and the SAME number of bullets in the SAME order, each output bullet reusing the id of the input bullet it rewrites. NEVER merge, drop, or add bullets. The user decides what to cut, not you.
- The entry may include "teams" that group achievements inside the same company. Treat team names as source context only. Do not output "teams"; return every team achievement in the flat "bullets" list using the same bullet id.
- "evidence" must list REAL bullet ids from THIS entry — normally exactly the bullet being rewritten. Never cite a bullet from another entry and never invent ids.
- "rationale" is 1 sentence explaining the rewrite.

${FACTUAL_INTEGRITY}

${WRITING_STYLE}

${KEYWORD_COVERAGE}`;

const ENTRY_PRESERVE_SYSTEM = `You rewrite the achievements of ONE entry from a candidate's resume for a target job while preserving the source content exactly.

Output ONLY valid JSON matching this schema:

{
  "id": string,          // the entry id exactly as given
  "bullets": [ ${BULLET_SCHEMA} ]
}

Non-negotiable rules:
- Return every bullet exactly once, in source order. Every output bullet id MUST equal its one source bullet id. Its evidence MUST be exactly [that same id]. Never merge, split, add, delete, or move bullets.
- The entry may include "teams" that group achievements inside the same company. Treat team names as source context only. Do not output "teams"; return every team achievement in the flat "bullets" list using the same bullet id.
- Never alter or infer companies, job titles, project names, dates, locations, metrics, tools, or results.
- Every number in a rewrite must already appear in that same source bullet.
- Use concise, natural English. Keep each bullet non-empty and improve relevance only within its own evidence.
- Weave job keywords into the factual claim itself; never append meta-commentary such as "showcasing proficiency in X".`;

const ADDITIONAL_PRESERVE_SYSTEM = `You rewrite the bullets of ONE additional resume section (awards, certifications, publications, volunteering, or similar) for a target job while preserving the source content exactly.

Output ONLY valid JSON matching this schema:

{
  "id": string,          // the section id exactly as given
  "items": [{ "id": string, "bullets": [ ${BULLET_SCHEMA} ] }]
}

Non-negotiable rules:
- Return every item and every bullet exactly once, in source order, with the same ids. Every output bullet's evidence MUST be exactly [its own id]. Never merge, split, add, delete, or move items or bullets.
- Never alter or infer organizations, awards, certificates, publications, dates, metrics, or results.
- Every number in a rewrite must already appear in that same source bullet.
- Use concise, natural English. Keep each bullet non-empty.`;

const GLOBAL_OPTIMIZE_SYSTEM = `You tailor the headline, summary, skills list, and section organization of a resume to a specific job description. The achievement bullets are rewritten separately; you do not output them.

EVERYTHING you write must be grounded in the candidate's ACTUAL experience. You are forbidden from inventing skills, technologies, metrics, or responsibilities the resume does not demonstrate.

Output ONLY valid JSON matching this schema:

{
  "summary": string,
  "title": string,
  "skills": string[],
  "skillEvidence": [{
    // ONLY for a skill you are adding. A skill copied from the input needs no
    // entry. Usually this array is empty or holds one or two items.
    "skill": string,
    "grounding": "indirect",
    "skillType": "capability" | "domain" | "soft",
    "evidence": string[],
    "rationale": string
  }],
  "sectionOrder": ["summary", "skills", "experience", "projects", "education", "additional:<source-section-id>"],
  "sectionLabels": {
    "summary": "Summary" | "Professional Summary" | "Research Profile",
    "skills": "Skills" | "Core Skills" | "Technical Skills" | "Core Competencies",
    "experience": "Experience" | "Professional Experience" | "Work Experience" | "Research Experience",
    "projects": "Projects" | "Selected Projects" | "Technical Projects" | "Research Projects",
    "education": "Education" | "Academic Background"
  }
}

Hard rules — headline, skills, and summary:
- "title" is the headline that sits under the candidate's name. It is the field recruiters filter an ATS on, so it must speak to THIS posting, not to the candidate's last job. Set it to the posting's exact job title when the candidate's experience supports that role. If the posting's seniority would overstate them, keep the posting's role words and drop only the level ("Senior Backend Platform Engineer" -> "Backend Platform Engineer"). Never claim a specialization the resume does not evidence, and never put a company name in it.
- "skills" must contain EVERY skill from the input resume, reordered so the ones matching the JD come first. You may add a skill ONLY if the resume bullets clearly demonstrate it. Never drop a real skill, never invent one.
- Return a skillEvidence entry ONLY for a skill you are ADDING — one whose words are not already in the input resume. An added skill must be a "capability", "domain" or "soft" skill, must cite 1-3 real source bullet ids in "evidence", and must explain the support in "rationale". A tool, framework, platform, credential or language can never be added — if the resume does not name it, it does not go in.
- "summary": if the input resume has a summary, rewrite THAT summary in place with concise wording; do not prepend a second summary, do not echo the old summary plus a new one, and keep it to 1-2 sentences grounded only in real experience.
- If the input resume has no summary, return "" unless a short summary would materially improve role positioning for this specific job. When you create one, keep it to 1-2 concise sentences grounded only in real experience.
- NEVER introduce a number the resume does not already contain. Never append meta-commentary such as "showcasing proficiency in X".

Hard rules — organization:
- sectionOrder must contain every non-empty source section exactly once. Reorder sections to lead with the strongest evidence for the target role. Use additional:<id> for every source additional section.
- Choose sectionLabels only from the exact allowed values in the schema. Use role-relevant conventional headings; do not invent headings.`;

const GLOBAL_PRESERVE_SYSTEM = `You rewrite the headline, summary, and skills list of a resume for a target job while preserving the source content exactly. The achievement bullets are rewritten separately; you do not output them.

Output ONLY valid JSON matching this schema:

{ "summary": string, "title": string, "skills": string[] }

Non-negotiable rules:
- Keep every source skill. You may reorder skills and normalize capitalization only. Never add or remove one.
- If the source summary is present, rewrite that summary in place with concise wording; do not add a second summary above it. If the source summary is empty, keep it empty.
- If the source professional title is empty, keep it empty. If present, rewrite it without adding unsupported facts.
- Never introduce a number the resume does not already contain. Never append meta-commentary such as "showcasing proficiency in X".`;

export type ChunkPrompt = { system: string; user: string; maxTokens: number };

type Bullet = Resume["experience"][number]["bullets"][number];

function feedbackBlock(feedback: string[]): string {
  return feedback.length > 0
    ? `\n\nYour previous response violated these constraints. Correct every issue without inventing or dropping source content:\n${feedback
        .slice(0, 20)
        .map((issue) => `- ${issue}`)
        .join("\n")}`
    : "";
}

function entryBulletIds(entry: { id: string; bullets: Bullet[] }): Set<string> {
  return new Set([entry.id, ...entry.bullets.map((bullet) => bullet.id)]);
}

/** The text a chunk is allowed to rewrite, as the source resume has it. */
function chunkSourceText(
  resume: Resume,
  structureMode: ContentStructureMode,
  chunk: RewriteChunk,
): string {
  if (chunk.kind === "global") {
    return [resume.title, resume.summary].filter(Boolean).join("\n");
  }
  if (chunk.kind === "role") {
    return (resume.experience.find((role) => role.id === chunk.id)?.bullets ?? [])
      .map((bullet) => bullet.text)
      .join("\n");
  }
  if (chunk.kind === "project") {
    return ((resume.projects ?? []).find((project) => project.id === chunk.id)?.bullets ?? [])
      .map((bullet) => bullet.text)
      .join("\n");
  }
  if (structureMode !== "preserve") return "";
  return ((resume.additionalSections ?? []).find((section) => section.id === chunk.id)?.items ?? [])
    .flatMap((item) => item.bullets.map((bullet) => bullet.text))
    .join("\n");
}

/**
 * Entries are written without seeing each other, so every one of them reaches
 * for the same top JD keyword and the assembled document trips the stuffing
 * cap validateOptimization enforces. Each chunk keeps the mentions its own
 * source text already has plus an equal share of whatever slack the whole
 * document has left under the cap; a keyword the resume never uses may still
 * be introduced once, so the "K8s -> Kubernetes" renames the prompt asks for
 * stay possible even on a long resume.
 */
function keywordBudgetBlock({
  resume,
  job,
  chunk,
  structureMode,
}: {
  resume: Resume;
  job: JobAnalysis;
  chunk: RewriteChunk;
  structureMode: ContentStructureMode;
}): string {
  const keywords = [
    ...new Set(
      [...(job.requiredKeywords ?? []), ...(job.niceToHaveKeywords ?? [])].filter(Boolean),
    ),
  ];
  if (keywords.length === 0) return "";
  const sourceText = resumeToText(resume);
  const ownText = chunkSourceText(resume, structureMode, chunk).toLowerCase();
  const parts = planRewriteChunks(resume, structureMode).length;
  const blocked: string[] = [];
  const caps: Record<string, number> = {};
  for (const keyword of keywords) {
    const total = countOccurrences(sourceText, keyword);
    const slack = Math.max(MAX_KEYWORD_REPEATS, total) - total;
    let budget = countOccurrences(ownText, keyword) + Math.floor(slack / parts);
    if (total === 0) budget = Math.max(budget, 1);
    if (budget <= 0) blocked.push(keyword);
    else if (budget < MAX_KEYWORD_REPEATS) caps[keyword] = budget;
  }
  if (blocked.length === 0 && Object.keys(caps).length === 0) return "";
  const where =
    chunk.kind === "global" ? "in the summary or headline" : "across this entry";
  return `\n\nKeyword density budget (the rest of the resume already carries these terms; exceeding the document-wide cap trips ATS keyword-stuffing filters):${
    blocked.length > 0
      ? `\n- Do NOT add these terms ${where}: ${JSON.stringify(blocked)}`
      : ""
  }${
    Object.keys(caps).length > 0
      ? `\n- Maximum mentions ${where}, per term: ${JSON.stringify(caps)}`
      : ""
  }`;
}

export function buildChunkPrompt({
  chunk,
  resume,
  job,
  report,
  structureMode,
  lockedContentIds,
  baselineOptimization,
  feedback = [],
}: {
  chunk: RewriteChunk;
  resume: Resume;
  job: JobAnalysis;
  report: AtsReport;
  structureMode: ContentStructureMode;
  lockedContentIds: string[];
  baselineOptimization: Optimization | null;
  feedback?: string[];
}): ChunkPrompt {
  const preserve = structureMode === "preserve";
  const jobBlock = `\n\nJob analysis:\n${JSON.stringify(job)}`;
  const gapsBlock = `\n\nATS gaps to close (missing keywords):\n${JSON.stringify(report.missingKeywords ?? [])}`;

  if (chunk.kind === "global") {
    const entryIds = new Set([
      ...resume.experience.flatMap((role) => [...entryBulletIds(role)]),
      ...(resume.projects ?? []).flatMap((project) => [...entryBulletIds(project)]),
    ]);
    const locked = lockedContentIds.filter((id) => !entryIds.has(id));
    const baseline = baselineOptimization
      ? {
          summary: baselineOptimization.summary,
          title: baselineOptimization.title,
          skills: baselineOptimization.skills,
        }
      : null;
    return {
      system: preserve ? GLOBAL_PRESERVE_SYSTEM : GLOBAL_OPTIMIZE_SYSTEM,
      user: `Original resume:\n${JSON.stringify(resume)}${jobBlock}\n\nATS report (gaps to close):\n${JSON.stringify(report)}${keywordBudgetBlock({ resume, job, chunk, structureMode })}\n\nUser-locked content ids (return their text verbatim):\n${JSON.stringify(locked)}\n\nLocked wording baseline:\n${JSON.stringify(baseline)}${feedbackBlock(feedback)}`,
      maxTokens: preserve ? 1200 : 2000,
    };
  }

  const context = `\n\nCandidate headline and summary (context only — do not rewrite them here):\n${JSON.stringify({ title: resume.title, summary: resume.summary })}`;

  if (chunk.kind === "additional") {
    const section = (resume.additionalSections ?? []).find(
      (candidate) => candidate.id === chunk.id,
    );
    const items = section?.items ?? [];
    const ids = new Set([
      chunk.id,
      ...items.flatMap((item) => [...entryBulletIds(item)]),
    ]);
    const baseline =
      baselineOptimization?.additionalSections?.find(
        (candidate) => candidate.id === chunk.id,
      ) ?? null;
    const bulletCount = items.reduce((sum, item) => sum + item.bullets.length, 0);
    return {
      system: ADDITIONAL_PRESERVE_SYSTEM,
      user: `Section to rewrite:\n${JSON.stringify(section)}${context}${jobBlock}${gapsBlock}${keywordBudgetBlock({ resume, job, chunk, structureMode })}\n\nUser-locked ids in this section (return their text verbatim from the baseline):\n${JSON.stringify(lockedContentIds.filter((id) => ids.has(id)))}\n\nLocked wording baseline for this section:\n${JSON.stringify(baseline)}${feedbackBlock(feedback)}`,
      maxTokens: Math.min(4000, 200 + bulletCount * 180),
    };
  }

  const entry =
    chunk.kind === "role"
      ? resume.experience.find((role) => role.id === chunk.id)
      : (resume.projects ?? []).find((project) => project.id === chunk.id);
  const bullets = entry?.bullets ?? [];
  const ids = entry ? entryBulletIds(entry) : new Set([chunk.id]);
  const baseline =
    (chunk.kind === "role"
      ? baselineOptimization?.roles
      : baselineOptimization?.projects
    )?.find((candidate) => candidate.id === chunk.id) ?? null;
  const label = chunk.kind === "role" ? "work role" : "project";
  return {
    system: preserve ? ENTRY_PRESERVE_SYSTEM : ENTRY_OPTIMIZE_SYSTEM,
    user: `Entry to rewrite (${label}):\n${JSON.stringify(entry)}${context}${jobBlock}${gapsBlock}${keywordBudgetBlock({ resume, job, chunk, structureMode })}\n\nUser-locked ids in this entry (return their text verbatim from the baseline):\n${JSON.stringify(lockedContentIds.filter((id) => ids.has(id)))}\n\nLocked wording baseline for this entry:\n${JSON.stringify(baseline)}${feedbackBlock(feedback)}`,
    maxTokens: Math.min(
      4500,
      preserve ? 200 + bullets.length * 180 : 320 + bullets.length * 240,
    ),
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * Reassemble chunk responses into the whole-document shape
 * `normalizeOptimization` expects. Entry ids come from the source resume, not
 * from the model, so the structure checks only ever see the real ids.
 */
export function assembleOptimization(
  resume: Resume,
  structureMode: ContentStructureMode,
  results: ReadonlyMap<string, unknown>,
): Record<string, unknown> {
  const entry = (kind: "role" | "project", id: string) => {
    const item = record(results.get(chunkKey({ kind, id })));
    return { id, bullets: Array.isArray(item.bullets) ? item.bullets : [] };
  };
  const additionalSections =
    structureMode === "preserve"
      ? (resume.additionalSections ?? []).map((section) => {
          const raw = record(results.get(chunkKey({ kind: "additional", id: section.id })));
          const rawItems = Array.isArray(raw.items) ? raw.items.map(record) : [];
          return {
            id: section.id,
            items: section.items.map((item) => {
              const match = rawItems.find((candidate) => candidate.id === item.id);
              return {
                id: item.id,
                bullets: match && Array.isArray(match.bullets) ? match.bullets : [],
              };
            }),
          };
        })
      : [];
  const global = record(results.get("global"));
  return {
    summary: global.summary,
    title: global.title,
    skills: global.skills,
    skillEvidence: global.skillEvidence,
    sectionOrder: global.sectionOrder,
    sectionLabels: global.sectionLabels,
    roles: resume.experience.map((role) => entry("role", role.id)),
    projects: (resume.projects ?? []).map((project) => entry("project", project.id)),
    additionalSections,
  };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Route each validation issue to the chunk that has to be regenerated. Issues
 * name the entry or bullet they concern; anything about the summary, title,
 * skills, or section structure belongs to the global chunk.
 */
export function chunksForIssues({
  resume,
  candidate,
  issues,
  chunks,
}: {
  resume: Resume;
  candidate: Optimization;
  issues: string[];
  chunks: RewriteChunk[];
}): Map<string, string[]> {
  const keyOf = new Map(chunks.map((chunk) => [chunkKey(chunk), chunk]));
  const idToChunk = new Map<string, string>();
  const claim = (key: string, ids: string[]) => {
    if (!keyOf.has(key)) return;
    for (const id of ids) if (id) idToChunk.set(id, key);
  };
  for (const role of resume.experience) {
    claim(chunkKey({ kind: "role", id: role.id }), [
      role.id,
      ...role.bullets.map((bullet) => bullet.id),
      ...(role.teams ?? []).map((team) => team.id),
    ]);
  }
  for (const project of resume.projects ?? []) {
    claim(chunkKey({ kind: "project", id: project.id }), [
      project.id,
      ...project.bullets.map((bullet) => bullet.id),
    ]);
  }
  for (const section of resume.additionalSections ?? []) {
    claim(chunkKey({ kind: "additional", id: section.id }), [
      section.id,
      ...section.items.flatMap((item) => [item.id, ...item.bullets.map((b) => b.id)]),
    ]);
  }
  const matchers = [...idToChunk.entries()].map(([id, key]) => ({
    key,
    pattern: new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(id)}(?![A-Za-z0-9_-])`),
  }));
  const entryKeys = chunks.filter((chunk) => chunk.kind !== "global").map(chunkKey);
  const candidateText = new Map<string, string>([
    ...candidate.roles.map(
      (role) =>
        [chunkKey({ kind: "role", id: role.id }), role.bullets.map((b) => b.text).join("\n")] as const,
    ),
    ...(candidate.projects ?? []).map(
      (project) =>
        [chunkKey({ kind: "project", id: project.id }), project.bullets.map((b) => b.text).join("\n")] as const,
    ),
    ...(candidate.additionalSections ?? []).map(
      (section) =>
        [
          chunkKey({ kind: "additional", id: section.id }),
          section.items.flatMap((item) => item.bullets.map((b) => b.text)).join("\n"),
        ] as const,
    ),
  ]);

  const routed = new Map<string, string[]>();
  const add = (key: string, issue: string) => {
    if (!keyOf.has(key)) return;
    const list = routed.get(key) ?? [];
    list.push(issue);
    routed.set(key, list);
  };
  for (const issue of issues) {
    const targets = new Set(
      matchers.filter(({ pattern }) => pattern.test(issue)).map(({ key }) => key),
    );
    if (targets.size > 0) {
      for (const key of targets) add(key, issue);
      continue;
    }
    const keyword = issue.match(/^keyword "([^"]+)"/i)?.[1]?.toLocaleLowerCase();
    if (keyword) {
      const holders = entryKeys.filter((key) =>
        (candidateText.get(key) ?? "").toLocaleLowerCase().includes(keyword),
      );
      for (const key of holders) add(key, issue);
      if (
        holders.length === 0 ||
        `${candidate.summary} ${candidate.title} ${candidate.skills.join(" ")}`
          .toLocaleLowerCase()
          .includes(keyword)
      ) {
        add("global", issue);
      }
      continue;
    }
    if (/\bbullet\b/i.test(issue) && !/summary|title|skill/i.test(issue)) {
      for (const key of entryKeys) add(key, issue);
      continue;
    }
    add("global", issue);
  }
  return routed;
}

/** Run `work` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
