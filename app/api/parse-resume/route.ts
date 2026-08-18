// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import { analyzeResumeVisualLayout, jsonCompletion } from "@/lib/ai";
import { extractText } from "@/lib/extract";
import { screenshotResume } from "@/lib/resumeScreenshot";
import { extractPdfLayout } from "@/lib/pdfLayout";
import {
  mergeParsedResumes,
  normalizeParsedResume,
  splitResumeText,
  attachResumeStructureMetadata,
} from "@/lib/resumeParser";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";
import type { Resume } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM = `You parse resume text into structured JSON. Output ONLY valid JSON matching this schema (no prose, no markdown):

{
  "name": string,
  "title": string,            // current/most-recent title
  "email": string,
  "phone": string,
  "location": string,
  "links": string[],          // profile links from the header (LinkedIn, GitHub, portfolio, website) in short display form, e.g. "linkedin.com/in/jane" or "LinkedIn" if the URL is not visible; [] if none
  "summary": string,          // verbatim from resume; "" if absent
  "skills": string[],         // flat deduplicated list of every individual skill
  "skillGroups": [
    // The source resume's skill categories, verbatim. E.g. a line
    // "Languages: Python, Go, Java" becomes { "label": "Languages", "skills": ["Python", "Go", "Java"] }.
    // [] if the source lists skills without category labels.
    { "label": string, "skills": string[] }
  ],
  "experience": [
    {
      "id": string,           // stable ID like "r1", "r2"...
      "company": string,
      "title": string,
      "location": string,
      "start": string,        // e.g. "Jul 2022"
      "end": string,          // "Present" if current
      "techStack": string,    // verbatim tech/tools line attached to this role (often after a "|"), e.g. "FastAPI, PostgreSQL, Redis"; "" if none
      "bullets": [
        { "id": string, "text": string }  // ID like "b1","b2"... unique across whole resume
      ]
    }
  ],
  "projects": [
    // A separate "Projects" section, distinct from work experience/internships.
    // Personal, academic, or side projects — NOT roles at an employer.
    {
      "id": string,           // stable ID like "p1", "p2"...
      "name": string,         // project name/title
      "role": string,         // role and/or tech stack line, e.g. "Software Engineer | FastAPI, PostgreSQL, React"
      "location": string,
      "start": string,
      "end": string,
      "bullets": [
        { "id": string, "text": string }  // continue the global b1,b2... sequence
      ]
    }
  ],
  "education": [
    { "school": string, "degree": string, "year": string }
  ],
  "language": "en",
  "sectionLabels": {
    // Preserve the exact source heading text and capitalization for every
    // core section actually visible in this chunk.
    "summary": string,
    "skills": string,
    "experience": string,
    "projects": string,
    "education": string
  },
  "sectionOrder": [
    // Preserve the source resume's reading order. Core values are:
    // "summary", "skills", "experience", "projects", "education".
    // Additional sections use "additional:<section id>".
    string
  ],
  "additionalSections": [
    {
      "id": string,           // "extra1", "extra2"...
      "kind": "awards" | "certifications" | "publications" | "languages" | "volunteering" | "custom",
      "title": string,        // original section heading
      "items": [
        {
          "id": string,
          "heading": string,  // award/certificate/publication/item name
          "subheading": string,
          "location": string,
          "start": string,
          "end": string,
          "bullets": [{ "id": string, "text": string }]
        }
      ]
    }
  ]
}

Rules:
- Preserve ALL source content VERBATIM. Do not rewrite, summarize, or omit.
- Role/company lines often carry a tech-stack suffix (e.g. "Acme Corp | FastAPI, Redis, GCS"). Put that suffix in the role's "techStack" verbatim — never discard it, and never mix it into company/title.
- Header links (LinkedIn, GitHub, portfolio) go in "links" — these matter to recruiters; never drop them.
- This product uses English resume labels. Set language to "en".
- Assign sequential IDs: r1,r2... for roles; p1,p2... for projects; b1,b2,b3... globally across all roles AND projects.
- A resume section titled "Projects" (or similar) must go in "projects", never merged into "experience".
- EVERY section containing employment roles — "Experience", "Professional Experience", "Work Experience", "Employment History", internships — goes into "experience". Never put employment roles in additionalSections, and never output the same role in two places.
- Put awards, certifications, publications, languages, volunteering, and every other non-core section in additionalSections. Never discard an unfamiliar section.
- "degree" must be verbatim including GPA and honors, e.g. "M.S in Computer Science; GPA: 4.0/4.0".
- sectionOrder must include every non-empty section in its original reading order.
- sectionLabels must preserve core headings verbatim. Do not standardize labels such as "PROFESSIONAL EXPERIENCE" to "Experience".
- Keep content under the section heading where it appears. Never move a source Project into Experience or vice versa.
- If a field is missing, use "" (or [] for arrays).
- Skills: "skills" is always the flat deduplicated list of individual skills (never include category labels as items). When the source groups skills under category labels, ALSO output "skillGroups" preserving those labels and their skills verbatim.
- Text markers such as [PAGE 1 LEFT COLUMN] describe PDF coordinates, not resume content. Never copy them into a field.
- For multi-column PDFs, follow the supplied visual layout guide for semantic section order, while copying field content only from the coordinate-ordered text.`;

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.parseResume);
  if (rl) return rl;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    // Screenshot runs alongside text extraction (not after) so the
    // "personalized" PDF style's prerequisite doesn't add latency to the
    // critical path every user already goes through. Best-effort: a failure
    // here just means "personalized" style won't be offered later, not a
    // failed upload.
    const [initialExtraction, styleSource] = await Promise.all([
      extractText(buf, file.name),
      screenshotResume(buf, file.name).catch((e) => {
        console.warn("[parse-resume] screenshot failed", e);
        return null;
      }),
    ]);

    let { text, photo, layout } = initialExtraction;

    // Coordinates are only a candidate signal: right-aligned dates, scores,
    // and contact rows can look like a second column. For every PDF, let the
    // page screenshots arbitrate single-column vs sidebar/mixed structure.
    const visualGuide =
      file.name.toLowerCase().endsWith(".pdf") && styleSource
        ? await analyzeResumeVisualLayout(styleSource).catch((error) => {
            console.warn("[parse-resume] visual layout analysis failed", error);
            return null;
          })
        : null;
    if (visualGuide?.pages.length) {
      const pageColumns = Object.fromEntries(
        visualGuide.pages.map((page) => [
          page.page,
          page.layout === "single-column" ? 1 : 2,
        ]),
      ) as Record<number, 1 | 2>;
      const corrected = await extractPdfLayout(buf, pageColumns);
      text = corrected.text.trim();
      layout = corrected.layout;
    }

    if (text.length < 50) {
      return NextResponse.json(
        { error: "Could not extract enough text from this file." },
        { status: 422 },
      );
    }

    // Screenshot analysis also supplies semantic relationships between page
    // regions. Exact content still comes only from the corrected PDF text.
    const visualGuideContext = visualGuide
      ? `\n\nVisual layout guide for the complete document (use only for headings, regions, and reading order):\n${JSON.stringify(visualGuide)}`
      : "";

    const chunks = splitResumeText(text);
    const parsed: Resume[] = [];
    // A small concurrency cap keeps long resumes inside the route duration
    // without flooding the model provider.
    for (let start = 0; start < chunks.length; start += 3) {
      const batch = chunks.slice(start, start + 3);
      const results = await Promise.all(
        batch.map(async (chunk, batchIndex) => {
          const chunkIndex = start + batchIndex;
          const value = await jsonCompletion<Resume>({
            system: SYSTEM,
            user: `Resume text chunk ${chunkIndex + 1} of ${chunks.length}. Parse only content actually present in this chunk; do not invent missing sections.${visualGuideContext}\n\nCoordinate-ordered source text:\n${chunk}`,
            maxTokens: 6000,
          });
          return normalizeParsedResume(value);
        }),
      );
      parsed.push(...results);
    }
    const resume = attachResumeStructureMetadata({
      resume: mergeParsedResumes(parsed),
      sourceText: text,
      layout,
      visualGuide,
    });
    if (photo) resume.photo = photo;

    return NextResponse.json({
      resume,
      rawText: text,
      styleSource: styleSource
        ? {
            ...styleSource,
            visualLayoutGuide: visualGuide,
            sourceLayout: layout,
          }
        : null,
      // Backwards-compatible response for clients persisted before the
      // multi-page style source was introduced.
      screenshot: styleSource?.screenshots[0] ?? null,
    });
  } catch (e) {
    console.error("parse-resume failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Parse failed" },
      { status: 500 },
    );
  }
}
