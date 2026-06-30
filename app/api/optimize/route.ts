import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import type {
  AtsReport,
  JobAnalysis,
  Optimization,
  Resume,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM = `You rewrite a resume to be tailored to a specific job description. This is the most important rule:

EVERY rewritten bullet MUST be grounded in the candidate's ACTUAL experience. You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. If you tighten or reframe a bullet, you must cite the original bullet IDs (from the input resume) that justify the rewrite.

Output ONLY valid JSON matching this schema:

{
  "summary": string,            // 1-3 sentence professional summary tailored to the JD
  "title": string,              // headline title to display under the name, aligned to JD seniority and role
  "skills": string[],           // 8-12 skills reflecting actual experience + JD priorities
  "roles": [
    {
      "id": string,             // MUST match an original role id from the resume input ("r1","r2"...)
      "bullets": [
        {
          "id": string,         // new ID like "o1","o2"... unique across whole output
          "text": string,       // rewritten bullet, ownership-first verb, includes quantified outcome when justifiable
          "evidence": string[], // ORIGINAL bullet ids ("b1","b2"...) from the input resume that ground this rewrite. NEVER empty.
          "matchedKeywords": string[], // JD keywords this bullet now satisfies (2-4)
          "rationale": string   // 1 sentence on WHY this rewrite is stronger for THIS JD
        }
      ]
    }
  ]
}

Hard rules:
- Preserve every original role. Output the same number of roles, each by id.
- Output 2-5 optimized bullets per role.
- "evidence" array must reference REAL bullet IDs from the input resume. Never invent ids.
- If a bullet merges 2 original bullets, list both ids in evidence.
- You may insert a quantified estimate ONLY if the original bullet suggested impact ("improved performance" → "cut TTI 30%" is OK as a directional estimate). Otherwise stay qualitative.
- Use verbs from this set first: Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered.
- Skills must include items that map to JD requirements AND are credible given the experience.`;

export async function POST(req: NextRequest) {
  try {
    const { resume, job, report } = (await req.json()) as {
      resume: Resume;
      job: JobAnalysis;
      report: AtsReport;
    };

    const opt = await jsonCompletion<Optimization>({
      system: SYSTEM,
      user: `Original resume:\n${JSON.stringify(resume)}\n\nJob analysis:\n${JSON.stringify(job)}\n\nATS report (gaps to close):\n${JSON.stringify(report)}`,
      maxTokens: 6000,
    });

    return NextResponse.json({ optimization: opt });
  } catch (e) {
    console.error("optimize failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Optimize failed" },
      { status: 500 },
    );
  }
}
