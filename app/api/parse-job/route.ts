// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import { sanitizeJobKeywords } from "@/lib/jobKeywords";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import type { JobAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You analyze a job description and extract structured signals. Output ONLY valid JSON matching this schema:

{
  "title": string,
  "company": string,             // "" if not stated
  "seniority": string,           // e.g. "Senior", "Staff", "Mid", "Entry"
  "requiredKeywords": string[],  // hard requirements. Up to 15
  "niceToHaveKeywords": string[],// nice-to-haves. Up to 8
  "responsibilities": string[]   // 4-8 short verbs-first phrases of what the role does
}

What counts as a keyword:
A keyword names a technology, language, framework, tool, platform, technique, or
domain skill — something a candidate could list verbatim under "Skills" and a
recruiter could type into a candidate search box. Examples: "TypeScript",
"Next.js", "Generative AI", "PyTorch", "Kubernetes", "A/B testing", "serverless".

NEVER emit as a keyword:
- The posting's own section labels. Job descriptions bold headings like
  "Data Analysis:", "Testing and Validation:", "Documentation:",
  "Collaboration:", "Continuous Improvement:" and then describe the work
  underneath. Extract the technologies named in the description, never the label.
- Soft skills and work habits: communication, teamwork, attention to detail,
  problem solving, curiosity, ownership, cross-functional collaboration.
- Eligibility and logistics: degree requirements, GPA thresholds, semester
  hours, work authorization, hours per week, travel, compensation.
- Generic activities with no tool attached: "documentation", "testing",
  "continuous improvement", "model performance".
- Company values, benefits, or mission statements.

Rules:
- Extract only what the posting actually names. A thin job description yields a
  short list — that is correct. NEVER pad the list to reach a count.
- Prefer the specific term over the umbrella when the posting gives both
  ("PyTorch" over "ML frameworks"), but keep umbrella terms recruiters really
  search for ("machine learning", "Generative AI").
- Write each keyword exactly as a recruiter would scan for it, not as a phrase
  lifted from a sentence.
- No duplicates across required vs niceToHave.
- "title" = the role title only, no company or location.`;

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.parseJob);
  if (rl) return rl;
  try {
    const { text, model } = await req.json();
    if (!text || text.length < 50) {
      return NextResponse.json(
        { error: "Job description too short" },
        { status: 400 },
      );
    }

    const analysis = await jsonCompletion<JobAnalysis>({
      system: SYSTEM,
      user: `Job description:\n\n${text.slice(0, 8000)}`,
      model,
      maxTokens: 1500,
    });

    // Belt and braces: scoring matches these strings literally, so a heading or
    // a GPA threshold that slips past the prompt becomes a guaranteed miss.
    // Passing the posting text lets the sanitizer identify section headings
    // from the source rather than guessing from a word list.
    return NextResponse.json({ analysis: sanitizeJobKeywords(analysis, text) });
  } catch (e) {
    console.error("parse-job failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Parse failed" },
      { status: 500 },
    );
  }
}
