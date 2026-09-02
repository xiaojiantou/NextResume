// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Rasterizes the first pages of a PDF to JPEG, for visual-style analysis.
//
// The previous approach pointed headless Chromium at a `data:application/pdf`
// URL and screenshotted its built-in viewer. That only ever worked locally:
// @sparticuz/chromium is a stripped serverless build with no PDF plugin, so
// production always failed with ERR_ABORTED — after paying a ~65MB brotli
// decompression to launch the browser at all.
//
// pdf.js renders the pages directly instead, with no browser involved. Licence
// note: pdfjs-dist is Apache-2.0 and @napi-rs/canvas is MIT; mupdf was rejected
// for this because it is AGPL.
import "server-only";
import path from "node:path";
import { measurePdfStyle } from "./pdfStyleMetrics";
import type {
  ResumePageSpec,
  ResumeStyleMetrics,
  ResumeStyleSource,
} from "./types";

// 96 DPI is pdf.js's scale-1 baseline; 2x lands ~150 DPI, enough detail for
// layout/colour analysis without blowing up the base64 payload.
const RENDER_SCALE = 2;
const JPEG_QUALITY = 78;

function pageSpec(widthPt: number, heightPt: number): ResumePageSpec {
  return {
    widthPt,
    heightPt,
    orientation: widthPt > heightPt ? "landscape" : "portrait",
  };
}

// pdf.js loads these asset directories from disk at render time, concatenating
// a filename onto whatever it is given — so the trailing separator matters.
// It validates the value as a URL and demands a literal "/", so this cannot be
// path.sep: on Windows that yields a backslash and pdf.js rejects the document
// with `Invalid factory url ... must include trailing slash` before rendering
// a single page.
function pdfjsAsset(dir: string): string {
  return `${path.join(process.cwd(), "node_modules", "pdfjs-dist", dir)}/`;
}

export async function rasterizePdf(
  buffer: Buffer,
  maxPages: number,
): Promise<ResumeStyleSource> {
  const canvasLib = await import("@napi-rs/canvas");
  const { createCanvas } = canvasLib;

  // pdf.js 5.x builds paths as Path2D and geometry as DOMMatrix, both of which
  // are browser globals that do not exist in Node. @napi-rs/canvas ships its
  // own implementations, but only recognises its own instances — without this
  // the render dies with `Value is none of these types String, Path`. Assign
  // before importing pdf.js so its module-level feature checks see them.
  const shims = {
    Path2D: canvasLib.Path2D,
    DOMMatrix: canvasLib.DOMMatrix,
    ImageData: canvasLib.ImageData,
    DOMPoint: canvasLib.DOMPoint,
  } as unknown as Record<string, unknown>;
  for (const [name, impl] of Object.entries(shims)) {
    if (!(name in globalThis)) {
      (globalThis as unknown as Record<string, unknown>)[name] = impl;
    }
  }

  // The legacy build is the one that runs outside a browser.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const doc = await pdfjs.getDocument({
    // pdf.js transfers ownership of the buffer it is handed, so give it a copy
    // — the caller still needs these bytes for text extraction and photo mining.
    data: new Uint8Array(buffer),
    // Lambdas have no system font cache to fall back on.
    useSystemFonts: false,
    standardFontDataUrl: pdfjsAsset("standard_fonts"),
    // CJK resumes reference predefined CMaps rather than embedding the
    // encoding; without these the glyphs come out blank.
    cMapUrl: pdfjsAsset("cmaps"),
    cMapPacked: true,
  }).promise;

  try {
    const pageCount = doc.numPages;
    const screenshots: string[] = [];
    let spec: ResumePageSpec | undefined;
    let styleMetrics: ResumeStyleMetrics | null = null;

    for (let i = 1; i <= Math.min(pageCount, maxPages); i++) {
      const page = await doc.getPage(i);
      try {
        if (!spec) {
          const base = page.getViewport({ scale: 1 });
          spec = pageSpec(base.width, base.height);
        }
        // Page 1 carries the document's typographic system, and it is the only
        // page holding the name. Measuring here reuses the page pdf.js has
        // already parsed for rendering. Best-effort: a file we cannot measure
        // simply keeps the vision estimate.
        if (i === 1 && spec) {
          styleMetrics = await measurePdfStyle(page, spec).catch((error) => {
            console.warn("[pdfRaster] style measurement failed", error);
            return null;
          });
        }
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = createCanvas(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );
        const context = canvas.getContext("2d");
        // PDFs assume paper: without this, transparent areas render black.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const jpeg = canvas.toBuffer("image/jpeg", JPEG_QUALITY);
        screenshots.push(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
      } finally {
        page.cleanup();
      }
    }

    return {
      screenshots,
      page: spec ?? pageSpec(612, 792),
      pageCount: pageCount || 1,
      styleMetrics,
    };
  } finally {
    await doc.destroy();
  }
}
