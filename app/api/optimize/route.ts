// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import { requirePaidOrder } from "@/lib/entitlement";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";

import type {
  AtsReport,
  ContentStructureMode,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  Resume,
} from "@/lib/types";
import { CONTENT_WRITING_STANDARD } from "@/lib/contentQuality";
import { runOptimizationHarness } from "@/lib/optimizationHarness";
import { reviewSemanticGrounding } from "@/lib/semanticResumeValidation";

export const runtime = "nodejs";
export const maxDuration = 300;

const PREVIEW_SYSTEM = `You rewrite a SINGLE resume bullet to be tailored to a specific job description. The bullet you are rewriting is the candidate's weakest one for this role — show them how a strong rewrite would look.

You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. Never introduce an estimate or number absent from the original bullet.

Output ONLY valid JSON:

{
  "id": "preview",
  "text": string,             // the rewritten bullet
  "evidence": string[],       // ORIGINAL bullet ids that ground this rewrite (must include the target bullet id)
  "matchedKeywords": string[],// JD keywords actually supported (0-4)
  "rationale": string         // 1 sentence on WHY this rewrite is stronger
}

${CONTENT_WRITING_STANDARD}
Start with an accurate action verb supported by the source. Weave keywords into the factual claim itself — NEVER append meta-commentary like "showcasing proficiency in X" or "demonstrating expertise in Y". End with a concrete supported fact; an outcome is optional when the source has none.`;

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
    const density = issue.match(/^keyword "([^"]+)": repeated (\d+) times \(the source resume has (\d+)\).*\(max (\d+)\)/i);
    if (density) {
      return `"${density[1]}" appears ${density[2]} times in the rewrite versus ${density[3]} in the source (allowed: ${density[4]}).`;
    }
    return "A rewrite exceeded the keyword repetition limit.";
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

    const result = await runOptimizationHarness({ resume, job, report, model, structureMode, lockedContentIds, baselineOptimization }, {
      complete: args => jsonCompletion({ ...args, model }),
      reviewGrounding: reviewSemanticGrounding,
    });
    if (result.ok) return NextResponse.json({ optimization: result.optimization });
    return NextResponse.json({ error: result.error, issues: [...new Set(result.issues.map(publicOptimizationIssue))].slice(0, 12), harness: result.trace }, { status: result.status });

  } catch (e) {
    console.error("optimize failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Optimize failed" },
      { status: 500 },
    );
  }
}
