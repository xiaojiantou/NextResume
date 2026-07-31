// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import { MAX_KEYWORD_REPEATS, detectStuffing, resumeToText } from "@/lib/atsScore";
import { applyOptimizationToResume } from "@/lib/applyOptimization";
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

EVERY rewritten bullet MUST be grounded in the candidate's ACTUAL experience. You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. Every rewrite cites the original bullet ID (from the input resume) that justifies it.

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
          "rationale": string,
          "relevance": number,
          "suggestion": "keep" | "trim" | "cut"
        }
      ]
    }
  ],
  "projects": [
    {
      "id": string,
      "bullets": [
        // same bullet shape as roles
      ]
    }
  ]
}

Hard rules — content preservation:
- Rewrite bullets ONE-TO-ONE. Every role and every project from the input appears in the output with the SAME id and the SAME number of bullets, and each output bullet reuses the id of the input bullet it rewrites. NEVER merge, drop, or add bullets. The user decides what to cut, not you.
- Instead of cutting, advise: set "relevance" (0-100, how much this bullet supports THIS job description) and "suggestion" ("keep" for strong matches, "trim" if it could be shortened, "cut" only if it is irrelevant to this job). "rationale" is 1 sentence explaining the rewrite or the cut advice.
- "evidence" must reference REAL bullet IDs from the input resume. Never invent ids.

Hard rules — factual integrity:
- A metric (number, percentage, dollar amount, latency) must stay attached to the exact action that produced it in the original bullet. Never move a metric onto a different action, tool, or system than the original credits.
- You may insert a quantified estimate ONLY if the original bullet suggested impact. Otherwise stay qualitative.

Hard rules — writing style:
- Weave matched keywords into the factual claim itself — the tool used, the method applied, the thing built. NEVER append meta-commentary clauses such as "showcasing proficiency in X", "demonstrating expertise in Y", "highlighting Z", "proving ability to W". A bullet ends with a concrete outcome or fact, never with a comment about the candidate's skills.
- Start bullets with verbs from this set first: Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered. Vary sentence structure across bullets.

Hard rules — skills and summary:
- "skills" must contain EVERY skill from the input resume, reordered so the ones matching the JD come first. You may add a skill ONLY if the resume bullets clearly demonstrate it. Never drop a real skill, never invent one.
- "summary": if the input resume has a summary, tailor it; if it has none, write a tight 2-3 line one grounded only in real experience.`;

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

Start with a strong ownership verb (Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered). Weave keywords into the factual claim itself — NEVER append meta-commentary like "showcasing proficiency in X" or "demonstrating expertise in Y". End with a concrete outcome, not a comment about the candidate's skills.`;

// The meta-commentary tails weak models bolt on to satisfy matchedKeywords
// ("..., showcasing proficiency in React"). Gerund-after-comma is the
// signature; leading verbs like "Demonstrated X to stakeholders" stay legal.
const SLOP_PATTERN =
  /[,;–—]\s*(showcasing|demonstrating|highlighting|proving|underscoring|exemplifying|evidencing)\b|\b(showcasing|demonstrating)\s+(expertise|proficiency|strong|robust|deep)\b/i;

