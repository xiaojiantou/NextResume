import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import type { JobAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You analyze a job description and extract structured signals. Output ONLY valid JSON matching this schema:

{
  "title": string,
  "company": string,             // "" if not stated
  "seniority": string,           // e.g. "Senior", "Staff", "Mid", "Entry"
  "requiredKeywords": string[],  // hard requirements (skills, tools, years, methodologies). 6-15 items
  "niceToHaveKeywords": string[],// nice-to-haves. 3-8 items
  "responsibilities": string[]   // 4-8 short verbs-first phrases of what the role does
}

Rules:
- Keywords must be the actual term as a recruiter/ATS would scan for it (e.g. "TypeScript", "Next.js", "5+ years", "serverless").
- No duplicates across required vs niceToHave.
- "title" = the role title only, no company or location.`;

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || text.length < 50) {
      return NextResponse.json(
        { error: "Job description too short" },
        { status: 400 },
      );
    }

    const analysis = await jsonCompletion<JobAnalysis>({
      system: SYSTEM,
      user: `Job description:\n\n${text.slice(0, 8000)}`,
      maxTokens: 1500,
    });

    return NextResponse.json({ analysis });
  } catch (e) {
    console.error("parse-job failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Parse failed" },
      { status: 500 },
    );
  }
}
