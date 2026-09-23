// Copyright (c) 2026 HowBe LLC. All rights reserved.

import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { pageLayoutFromPdf } from "../lib/pdf/pageLayout.ts";
import { sourcePageCount } from "../lib/pdf/fitTarget.ts";

test("pageLayoutFromPdf records every page's geometry as a measured layout", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([612, 792]);
  const layout = await pageLayoutFromPdf(Buffer.from(await doc.save()));
  assert.equal(layout.parser, "linear-text");
  assert.equal(layout.pageCount, 2);
  assert.equal(layout.maxColumns, 1);
  assert.deepEqual(layout.pages, [
    { page: 1, widthPt: 612, heightPt: 792, columns: 1 },
    { page: 2, widthPt: 612, heightPt: 792, columns: 1 },
  ]);
  // Populated pages are what distinguish a compiled count from the
  // placeholder the parser writes for an unmeasured upload.
  assert.equal(sourcePageCount({ sourceLayout: layout }), 2);
});
