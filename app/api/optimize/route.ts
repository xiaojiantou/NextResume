// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import {
  normalizeOptimization,
  validateOptimization,
} from "@/lib/optimizeContract";
import { requirePaidOrder } from "@/lib/entitlement";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";

import {
  calculateOptimizationAtsScore,
  constrainPreservedOptimization,
  constrainRoleOptimizedStructure,
  createStructureIntegrity,
  enforceLockedOptimization,
  reconcileGroundedSkills,
  validateGroundedOptimization,
  validateLockedOptimization,
  validatePreservedOptimization,
} from "@/lib/resumeStructure";
import type {
  AtsReport,
  ContentStructureMode,
  JobAnalysis,
  Optimization,
  OptimizedBullet,
  Resume,
} from "@/lib/types";
import { reviewSemanticGrounding } from "@/lib/semanticResumeValidation";

export const runtime = "nodejs";
export const maxDuration = 300;

// A 7000-token rewrite on a slow model runs 60-90s, and we allow 3 correction
// rounds — 90s of platform budget guaranteed a FUNCTION_INVOCATION_TIMEOUT,
// which Vercel answers with an HTML 504 the client cannot parse. Budget the
// loop ourselves and leave headroom to serialize a real JSON error.
const TOTAL_BUDGET_MS = 270_000;
const ATTEMPT_TIMEOUT_MS = 110_000;
// Below this there is no point starting another generation; report instead.
const MIN_ATTEMPT_MS = 25_000;

const FULL_SYSTEM = `You rewrite a resume to be tailored to a specific job description. This is the most important rule:

EVERY rewritten bullet MUST be grounded in the candidate's ACTUAL experience. You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. Every rewrite cites the original bullet ID (from the input resume) that justifies it.

Output ONLY valid JSON matching this schema:

{
  "summary": string,
  "title": string,
  "skills": string[],
  "skillEvidence": [{
    // ONLY for a skill you are adding. See the skills rules below — a skill
    // copied from the input needs no entry. Usually this array is empty or
    // holds one or two items.
    "skill": string,
    "grounding": "indirect",
    "skillType": "capability" | "domain" | "soft",
    "evidence": string[],
    "rationale": string
  }],
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
  ],
  "sectionOrder": ["summary", "skills", "experience", "projects", "education", "additional:<source-section-id>"],
  "sectionLabels": {
    "summary": "Summary" | "Professional Summary" | "Research Profile",
    "skills": "Skills" | "Core Skills" | "Technical Skills" | "Core Competencies",
    "experience": "Experience" | "Professional Experience" | "Work Experience" | "Research Experience",
    "projects": "Projects" | "Selected Projects" | "Technical Projects" | "Research Projects",
    "education": "Education" | "Academic Background"
  }
}

Hard rules — content preservation:
- Rewrite bullets ONE-TO-ONE. Every role and every project from the input appears in the output with the SAME id and the SAME number of bullets, and each output bullet reuses the id of the input bullet it rewrites. NEVER merge, drop, or add bullets. The user decides what to cut, not you.
- Some input roles include "teams" that group achievements inside the same company. Treat team names as source context only. Do not output "teams"; return every team achievement as part of its parent role's flat "bullets" list using the same bullet id.
- Instead of cutting, advise: set "relevance" (0-100, how much this bullet supports THIS job description) and "suggestion" ("keep" for strong matches, "trim" if it could be shortened, "cut" only if it is irrelevant to this job). "rationale" is 1 sentence explaining the rewrite or the cut advice.
- "evidence" must reference REAL bullet IDs from the input resume. Never invent ids.

Hard rules — factual integrity:
- A metric (number, percentage, dollar amount, latency) must stay attached to the exact action that produced it in the original bullet. Never move a metric onto a different action, tool, or system than the original credits.
- NEVER introduce a number the cited evidence does not already contain — no estimates, no approximations, no rounding a figure the source never stated. If the original bullet has no metric, stay qualitative.
- Version and product names carry digits (S3, EC2, p99, GPT-4, OAuth 2.0). Use one only if that exact name appears in the bullet you are rewriting.

Hard rules — writing style:
- Weave matched keywords into the factual claim itself — the tool used, the method applied, the thing built. NEVER append meta-commentary clauses such as "showcasing proficiency in X", "demonstrating expertise in Y", "highlighting Z", "proving ability to W". A bullet ends with a concrete outcome or fact, never with a comment about the candidate's skills.
- Start bullets with verbs from this set first: Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered. Vary sentence structure across bullets.

Hard rules — keyword coverage:
- The ATS report lists missingKeywords. Walk that list. For each one, ask whether the resume ALREADY demonstrates the same thing under different wording — "K8s" for Kubernetes, "REST endpoints" for API development, "on-call" for production support. Where it does, say it in the posting's wording instead of the candidate's. That is a naming change, not a new claim, and it is where most of the real gain lives.
- Where the resume genuinely does not demonstrate a missing keyword, LEAVE IT OUT. An honest gap costs the candidate far less than a fabricated match. Do not pad the summary or skills with terms nothing in the experience supports.

Hard rules — headline, skills, and summary:
- "title" is the headline that sits under the candidate's name. It is the field recruiters filter an ATS on, so it must speak to THIS posting, not to the candidate's last job. Set it to the posting's exact job title when the candidate's experience supports that role. If the posting's seniority would overstate them, keep the posting's role words and drop only the level ("Senior Backend Platform Engineer" -> "Backend Platform Engineer"). Never claim a specialization the resume does not evidence, and never put a company name in it.
- "skills" must contain EVERY skill from the input resume, reordered so the ones matching the JD come first. You may add a skill ONLY if the resume bullets clearly demonstrate it. Never drop a real skill, never invent one.
- Return a skillEvidence entry ONLY for a skill you are ADDING — one whose words are not already in the input resume. A skill you copied from the input needs no entry: it is verified against the source text directly, and an entry for it is discarded unread. Most rewrites add nothing and return [].
- An added skill must be a "capability", "domain" or "soft" skill, must cite 1-3 real source bullet IDs in "evidence", and must explain the support in "rationale". A tool, framework, platform, credential or language can never be added — if the resume does not name it, it does not go in.
- "summary": if the input resume has a summary, tailor it; if it has none, write a tight 2-3 line one grounded only in real experience.

Hard rules — organization:
- sectionOrder must contain every non-empty source section exactly once. Reorder sections to lead with the strongest evidence for the target role. Use additional:<id> for every source additional section. The renderer maps supported source extras only into canonical Awards, Certifications, Publications, Languages, or Leadership & Volunteering sections; it never creates an ambiguous Additional Information section.
- Choose sectionLabels only from the exact allowed values in the schema. Use role-relevant conventional headings; do not invent headings.
- Reordering and relabeling never changes the factual owner of an entry or bullet.`;

