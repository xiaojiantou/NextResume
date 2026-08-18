// Copyright (c) 2026 HowBe LLC. All rights reserved.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray lockfile in the home directory makes Next infer the wrong workspace
  // root, which is what the include globs below are resolved against. Pin it.
  outputFileTracingRoot: __dirname,
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
    // Native .node bindings; bundling them breaks the loader's platform probe.
    "@napi-rs/canvas",
    "pdfjs-dist",
  ],
  // Externalizing alone is not enough: bin/ holds brotli-packed binaries that
  // nothing imports, so file tracing never sees them and they are left out of
  // the Lambda. Name them explicitly for every route that launches Chromium.
  outputFileTracingIncludes: {
    // pdf.js loads its Foxit substitute fonts from disk at render time, and the
    // canvas bindings are resolved per-platform at require time — neither is a
    // static import, so both need naming here for the same reason as chromium.
    "/api/parse-resume": [
      "./node_modules/@sparticuz/chromium/bin/**",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
      // pdf.js spawns a "fake worker" by dynamically importing this at run
      // time, so nothing static points at it.
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
    ],
    "/api/personalize": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/fit-resume": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/export/pdf": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

module.exports = nextConfig;
