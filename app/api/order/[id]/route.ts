import { NextRequest, NextResponse } from "next/server";
import {
  getOrder,
  getOrderSnapshot,
  patchOrderSnapshot,
} from "@/lib/orders";
import { verifyOrderToken } from "@/lib/tokens";
import type { JobAnalysis, Optimization, Resume } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function unauthorized() {
  return NextResponse.json({ error: "Invalid or missing token." }, { status: 401 });
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!verifyOrderToken(id, token)) return unauthorized();

  const [order, snapshot] = await Promise.all([
    getOrder(id),
    getOrderSnapshot(id),
  ]);
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  return NextResponse.json({
    order: {
      id: order.id,
      status: order.status,
      email: order.email ?? null,
    },
    snapshot,
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!verifyOrderToken(id, token)) return unauthorized();

  const body = (await req.json()) as {
    resume?: Resume;
    job?: JobAnalysis | null;
    optimization?: Optimization | null;
    optimizationModel?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (body.resume !== undefined) patch.resume = body.resume;
  if (body.job !== undefined) patch.job = body.job;
  if (body.optimization !== undefined) patch.optimization = body.optimization;
  if (body.optimizationModel !== undefined)
    patch.optimizationModel = body.optimizationModel;

  const updated = await patchOrderSnapshot(id, patch);
  if (!updated) {
    return NextResponse.json(
      { error: "Order snapshot not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, snapshot: updated });
}
