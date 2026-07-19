// Extract raw text from a resume file. Server-only.
import "server-only";

export async function extractText(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "pdf") {
    // Import the internal implementation directly. The top-level `pdf-parse`
    // entrypoint has a debug-mode code path that tries to read a bundled test
    // PDF (./test/data/05-versions-space.pdf) at load time, which ENOENTs on
    // Vercel serverless. Reaching straight for the impl file dodges it.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error — deep import into pdf-parse has no types
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
      b: Buffer,
    ) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    return data.text.trim();
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  throw new Error(`Unsupported file type: ${ext}`);
}
