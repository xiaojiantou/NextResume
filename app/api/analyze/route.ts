import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import type { AtsReport, JobAnalysis, Resume } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are an ATS (applicant tracking system) scoring engine. Given a parsed resume and a parsed job description, output a calibrated ATS compatibility report as JSON:

{
  "overallBefore": number,        // 0-100, current resume vs THIS job
  "overallAfter": number,         // 0-100, projected after optimization. Should be 85-97 unless resume is fundamentally wrong domain
  "categoriesBefore": [
    { "label": string, "score": number, "detail": string }
  ],                              // EXACTLY these 5 labels in order: "Keyword match", "Quantified impact", "Role alignment", "ATS formatting", "Action verbs"
  "categoriesAfter": [            // same 5 labels, projected
    { "label": string, "score": number, "detail": string }
  ],
  "missingKeywords": string[],    // JD keywords not present in resume. 5-10 items
  "presentKeywords": string[]     // JD keywords already present. 3-8 items
}

Scoring rubric:
- "Keyword match": % of required JD keywords surfaced in resume text.
- "Quantified impact": share of bullets with measurable numbers / outcomes.
- "Role alignment": how well current titles + summary map to target role.
- "ATS formatting": parseability of structure. Most modern resumes score 80+.
- "Action verbs": share of bullets starting with strong ownership verbs ("Led", "Built", "Shipped") vs weak ("Worked on", "Helped").

Rules:
- Be honest. If a resume is weak for the role, before-scores should be low (30-60s).
- After-scores should reflect what's achievable by a careful rewrite of the SAME experience — don't assume new experience.
- "detail" is one sentence, specific and actionable.`;

export async function POST(req: NextRequest) {
  try {
    const { resume, job } = (await req.json()) as {
      resume: Resume;
      job: JobAnalysis;
    };

    const report = await jsonCompletion<AtsReport>({
      system: SYSTEM,
      user: `Resume JSON:\n${JSON.stringify(resume)}\n\nJob analysis JSON:\n${JSON.stringify(job)}`,
      maxTokens: 2000,
    });

    return NextResponse.json({ report });
  } catch (e) {
    console.error("analyze failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analyze failed" },
      { status: 500 },
    );
  }
}
