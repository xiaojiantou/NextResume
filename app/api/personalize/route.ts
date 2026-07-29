import { NextRequest, NextResponse } from "next/server";
import { generateValidatedStyleProfile } from "@/lib/personalizedResume";
import { rateLimitGuard } from "@/lib/ratelimit";
import type { ResumeStyleSource } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const PERSONALIZE_LIMIT = {
  key: "personalize",
  limit: 3,
  windowMs: 60_000,
};

export async function POST(req: NextRequest) {
  const rl = rateLimitGuard(req, PERSONALIZE_LIMIT);
  if (rl) return rl;

  try {
    const { styleSource, screenshot } = (await req.json()) as {
      styleSource?: ResumeStyleSource;
      screenshot?: string;
    };
    const source =
      styleSource ??
      (screenshot
        ? {
            screenshots: [screenshot],
            page: {
              widthPt: 612,
              heightPt: 792,
              orientation: "portrait" as const,
            },
            pageCount: 1,
          }
        : null);
    if (!source?.screenshots?.length) {
      return NextResponse.json(
        { error: "Missing resume style source." },
        { status: 400 },
      );
    }

    const styleProfile = await generateValidatedStyleProfile(source);
    if (!styleProfile) {
      return NextResponse.json(
        { error: "Could not generate a personalized layout for this resume." },
        { status: 422 },
      );
    }

    return NextResponse.json({ styleProfile });
  } catch (e) {
    console.error("personalize failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Personalize failed" },
      { status: 500 },
    );
  }
}
