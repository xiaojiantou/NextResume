// Copyright (c) 2026 HowBe LLC. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import {
  getOrder,
  getOrderSnapshot,
  patchOrderSnapshot,
} from "@/lib/orders";
import { verifyOrderToken } from "@/lib/tokens";
import type {
  JobAnalysis,
  AtsReport,
  ContentStructureMode,
  Optimization,
  OptimizationVariant,
  Resume,
  ResumeStyleProfile,
  ResumeStyleSource,
} from "@/lib/types";
import {
  isPdfStyle,
  normalizeTargetPages,
  type PdfStyle,
  type TargetPages,
} from "@/lib/pdf/config";
import { pruneFitVariants, type ResumeFitVariant } from "@/lib/resumeFit";

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
    report?: AtsReport | null;
    optimization?: Optimization | null;
    optimizationModel?: string | null;
    optimizationStructureMode?: ContentStructureMode | null;
    optimizationVariants?: OptimizationVariant[];
    contentStructure?: ContentStructureMode;
    lockedContentIds?: string[];
    resumeStyleSource?: ResumeStyleSource | null;
    personalizedStyleProfile?: ResumeStyleProfile | null;
    pdfStyle?: PdfStyle;
    pdfPalette?: string;
    targetPages?: TargetPages;
    fitVariants?: ResumeFitVariant[];
    fitKeepIds?: string[];
  };

  const patch: Record<string, unknown> = {};
  if (body.resume !== undefined) patch.resume = body.resume;
  if (body.job !== undefined) patch.job = body.job;
  if (body.report !== undefined) patch.report = body.report;
  if (body.optimization !== undefined) patch.optimization = body.optimization;
  if (body.optimizationModel !== undefined)
    patch.optimizationModel = body.optimizationModel;
  if (
    body.optimizationStructureMode === null ||
    body.optimizationStructureMode === "optimize" ||
    body.optimizationStructureMode === "preserve"
  ) {
    patch.optimizationStructureMode = body.optimizationStructureMode;
  }
  if (Array.isArray(body.optimizationVariants)) {
    patch.optimizationVariants = body.optimizationVariants.slice(0, 8);
  }
  if (
    body.contentStructure === "optimize" ||
    body.contentStructure === "preserve"
  ) {
    patch.contentStructure = body.contentStructure;
  }
  if (Array.isArray(body.lockedContentIds)) {
    patch.lockedContentIds = [
      ...new Set(
        body.lockedContentIds.filter(
          (id): id is string => typeof id === "string",
        ),
      ),
    ].slice(0, 500);
  }
  if (body.resumeStyleSource !== undefined)
    patch.resumeStyleSource = body.resumeStyleSource;
  if (body.personalizedStyleProfile !== undefined)
    patch.personalizedStyleProfile = body.personalizedStyleProfile;
  if (body.pdfStyle !== undefined && isPdfStyle(body.pdfStyle))
    patch.pdfStyle = body.pdfStyle;
  if (body.pdfPalette !== undefined && typeof body.pdfPalette === "string")
    patch.pdfPalette = body.pdfPalette.slice(0, 80);
  if (body.targetPages !== undefined)
    patch.targetPages = normalizeTargetPages(body.targetPages);
  if (Array.isArray(body.fitVariants))
    patch.fitVariants = pruneFitVariants(body.fitVariants);
  if (Array.isArray(body.fitKeepIds))
    patch.fitKeepIds = [
      ...new Set(
        body.fitKeepIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.slice(0, 120)),
      ),
    ].slice(0, 200);

  const updated = await patchOrderSnapshot(id, patch);
  if (!updated) {
    return NextResponse.json(
      { error: "Order snapshot not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, snapshot: updated });
}
