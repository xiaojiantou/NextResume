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
import { scoreResume } from "@/lib/atsScore";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import type { AtsCategory, AtsReport, JobAnalysis, Resume } from "@/lib/types";

export const runtime = "nodejs";

/**
 * What a careful rewrite of the SAME experience could reach. Deliberately
 * conservative: a rewrite can always fix the headline title and the verbs, but
 * it can only surface keywords and metrics the experience already supports, so
 * those gaps close partially at best.
 */
function projectAfter(categories: AtsCategory[]): {
  overallAfter: number;
  categoriesAfter: AtsCategory[];
} {
  const close = (score: number, share: number) =>
    Math.round(score + (100 - score) * share);

  const categoriesAfter = categories.map((c) => {
    switch (c.label) {
      case "Title match":
        // Always achievable: it is one line of text under the name.
        return { ...c, score: 100, detail: "Achievable by matching the headline to the posting's title." };
      case "Action verbs":
        return { ...c, score: Math.max(c.score, 90), detail: "Achievable by reopening each bullet with an ownership verb." };
      case "Keyword match":
        return { ...c, score: close(c.score, 0.4), detail: "Partly achievable — only keywords your experience already supports can be added." };
      case "Quantified impact":
        return { ...c, score: close(c.score, 0.3), detail: "Partly achievable — only metrics your experience already implies can be surfaced." };
      default:
        return c;
    }
  });

  const weightOf = (label: string) =>
    label === "Keyword match" ? 0.45
      : label === "Title match" ? 0.2
        : label === "Quantified impact" ? 0.15
          : label === "Action verbs" ? 0.12
            : 0.08;

  const overallAfter = Math.round(
    categoriesAfter.reduce((sum, c) => sum + c.score * weightOf(c.label), 0),
  );

  return { overallAfter, categoriesAfter };
}

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
    const { overallAfter, categoriesAfter } = projectAfter(scored.categories);

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
