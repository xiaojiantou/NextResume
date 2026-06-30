import { NextRequest, NextResponse } from "next/server";
import { jsonCompletion } from "@/lib/ai";
import { extractText } from "@/lib/extract";
import type { Resume } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You parse resume text into structured JSON. Output ONLY valid JSON matching this schema (no prose, no markdown):

{
  "name": string,
  "title": string,            // current/most-recent title
  "email": string,
  "phone": string,
  "location": string,
  "summary": string,          // verbatim from resume; "" if absent
  "skills": string[],         // flat list
  "experience": [
    {
      "id": string,           // stable ID like "r1", "r2"...
      "company": string,
      "title": string,
      "location": string,
      "start": string,        // e.g. "Jul 2022"
      "end": string,          // "Present" if current
      "bullets": [
        { "id": string, "text": string }  // ID like "b1","b2"... unique across whole resume
      ]
    }
  ],
  "education": [
    { "school": string, "degree": string, "year": string }
  ]
}

Rules:
- Preserve bullet text VERBATIM. Do not rewrite or summarize.
- Assign sequential IDs: r1,r2... for roles; b1,b2,b3... globally across all roles.
- If a field is missing, use "" (or [] for arrays).
- Skills should be a flat deduplicated list.`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const text = await extractText(buf, file.name);

    if (text.length < 50) {
      return NextResponse.json(
        { error: "Could not extract enough text from this file." },
        { status: 422 },
      );
    }

    const resume = await jsonCompletion<Resume>({
      system: SYSTEM,
      user: `Resume text:\n\n${text.slice(0, 12000)}`,
      maxTokens: 4000,
    });

    return NextResponse.json({ resume, rawText: text });
  } catch (e) {
    console.error("parse-resume failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Parse failed" },
      { status: 500 },
    );
  }
}
