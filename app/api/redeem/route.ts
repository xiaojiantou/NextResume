import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function validCodes(): Set<string> {
  return new Set(
    (process.env.PROMO_CODES || "")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  );
}

export async function POST(req: NextRequest) {
  try {
    const { code } = (await req.json()) as { code?: string };
    const submitted = (code || "").trim().toUpperCase();

    if (!submitted) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 });
    }

    const codes = validCodes();
    if (!codes.has(submitted)) {
      return NextResponse.json(
        { error: "That code isn't valid or has expired." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, code: submitted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Redeem failed" },
      { status: 500 },
    );
  }
}
