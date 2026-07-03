import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import type {
  AtsReport,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  Resume,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

const FULL_SYSTEM = `You rewrite a resume to be tailored to a specific job description. This is the most important rule:

EVERY rewritten bullet MUST be grounded in the candidate's ACTUAL experience. You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. If you tighten or reframe a bullet, you must cite the original bullet IDs (from the input resume) that justify the rewrite.

Output ONLY valid JSON matching this schema:

{
  "summary": string,
  "title": string,
  "skills": string[],
  "roles": [
    {
      "id": string,
      "bullets": [
        {
          "id": string,
          "text": string,
          "evidence": string[],
          "matchedKeywords": string[],
          "rationale": string
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
- You may insert a quantified estimate ONLY if the original bullet suggested impact. Otherwise stay qualitative.
- Use verbs from this set first: Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered.
- Skills must include items that map to JD requirements AND are credible given the experience.`;

const PREVIEW_SYSTEM = `You rewrite a SINGLE resume bullet to be tailored to a specific job description. The bullet you are rewriting is the candidate's weakest one for this role — show them how a strong rewrite would look.

You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. You may use quantified estimates ONLY if the original bullet suggested impact.

Output ONLY valid JSON:

{
  "id": "preview",
  "text": string,             // the rewritten bullet
  "evidence": string[],       // ORIGINAL bullet ids that ground this rewrite (must include the target bullet id)
  "matchedKeywords": string[],// JD keywords now satisfied (2-4)
  "rationale": string         // 1 sentence on WHY this rewrite is stronger
}

Start with a strong ownership verb (Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered).`;

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
  for (const role of resume.experience) {
    for (const b of role.bullets) {
      const lower = b.text.toLowerCase();
      if (weakStarts.some((w) => lower.startsWith(w))) {
        return { bulletId: b.id, bulletText: b.text };
      }
    }
  }
  // Fallback: shortest bullet (least quantified)
  const all = resume.experience.flatMap((r) => r.bullets);
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
    };

    const { resume, job, report, mode = "full", model } = body;

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

    const opt = await jsonCompletion<Optimization>({
      system: FULL_SYSTEM,
      user: `Original resume:\n${JSON.stringify(resume)}\n\nJob analysis:\n${JSON.stringify(job)}\n\nATS report (gaps to close):\n${JSON.stringify(report)}`,
      model,
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
