// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Shows what the coordinate extractor does to a PDF before any model sees it.
//
// Usage:
//   node --experimental-strip-types scripts/diagnose-pdf-layout.mjs <file.pdf> [probe...]
//
// Runs the real extractor twice — once letting detectColumnSplit decide, once
// forcing single column — and reports where each probe string ends up. A probe
// that survives only in the forced run is content the column heuristic tore
// apart.
import { readFileSync } from "node:fs";
import { extractPdfLayout } from "../lib/pdfLayout.ts";

// pdf-parse's bundled pdf.js v1.10 rejects during worker teardown, after the
// extraction it was asked for has already succeeded. Reporting is done by then.
process.on("unhandledRejection", (error) => {
  if (error instanceof TypeError && /getBytes/.test(error.message)) return;
  throw error;
});

const [path, ...extraProbes] = process.argv.slice(2);
if (!path) {
  console.error("usage: diagnose-pdf-layout.mjs <file.pdf> [probe...]");
  process.exit(1);
}

const buffer = readFileSync(path);
const probes = extraProbes.length
  ? extraProbes
  : [
      "Built a production Agentic AI platform in Python and FastAPI on GCP",
      "semantically match opportunities",
      "pooling cut p95 API latency",
    ];

const norm = (s) => s.replace(/\s+/g, " ").trim();

function report(label, extraction) {
  const text = norm(extraction.text);
  console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);
  console.log(
    `parser=${extraction.layout.parser} pages=${extraction.layout.pageCount} maxColumns=${extraction.layout.maxColumns} chars=${extraction.text.length}`,
  );
  for (const page of extraction.layout.pages) {
    console.log(
      `  page ${page.page}: ${page.columns} column(s), ${page.widthPt.toFixed(0)}×${page.heightPt.toFixed(0)}pt`,
    );
  }
  for (const issue of extraction.layout.issues) console.log(`  issue: ${issue}`);

  console.log("\n  probes:");
  for (const probe of probes) {
    const hit = text.includes(norm(probe));
    console.log(`   ${hit ? "FOUND  " : "MISSING"}  "${probe.slice(0, 60)}"`);
  }
  return extraction.text;
}

const auto = await extractPdfLayout(buffer);
const autoText = report("AUTO — detectColumnSplit decides (what production does)", auto);

const forcedColumns = Object.fromEntries(
  auto.layout.pages.map((page) => [page.page, 1]),
);
const forced = await extractPdfLayout(buffer, forcedColumns);
const forcedText = report("FORCED SINGLE COLUMN — column heuristic bypassed", forced);

if (process.env.DUMP_FORCED) {
  console.log(`\n${"=".repeat(72)}\nFORCED SINGLE COLUMN TEXT (verbatim)\n${"=".repeat(72)}`);
  console.log(forcedText);
}

// The smoking gun: with a bogus 2-column split, one visual line is torn into
// two blocks hundreds of lines apart, and the leftovers become neighbours.
if (auto.layout.maxColumns === 2) {
  console.log(`\n${"=".repeat(72)}\nHOW THE AUTO RUN SPLIT PAGE 1\n${"=".repeat(72)}`);
  const lines = autoText.split("\n");
  let section = "";
  for (const line of lines) {
    const marker = line.match(/^\[PAGE \d+(?: (HEADER|LEFT COLUMN|RIGHT COLUMN))?\]$/);
    if (marker) {
      section = marker[1] ?? "BODY";
      console.log(`\n--- ${section} ---`);
      continue;
    }
    if (!line.trim()) continue;
    console.log(`  ${line}`);
  }
}
