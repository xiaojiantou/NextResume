// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Shared headless-browser launcher for the "personalized" PDF style —
// screenshotting the original resume and rendering AI-generated HTML back
// out to a PDF both need an actual browser (Yoga-based react-pdf can't do
// arbitrary HTML/CSS).
//
// Local dev: full `puppeteer` (bundles its own Chromium, simplest setup).
// Production (Vercel): `puppeteer-core` + `@sparticuz/chromium`, a Chromium
// build slimmed down to fit serverless deployment size limits. This split is
// the standard pattern for running Puppeteer on Vercel — full `puppeteer`'s
// bundled browser is too large to deploy there.
//
// NOTE: the production path hasn't been verified on an actual Vercel
// deployment yet — only exercised locally so far.
import "server-only";
import type { Browser } from "puppeteer-core";

export async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    const chromium = (await import("@sparticuz/chromium")).default;
    const puppeteerCore = await import("puppeteer-core");
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    }) as unknown as Promise<Browser>;
  }

  const puppeteer = await import("puppeteer");
  return puppeteer.launch({ headless: true }) as unknown as Promise<Browser>;
}
