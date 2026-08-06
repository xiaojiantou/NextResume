// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Captures up to the first three pages of the ORIGINAL resume for visual-style
// analysis. Text parsing remains independent and always processes the entire
// document.
import "server-only";
import { PDFDocument } from "pdf-lib";
import { launchBrowser } from "./browser";
import type { ResumePageSpec, ResumeStyleSource } from "./types";

const MAX_STYLE_PAGES = 3;
const VIEWPORT = { width: 850, height: 1100 };
const LETTER_PAGE: ResumePageSpec = {
  widthPt: 612,
  heightPt: 792,
  orientation: "portrait",
};

function pageSpec(widthPt: number, heightPt: number): ResumePageSpec {
  return {
    widthPt,
    heightPt,
    orientation: widthPt > heightPt ? "landscape" : "portrait",
  };
}

function asDataUri(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function screenshotHtmlPages(
  html: string,
): Promise<Pick<ResumeStyleSource, "screenshots" | "pageCount">> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "light" },
    ]);
    await page.setViewport(VIEWPORT);
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    const scrollHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    const pageCount = Math.max(1, Math.ceil(scrollHeight / VIEWPORT.height));
    const screenshots: string[] = [];
    for (let index = 0; index < Math.min(pageCount, MAX_STYLE_PAGES); index++) {
      await page.evaluate((top) => window.scrollTo(0, top), index * VIEWPORT.height);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const shot = await page.screenshot({
        type: "jpeg",
        quality: 78,
      });
      screenshots.push(asDataUri(Buffer.from(shot)));
    }
    return { screenshots, pageCount };
  } finally {
    await browser.close();
  }
}

async function screenshotPdf(buffer: Buffer): Promise<ResumeStyleSource> {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const first = pages[0];
  const size = first
    ? pageSpec(first.getWidth(), first.getHeight())
    : LETTER_PAGE;
  const captureCount = Math.min(Math.max(pages.length, 1), MAX_STYLE_PAGES);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    const screenshots: string[] = [];
    for (let index = 0; index < captureCount; index++) {
      // Capture an isolated one-page PDF. Scrolling the multi-page Chromium
      // viewer produces viewport slices that can cross page boundaries, which
      // is useful neither as a source preview nor as input to visual analysis.
      const isolated = await PDFDocument.create();
      const [copiedPage] = await isolated.copyPages(pdf, [index]);
      isolated.addPage(copiedPage);
      const isolatedBytes = Buffer.from(await isolated.save());
      const dataUrl = `data:application/pdf;base64,${isolatedBytes.toString("base64")}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`;
      await page.goto(dataUrl, { waitUntil: "networkidle0", timeout: 15_000 });
      // Chromium's PDF viewer paints after the page load event.
      await new Promise((resolve) => setTimeout(resolve, 800));
      const shot = await page.screenshot({
        type: "jpeg",
        quality: 78,
      });
      screenshots.push(asDataUri(Buffer.from(shot)));
    }
    return { screenshots, page: size, pageCount: pages.length || 1 };
  } finally {
    await browser.close();
  }
}

export async function screenshotResume(
  buffer: Buffer,
  filename: string,
): Promise<ResumeStyleSource> {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "pdf") return screenshotPdf(buffer);

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const { value: bodyHtml } = await mammoth.convertToHtml({ buffer });
    const html = `<!doctype html><html><head><meta name="color-scheme" content="light"><style>
      html,body{background:#fff;color:#000;margin:0}
      body{box-sizing:border-box;width:${VIEWPORT.width}px;padding:48px;font-family:Arial,sans-serif}
      img{max-width:100%}
    </style></head><body>${bodyHtml}</body></html>`;
    const captured = await screenshotHtmlPages(html);
    return { ...captured, page: LETTER_PAGE };
  }

  if (ext === "png" || ext === "jpg" || ext === "jpeg") {
    const mime = ext === "png" ? "image/png" : "image/jpeg";
    return {
      screenshots: [`data:${mime};base64,${buffer.toString("base64")}`],
      page: LETTER_PAGE,
      pageCount: 1,
    };
  }

  throw new Error(`Unsupported file type for screenshot: ${ext}`);
}