const PRESERVE_SYSTEM = `You rewrite resume language for a target job while preserving the source content structure exactly.

Output ONLY valid JSON matching:
{
  "summary": string,
  "title": string,
  "skills": string[],
  "roles": [{
    "id": string,
    "bullets": [{
      "id": string,
      "text": string,
      "evidence": string[],
      "matchedKeywords": string[],
      "rationale": string
    }]
  }],
  "projects": [{
    "id": string,
    "bullets": [{
      "id": string,
      "text": string,
      "evidence": string[],
      "matchedKeywords": string[],
      "rationale": string
    }]
  }],
  "additionalSections": [{
    "id": string,
    "items": [{
      "id": string,
      "bullets": [{
        "id": string,
        "text": string,
        "evidence": string[],
        "matchedKeywords": string[],
        "rationale": string
      }]
    }]
  }]
}

Non-negotiable rules:
- Return every role, project, additional section, item, and bullet exactly once, in source order.
- Every output bullet id MUST equal its one source bullet id. Its evidence MUST be exactly [that same id]. Never merge, split, add, delete, or move bullets.
- Some input roles include "teams" that group achievements inside the same company. Treat team names as source context only. Do not output "teams"; return every team achievement as part of its parent role's flat "bullets" list using the same bullet id.
- Keep every source skill. You may reorder skills and normalize capitalization only. Never add or remove one.
- If the source summary or professional title is empty, keep it empty. If present, rewrite it without adding unsupported facts.
- Never alter or infer companies, schools, historical job titles, degrees, project names, dates, locations, awards, certificates, publications, organizations, metrics, tools, or results.
- Every number in a rewrite must already appear in that same source bullet.
- Use concise, natural English. Keep each bullet non-empty and improve relevance only within its own evidence.`;