function validateOptimization(
  resume: Resume,
  opt: Optimization,
  job?: JobAnalysis,
): string[] {
  const problems: string[] = [];

  const checkSection = (
    label: "roles" | "projects",
    originals: { id: string; bullets: { id: string }[] }[],
    optimized: { id: string; bullets: OptimizedBullet[] }[],
  ) => {
    for (const original of originals) {
      const match = optimized.find((o) => o.id === original.id);
      if (!match) {
        problems.push(`${label}: missing entry "${original.id}"`);
        continue;
      }
      if (match.bullets.length !== original.bullets.length) {
        problems.push(
          `${label} "${original.id}": expected ${original.bullets.length} bullets (one-to-one rewrite), got ${match.bullets.length}`,
        );
      }
      const originalIds = new Set(original.bullets.map((b) => b.id));
      for (const bullet of match.bullets) {
        if (!originalIds.has(bullet.id)) {
          problems.push(
            `${label} "${original.id}": bullet id "${bullet.id}" does not exist in the input resume`,
          );
        }
      }
    }
  };

  checkSection("roles", resume.experience, opt.roles);
  checkSection("projects", resume.projects ?? [], opt.projects ?? []);

  const allBullets = [
    ...opt.roles.flatMap((r) => r.bullets),
    ...(opt.projects ?? []).flatMap((p) => p.bullets),
  ];
  for (const bullet of allBullets) {
    if (SLOP_PATTERN.test(bullet.text)) {
      problems.push(
        `bullet "${bullet.id}": remove the meta-commentary tail ("showcasing/demonstrating...") and weave the keyword into the factual claim instead`,
      );
    }
  }
  if (SLOP_PATTERN.test(opt.summary)) {
    problems.push(
      `summary: remove meta-commentary ("showcasing/demonstrating...")`,
    );
  }

  const originalSkills = new Set(
    resume.skills.map((s) => s.toLocaleLowerCase()),
  );
  const keptSkills = new Set(opt.skills.map((s) => s.toLocaleLowerCase()));
  const dropped = [...originalSkills].filter((s) => !keptSkills.has(s));
  if (dropped.length > 0) {
    problems.push(
      `skills: ${dropped.length} original skills were dropped (${dropped.slice(0, 5).join(", ")}...) — include every original skill, reordered by JD relevance`,
    );
  }

  // Chasing matchedKeywords pushes the model to repeat the same term in every
  // bullet. Scoring counts each keyword once, so that buys nothing, and
  // Workday's 2026 filter flags the density as manipulation. Catch it here so
  // the user never receives a resume that trips it.
  if (job) {
    const materialized = applyOptimizationToResume(resume, opt);
    const { worst } = detectStuffing(resumeToText(materialized), job);
    for (const { keyword, count } of worst) {
      problems.push(
        `keyword "${keyword}": repeated ${count} times — state it once or twice where it is load-bearing and rewrite the rest without it (max ${MAX_KEYWORD_REPEATS})`,
      );
    }
  }

  return problems;
}

// Structural problems (dropped bullets/roles/skills) make the result unusable;
// style problems (slop tails, keyword stuffing) are worth one retry but not a
// hard failure.
function isStructural(problem: string): boolean {
  return (
    !problem.startsWith("bullet ") &&
    !problem.startsWith("summary:") &&
    !problem.startsWith("keyword ")
  );
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

    const basePrompt = `Original resume:\n${JSON.stringify(resume)}\n\nJob analysis:\n${JSON.stringify(job)}\n\nATS report (gaps to close):\n${JSON.stringify(report)}`;

    let opt = await jsonCompletion<Optimization>({
      system: FULL_SYSTEM,
      user: basePrompt,
      model,
      maxTokens: 8000,
    });

    let problems = validateOptimization(resume, opt, job);
    if (problems.length > 0) {
      console.warn("optimize validation failed, retrying once", problems);
      opt = await jsonCompletion<Optimization>({
        system: FULL_SYSTEM,
        user: `${basePrompt}\n\nYour previous attempt violated these hard rules — fix ALL of them this time:\n- ${problems.join("\n- ")}`,
        model,
        maxTokens: 8000,
      });
      problems = validateOptimization(resume, opt, job);
    }

    const structural = problems.filter(isStructural);
    if (structural.length > 0) {
      console.error("optimize failed validation after retry", structural);
      return NextResponse.json(
        {
          error:
            "The model kept dropping content from your resume. Try again or pick a different model.",
        },
        { status: 502 },
      );
    }
    if (problems.length > 0) {
      // Style-only leftovers: deliver, but keep a trace for prompt tuning.
      console.warn("optimize style issues remain after retry", problems);
    }

    return NextResponse.json({ optimization: opt });
  } catch (e) {
    console.error("optimize failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Optimize failed" },
      { status: 500 },
    );
  }
}
