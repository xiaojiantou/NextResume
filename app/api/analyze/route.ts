// Copyright (c) 2026 HowBe LLC. All rights reserved.

// ATS scoring. Fully deterministic — no model call.
//
// This route used to ask an LLM for the whole report. The headline number it
// returned was not derived from the rubric it printed alongside it, so the same
// resume scored 72 or 78 across runs while the rubric categories stayed inside
// 83.6-86.0. A careful rewrite only moves an already-strong resume by ~2-3
// rubric points, which is smaller than that noise, so users saw "72 -> 72" and
// concluded the optimizer did nothing. See lib/atsScore.ts.
//
// The keyword extraction that genuinely needs a model already happened in
// /api/parse-job, which produced job.requiredKeywords. Scoring against that
// list is arithmetic, so this route is now instant and costs nothing to run.

import { NextRequest, NextResponse } from "next/server";
import { projectAfter } from "@/lib/atsProjection";
import { scoreResume } from "@/lib/atsScore";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import type { AtsReport, JobAnalysis, Resume } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.analyze);
  if (rl) return rl;
  try {
    const { resume, job } = (await req.json()) as {
      resume: Resume;
      job: JobAnalysis;
    };

    if (!resume || !job) {
      return NextResponse.json(
        { error: "Both a resume and a job analysis are required." },
        { status: 400 },
      );
    }

    const scored = scoreResume(resume, job);
    const { overallAfter, categoriesAfter } = projectAfter(
      scored.categories,
      resume,
      scored.overall,
    );

    const report: AtsReport = {
      overallBefore: scored.overall,
      overallAfter,
      categoriesBefore: scored.categories,
      categoriesAfter,
      missingKeywords: scored.missingKeywords,
      presentKeywords: scored.matchedKeywords,
      stuffingWarnings: scored.stuffing.warnings,
    };

    return NextResponse.json({ report });
  } catch (e) {
    console.error("analyze failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analyze failed" },
      { status: 500 },
    );
  }
}