const PREVIEW_SYSTEM = `You rewrite a SINGLE resume bullet to be tailored to a specific job description. The bullet you are rewriting is the candidate's weakest one for this role — show them how a strong rewrite would look.

You are forbidden from inventing skills, companies, technologies, metrics, or responsibilities the candidate did not demonstrate. Never introduce an estimate or number absent from the original bullet.

Output ONLY valid JSON:

{
  "id": "preview",
  "text": string,             // the rewritten bullet
  "evidence": string[],       // ORIGINAL bullet ids that ground this rewrite (must include the target bullet id)
  "matchedKeywords": string[],// JD keywords now satisfied (2-4)
  "rationale": string         // 1 sentence on WHY this rewrite is stronger
}

Start with a strong ownership verb (Led, Built, Shipped, Owned, Drove, Designed, Migrated, Architected, Mentored, Partnered). Weave keywords into the factual claim itself — NEVER append meta-commentary like "showcasing proficiency in X" or "demonstrating expertise in Y". End with a concrete outcome, not a comment about the candidate's skills.`;

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
    return "A rewrite repeated a keyword too many times, which trips ATS keyword-stuffing filters.";
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

    let feedback = "";
    let lastIssues: string[] = [];
    let ranOutOfTime = false;
    const attempts = 3;
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const budgetLeft = deadline - Date.now();
      if (budgetLeft < MIN_ATTEMPT_MS) {
        ranOutOfTime = true;
        break;
      }
      const controller = new AbortController();
      const attemptTimer = setTimeout(
        () => controller.abort(),
        Math.min(budgetLeft, ATTEMPT_TIMEOUT_MS),
      );
      let raw: unknown;
      try {
        raw = await jsonCompletion<unknown>({
          system:
            structureMode === "preserve" ? PRESERVE_SYSTEM : FULL_SYSTEM,
          user: `Original resume:\n${JSON.stringify(resume)}\n\nJob analysis:\n${JSON.stringify(job)}\n\nATS report (gaps to close):\n${JSON.stringify(report)}\n\nUser-locked content ids (return their text verbatim):\n${JSON.stringify(lockedContentIds)}\n\nLocked wording baseline:\n${JSON.stringify(baselineOptimization)}${
            feedback
              ? `\n\nYour previous response violated these constraints. Correct every issue without inventing or dropping source content:\n${feedback}`
              : ""
          }`,
          model,
          maxTokens: 7000,
          signal: controller.signal,
        });
      } catch (attemptFailure) {
        // A retry of a generation that already blew the per-attempt ceiling
        // just burns the rest of the budget, so stop and say so.
        if (controller.signal.aborted) {
          ranOutOfTime = true;
          break;
        }
        throw attemptFailure;
      } finally {
        clearTimeout(attemptTimer);
      }
      const normalized = normalizeOptimization(raw);
      if (structureMode === "optimize") {
        const grounded = reconcileGroundedSkills(
          resume,
          normalized.skills,
          normalized.skillEvidence,
        );
        normalized.skills = grounded.skills;
        normalized.skillEvidence = grounded.skillEvidence;
      }
      const structured =
        structureMode === "preserve"
          ? constrainPreservedOptimization({
              resume,
              candidate: normalized,
              baseline: baselineOptimization,
              lockedContentIds,
            })
          : constrainRoleOptimizedStructure({ resume, candidate: normalized });
      const opt = enforceLockedOptimization({
        resume,
        candidate: structured,
        baseline: baselineOptimization,
        lockedContentIds,
      });
      const issues = [
        ...validateOptimization(resume, opt, job),
        ...validateGroundedOptimization(resume, opt),
        ...(structureMode === "preserve"
          ? validatePreservedOptimization(resume, opt)
          : []),
        ...validateLockedOptimization({
          resume,
          candidate: opt,
          baseline: baselineOptimization,
          lockedContentIds,
        }),
      ];
      if (issues.length === 0) {
        issues.push(
          ...(await reviewSemanticGrounding({
            resume,
            candidate: opt,
            model,
          })),
        );
      }
      if (issues.length > 0) {
        lastIssues = issues;
        feedback = issues.slice(0, 20).map((issue) => `- ${issue}`).join("\n");
        continue;
      }
      opt.structureMode = structureMode;
      opt.structureIntegrity = createStructureIntegrity(
        resume,
        opt,
        structureMode,
      );
      opt.atsScore = calculateOptimizationAtsScore({ resume, optimization: opt, job });
      return NextResponse.json({ optimization: opt });
    }

    // Concrete safety issues beat a generic timeout notice: if we collected
    // any, the user gets something actionable even though we stopped early.
    if (lastIssues.length > 0) {
      console.error(
        `optimize exhausted attempts (${structureMode}, model=${model ?? "default"})`,
        lastIssues.slice(0, 20),
      );
    }

    if (ranOutOfTime && lastIssues.length === 0) {
      return NextResponse.json(
        {
          error:
            "The model took too long to rewrite this resume. Nothing was changed — retry, or pick a faster model.",
          code: "model_timeout",
        },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        error:
          structureMode === "preserve"
            ? "The rewrite could not pass the factual safety checks while keeping the original structure."
            : "The rewrite could not pass the factual safety checks.",
        issues: [...new Set(lastIssues.map(publicOptimizationIssue))].slice(
          0,
          12,
        ),
      },
      { status: 422 },
    );
  } catch (e) {
    console.error("optimize failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Optimize failed" },
      { status: 500 },
    );
  }
}
