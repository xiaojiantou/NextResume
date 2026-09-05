// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import {
  assembleOptimization,
  buildChunkPrompt,
  chunkKey,
  chunksForIssues,
  mapWithConcurrency,
  planRewriteChunks,
} from "@/lib/optimizeChunks";
import {
  normalizeOptimization,
  validateOptimization,
} from "@/lib/optimizeContract";
import { requirePaidOrder } from "@/lib/entitlement";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";

import {
  calculateOptimizationAtsScore,
  constrainPreservedOptimization,
  constrainRoleOptimizedStructure,
  createStructureIntegrity,
  enforceLockedOptimization,
  reconcileGroundedSkills,
  validateGroundedOptimization,
  validateLockedOptimization,
  validatePreservedOptimization,
} from "@/lib/resumeStructure";
import type {
  AtsReport,
  ContentStructureMode,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  Resume,
} from "@/lib/types";
import { reviewSemanticGrounding } from "@/lib/semanticResumeValidation";

export const runtime = "nodejs";
export const maxDuration = 300;

// The rewrite runs as one small completion per resume entry, in parallel
// (see lib/optimizeChunks.ts), so a round is bounded by the slowest entry
// rather than the whole document. The loop is still budgeted below Vercel's
// maxDuration: a platform FUNCTION_INVOCATION_TIMEOUT answers with an HTML 504
// the client cannot parse, so leave headroom to serialize a real JSON error.
const TOTAL_BUDGET_MS = 270_000;
const CHUNK_TIMEOUT_MS = 75_000;
const CHUNK_CONCURRENCY = 5;
// Below this there is no point starting another round; report instead.
const MIN_ATTEMPT_MS = 20_000;

const PREVIEW_SYSTEM = `You rewrite a SINGLE resume bullet to be tailored to a specific job description. The bullet you are rewriting is the candidate's weakest one for this role — show them how a strong rewrite would look.

You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. Never introduce an estimate or number absent from the original bullet.

Output ONLY valid JSON:

{
  "id": "preview",
  "text": string,             // the rewritten bullet
  "evidence": string[],       // ORIGINAL bullet ids that ground this rewrite (must include the target bullet id)
  "matchedKeywords": string[],// JD keywords now satisfied (2-4)
  "rationale": string         // 1 sentence on WHY this rewrite is stronger
}

Start with a strong ownership verb (Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered). Weave keywords into the factual claim itself — NEVER append meta-commentary like "showcasing proficiency in X" or "demonstrating expertise in Y". End with a concrete outcome, not a comment about the candidate's skills.`;

function publicOptimizationIssue(issue: string): string {
  const skill = issue.match(/^Skill "([^"]+)"/i)?.[1];
  if (skill) {
    return `The proposed skill "${skill}" was not sufficiently supported by the uploaded resume.`;
  }
  if (/unsupported number/i.test(issue)) {
    return "A rewrite introduced a number that was not supported by its source evidence.";
  }
  if (/locked/i.test(issue)) {
    return "A manually edited field changed, so the rewrite was rejected.";
  }
  if (/^keyword /i.test(issue)) {
    return "A rewrite repeated a keyword too many times, which trips ATS keyword-stuffing filters.";
  }
  if (/role|project|bullet|evidence/i.test(issue)) {
    return "A rewritten achievement could not be matched safely to its original entry.";
  }
  if (/structure|section|entry|skills must/i.test(issue)) {
    return "The rewrite changed a protected part of the resume structure.";
  }
  return "Part of the rewrite did not pass the factual safety checks.";
}

