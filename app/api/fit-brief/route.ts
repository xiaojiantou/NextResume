// Copyright (c) 2026 HowBe LLC. All rights reserved.

// The qualitative half of the analysis page. /api/analyze deliberately became
// deterministic arithmetic (see its header comment) — but a number can't tell
// the user what this employer is actually hiring for, or which story their
// resume should lead with. That reading is a judgment call, so it goes back to
// a model here, in a route whose output carries no score for noise to corrupt.

import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import type { FitBrief, JobAnalysis, Resume } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You are a blunt, senior career strategist reading a job posting against a candidate's real resume. Your job is to see what the employer is ACTUALLY hiring for beneath the posting's wording — which is often narrower or different from the title — and to say, conclusion first, how this candidate should position themselves.

Output ONLY valid JSON matching this schema:

{
  "verdict": "strong" | "good" | "stretch" | "weak",
  "headline": string,      // ONE sentence. The conclusion, stated flat out. e.g. "They are not hiring someone who trains models — they are hiring someone who ships AI products end to end, and that is the story this resume already supports."
  "whatTheyWant": string,  // 2-3 sentences: what the employer really needs, read between the lines of the JD. Name what the title obscures.
  "workflow": string[],    // The role's real day-to-day arc as 3-6 short verb-first steps, e.g. ["define the problem with the customer", "build the product", "wire in the AI", "deploy", "iterate in production"]
  "yourStory": string,     // 2-4 sentences: the single narrative this resume should lead with for THIS job, built from the candidate's strongest real experience.
  "strengths": [{ "point": string, "evidence": string }],  // 2-4 items. evidence must reference something concrete that is actually on the resume (a role, project, or bullet — paraphrase is fine, invention is not).
  "gaps": [{ "point": string, "mitigation": string }]      // 1-3 items. Real gaps, named honestly. mitigation = how the resume or interview can defuse it using what the candidate genuinely has. Never suggest fabricating experience.
}

Rules:
- Lead with judgment, not summary. The headline is a verdict a candidate could act on, never "this role involves X and you have some X".
- Ground every strength in the resume as given. If the resume doesn't support a claim, it is a gap, not a strength.
- Read the JD skeptically: titles inflate, requirement lists pad. Weight what the responsibilities and the company's situation imply they'll spend their days doing.
- "stretch" and "weak" are legitimate verdicts. A candid "this is a stretch, here is the one angle that works" is worth more than false encouragement.
- Write in plain, direct English. No filler, no "overall", no restating the schema.`;

/** Compact plain-text digest — enough signal to judge fit, small enough to keep the call cheap. */
function resumeDigest(resume: Resume): string {
  const lines: string[] = [];
  if (resume.title) lines.push(`Headline: ${resume.title}`);
  if (resume.summary) lines.push(`Summary: ${resume.summary}`);
  if (resume.skills.length) lines.push(`Skills: ${resume.skills.join(", ")}`);
  for (const role of resume.experience) {
    lines.push(
      `\n${role.title} — ${role.company} (${role.start}–${role.end})${role.techStack ? ` [${role.techStack}]` : ""}`,
    );
    for (const b of role.bullets) lines.push(`- ${b.text}`);
  }
  for (const project of resume.projects ?? []) {
    lines.push(`\nProject: ${project.name}${project.role ? ` — ${project.role}` : ""}`);
    for (const b of project.bullets) lines.push(`- ${b.text}`);
  }
  for (const edu of resume.education) {
    lines.push(`\nEducation: ${edu.degree}, ${edu.school} (${edu.year})`);
  }
  return lines.join("\n").slice(0, 9000);
}

const VERDICTS = new Set(["strong", "good", "stretch", "weak"]);

function sanitize(brief: FitBrief): FitBrief {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    verdict: VERDICTS.has(brief.verdict) ? brief.verdict : "good",
    headline: str(brief.headline),
    whatTheyWant: str(brief.whatTheyWant),
    workflow: (Array.isArray(brief.workflow) ? brief.workflow : [])
      .map(str)
      .filter(Boolean)
      .slice(0, 6),
    yourStory: str(brief.yourStory),
    strengths: (Array.isArray(brief.strengths) ? brief.strengths : [])
      .map((s) => ({ point: str(s?.point), evidence: str(s?.evidence) }))
      .filter((s) => s.point)
      .slice(0, 4),
    gaps: (Array.isArray(brief.gaps) ? brief.gaps : [])
      .map((g) => ({ point: str(g?.point), mitigation: str(g?.mitigation) }))
      .filter((g) => g.point)
      .slice(0, 3),
  };
}

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.fitBrief);
  if (rl) return rl;
  try {
    const { resume, job, jobDescription, model } = (await req.json()) as {
      resume: Resume;
      job: JobAnalysis;
      jobDescription?: string;
      model?: string;
    };

    if (!resume || !job) {
      return NextResponse.json(
        { error: "Both a resume and a job analysis are required." },
        { status: 400 },
      );
    }

    // The raw posting carries the between-the-lines signal the parsed keyword
    // list was built to discard, so prefer it when the client still has it.
    const jdText = (jobDescription || "").slice(0, 8000);
    const jobBlock = jdText
      ? `Job posting (verbatim):\n${jdText}`
      : `Parsed job signals:\nTitle: ${job.title}\nCompany: ${job.company}\nSeniority: ${job.seniority}\nMust-haves: ${job.requiredKeywords.join(", ")}\nNice-to-haves: ${job.niceToHaveKeywords.join(", ")}\nResponsibilities:\n${job.responsibilities.map((r) => `- ${r}`).join("\n")}`;

    const brief = await jsonCompletion<FitBrief>({
      system: SYSTEM,
      user: `${jobBlock}\n\n---\n\nCandidate resume:\n${resumeDigest(resume)}`,
      model,
      maxTokens: 1600,
    });

    return NextResponse.json({ brief: sanitize(brief) });
  } catch (e) {
    console.error("fit-brief failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fit brief failed" },
      { status: 500 },
    );
  }
}
