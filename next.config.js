// Copyright (c) 2026 HowBe LLC. All rights reserved.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @sparticuz/chromium ships the Chromium binary as files under its own
  // node_modules/bin directory and resolves them at runtime by path. Bundling
  // it relocates the JS away from those files, so on Vercel the launch fails
  // with `input directory "/var/task/node_modules/@sparticuz/chromium/bin"
  // does not exist`. Keeping it (and its puppeteer peers) external leaves the
  // package in node_modules where its own path lookup still works.
  serverExternalPackages: [
    "@sparticuz/chromium",
    "puppeteer-core",
    "puppeteer",
  ],
  // Externalizing alone is not enough: bin/ holds brotli-packed binaries that
  // nothing imports, so file tracing never sees them and they are left out of
  // the Lambda. Name them explicitly for every route that launches Chromium.
  outputFileTracingIncludes: {
    "/api/parse-resume": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/personalize": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/fit-resume": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/export/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

module.exports = nextConfig;
