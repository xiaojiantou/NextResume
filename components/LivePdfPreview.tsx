"use client";

import { PDFViewer } from "@react-pdf/renderer";
import { ResumePdf } from "@/lib/pdf/ResumePdf";
import type { Resume, Optimization } from "@/lib/types";

export function LivePdfPreview({
  resume,
  optimization,
}: {
  resume: Resume;
  optimization: Optimization | null;
}) {
  return (
    <div className="h-full w-full">
      <PDFViewer width="100%" height="100%" className="rounded-lg overflow-hidden">
        <ResumePdf resume={resume} optimization={optimization} />
      </PDFViewer>
    </div>
  );
}
