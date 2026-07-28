import { NextRequest, NextResponse } from "next/server";
import { extractText } from "@/lib/extract";
import { LIMITS, rateLimitGuard } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_EXT = new Set(["jpg", "jpeg", "png"]);

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, LIMITS.importJobImage);
  if (rl) return rl;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXT.has(ext)) {
      return NextResponse.json(
        { error: "Please upload a JPG or PNG image." },
        { status: 400 },
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image too large. Max 10MB." },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const { text } = await extractText(buf, file.name);

    if (text.length < 50) {
      return NextResponse.json(
        { error: "Could not extract enough text from this image." },
        { status: 422 },
      );
    }

    return NextResponse.json({ text });
  } catch (e) {
    console.error("import-job-image failed", e);
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Could not read the job image.",
      },
      { status: 500 },
    );
  }
}