function pickWeakestBullet(resume: Resume): {
  bulletId: string;
  bulletText: string;
} | null {
  const weakStarts = [
    "worked on",
    "helped",
    "assisted",
    "responsible for",
    "involved in",
    "participated",
  ];
  for (const section of [...resume.experience, ...(resume.projects ?? [])]) {
    for (const b of section.bullets) {
      const lower = b.text.toLowerCase();
      if (weakStarts.some((w) => lower.startsWith(w))) {
        return { bulletId: b.id, bulletText: b.text };
      }
    }
  }
  // Fallback: shortest bullet (least quantified)
  const all = [...resume.experience, ...(resume.projects ?? [])].flatMap(
    (r) => r.bullets,
  );
  if (all.length === 0) return null;
  const shortest = all.reduce((a, b) =>
    a.text.length <= b.text.length ? a : b,
  );
  return { bulletId: shortest.id, bulletText: shortest.text };
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.optimize);
  if (rl) return rl;
  try {
    const body = (await req.json()) as {
      resume: Resume;
      job: JobAnalysis;
      report: AtsReport;
      mode?: "full" | "preview";
      model?: string;
      structureMode?: ContentStructureMode;
      lockedContentIds?: string[];
      baselineOptimization?: Optimization | null;
    };

    const {
      resume,
      job,
      report,
      mode = "full",
      model,
      structureMode = "optimize",
      lockedContentIds = [],
      baselineOptimization = null,
    } = body;

    if (!resume || !job || !report) {
      return NextResponse.json(
        { error: "Resume, job analysis, and ATS report are required." },
        { status: 400 },
      );
    }
    if (structureMode !== "optimize" && structureMode !== "preserve") {
      return NextResponse.json(
        { error: "Unknown content structure mode." },
        { status: 400 },
      );
    }
    // "preview" rewrites a single bullet as the free teaser on /analysis;
    // everything else is the deliverable the buyer paid for.
    if (mode !== "preview") {
      const entitlement = await requirePaidOrder(req);
      if (!entitlement.ok) return entitlement.response;
    }

    if (mode === "preview") {
      const target = pickWeakestBullet(resume);

      if (!target) {
        return NextResponse.json(
          { error: "No bullets to preview" },
          { status: 400 },
        );
      }

      const preview = await jsonCompletion<OptimizedBullet>({
        system: PREVIEW_SYSTEM,
        user: `Target bullet to rewrite (id=${target.bulletId}): "${target.bulletText}"\n\nFull original resume (for context):\n${JSON.stringify(resume)}\n\nJob analysis:\n${JSON.stringify(job)}\n\nATS gaps:\n${JSON.stringify({ missingKeywords: report.missingKeywords })}`,
        model,
        maxTokens: 600,
      });

      return NextResponse.json({
        preview,
        targetBulletId: target.bulletId,
        targetBulletText: target.bulletText,
      });
    }

    const chunks = planRewriteChunks(resume, structureMode);
    const results = new Map<string, unknown>();
    let pending = chunks;
    let feedbackByChunk = new Map<string, string[]>();
    let lastIssues: string[] = [];
    let ranOutOfTime = false;
    const attempts = 3;
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const budgetLeft = deadline - Date.now();
      if (budgetLeft < MIN_ATTEMPT_MS) {
        ranOutOfTime = true;
        break;
      }
      const controller = new AbortController();
      const attemptTimer = setTimeout(
        () => controller.abort(),
        Math.min(budgetLeft, CHUNK_TIMEOUT_MS),
      );
      const startedAt = Date.now();
      try {
        await mapWithConcurrency(pending, CHUNK_CONCURRENCY, async (chunk) => {
          const prompt = buildChunkPrompt({
            chunk,
            resume,
            job,
            report,
            structureMode,
            lockedContentIds,
            baselineOptimization,
            feedback: feedbackByChunk.get(chunkKey(chunk)) ?? [],
          });
          const raw = await jsonCompletion<unknown>({
            ...prompt,
            model,
            signal: controller.signal,
          });
          results.set(chunkKey(chunk), raw);
        });
      } catch (attemptFailure) {
        // A retry of a round that already blew the per-round ceiling just
        // burns the rest of the budget, so stop and say so.
        if (controller.signal.aborted) {
          ranOutOfTime = true;
          break;
        }
        throw attemptFailure;
      } finally {
        clearTimeout(attemptTimer);
      }
      console.info(
        `optimize round ${attempt}: ${pending.length} chunk(s) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (${structureMode}, model=${model ?? "default"})`,
      );
      const normalized = normalizeOptimization(
        assembleOptimization(resume, structureMode, results),
      );
      if (structureMode === "optimize") {
        const grounded = reconcileGroundedSkills(
          resume,
          normalized.skills,
          normalized.skillEvidence,
        );
        normalized.skills = grounded.skills;
        normalized.skillEvidence = grounded.skillEvidence;
      }
      const structured =
        structureMode === "preserve"
          ? constrainPreservedOptimization({
              resume,
              candidate: normalized,
              baseline: baselineOptimization,
              lockedContentIds,
            })
          : constrainRoleOptimizedStructure({ resume, candidate: normalized });
      const opt = enforceLockedOptimization({
        resume,
        candidate: structured,
        baseline: baselineOptimization,
        lockedContentIds,
      });
      const issues = [
        ...validateOptimization(resume, opt, job),
        ...validateGroundedOptimization(resume, opt),
        ...(structureMode === "preserve"
          ? validatePreservedOptimization(resume, opt)
          : []),
        ...validateLockedOptimization({
          resume,
          candidate: opt,
          baseline: baselineOptimization,
          lockedContentIds,
        }),
      ];
      if (issues.length === 0) {
        issues.push(
          ...(await reviewSemanticGrounding({
            resume,
            candidate: opt,
            model,
          })),
        );
      }
      if (issues.length > 0) {
        lastIssues = issues;
        feedbackByChunk = chunksForIssues({
          resume,
          candidate: opt,
          issues,
          chunks,
        });
        pending = chunks.filter((chunk) =>
          feedbackByChunk.has(chunkKey(chunk)),
        );
        if (pending.length === 0) pending = chunks;
        continue;
      }
      opt.structureMode = structureMode;
      opt.structureIntegrity = createStructureIntegrity(
        resume,
        opt,
        structureMode,
      );
      opt.atsScore = calculateOptimizationAtsScore({ resume, optimization: opt, job });
      return NextResponse.json({ optimization: opt });
    }

    // Concrete safety issues beat a generic timeout notice: if we collected
    // any, the user gets something actionable even though we stopped early.
    if (lastIssues.length > 0) {
      console.error(
        `optimize exhausted attempts (${structureMode}, model=${model ?? "default"})`,
        lastIssues.slice(0, 20),
      );
    }

    if (ranOutOfTime && lastIssues.length === 0) {
      return NextResponse.json(
        {
          error:
            "The model took too long to rewrite this resume. Nothing was changed — retry, or pick a faster model.",
          code: "model_timeout",
        },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        error:
          structureMode === "preserve"
            ? "The rewrite could not pass the factual safety checks while keeping the original structure."
            : "The rewrite could not pass the factual safety checks.",
        issues: [...new Set(lastIssues.map(publicOptimizationIssue))].slice(
          0,
          12,
        ),
      },
      { status: 422 },
    );
  } catch (e) {
    console.error("optimize failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Optimize failed" },
      { status: 500 },
    );
  }
}
