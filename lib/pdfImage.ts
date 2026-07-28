// Best-effort extraction of an embedded photo from a resume PDF.
//
// pdf-lib has no "give me the images" API (it's built for creating/editing
// PDFs, not mining them) — this walks the low-level object graph by hand:
// page Resources -> XObject dict -> Image XObjects (recursing into any Form
// XObjects along the way, since PDF generators often wrap drawn images in
// one). Among all images found, the largest by pixel area is assumed to be
// the headshot (logos/icons tend to be small).
//
// Only images whose filter chain terminates in DCTDecode (JPEG) or
// JPXDecode (JPEG2000) are supported — those are already-encoded image
// bytes, safe to hand straight to <img>/react-pdf as-is. Any leading
// ASCII85Decode/ASCIIHexDecode wrapping (common from some PDF generators) is
// unwrapped first. Raw, uncompressed pixel streams (FlateDecode-only, no
// image codec — typically PNG-sourced photos) aren't supported yet: turning
// those into a usable image needs a PNG encoder we don't have, so we just
// skip the photo rather than produce something broken.
import "server-only";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } from "pdf-lib";

function ascii85Decode(data: Buffer): Buffer {
  const str = data
    .toString("latin1")
    .replace(/^<~/, "")
    .replace(/~>$/, "")
    .replace(/\s+/g, "");
  const out: number[] = [];
  let group: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(str.charCodeAt(i) - 33);
    if (group.length === 5) {
      let value = 0;
      for (const g of group) value = value * 85 + g;
      out.push(
        (value >>> 24) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 8) & 0xff,
        value & 0xff,
      );
      group = [];
    }
  }
  if (group.length > 1) {
    const padCount = 5 - group.length;
    for (let i = 0; i < padCount; i++) group.push(84);
    let value = 0;
    for (const g of group) value = value * 85 + g;
    const bytes = [
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ];
    out.push(...bytes.slice(0, 4 - padCount));
  }
  return Buffer.from(out);
}

function asciiHexDecode(data: Buffer): Buffer {
  const str = data.toString("latin1").replace(/>$/, "").replace(/\s+/g, "");
  const clean = str.length % 2 === 0 ? str : str + "0";
  return Buffer.from(clean, "hex");
}

function collectImageXObjects(
  pdfDoc: PDFDocument,
  resources: PDFDict | undefined,
  out: PDFRawStream[],
  seen: Set<string>,
) {
  if (!resources) return;
  const xobjectsRef = resources.get(PDFName.of("XObject"));
  if (!xobjectsRef) return;
  const xobjects = pdfDoc.context.lookup(xobjectsRef);
  if (!(xobjects instanceof PDFDict)) return;

  for (const [, ref] of xobjects.entries()) {
    const key = ref.toString();
    if (seen.has(key)) continue;
    seen.add(key);

    const obj = pdfDoc.context.lookup(ref);
    if (!(obj instanceof PDFRawStream)) continue;

    const subtype = obj.dict.get(PDFName.of("Subtype"));
    if (subtype?.toString() === "/Image") {
      out.push(obj);
    } else if (subtype?.toString() === "/Form") {
      const formResources = pdfDoc.context.lookup(
        obj.dict.get(PDFName.of("Resources")),
      );
      collectImageXObjects(
        pdfDoc,
        formResources instanceof PDFDict ? formResources : undefined,
        out,
        seen,
      );
    }
  }
}

function imageArea(image: PDFRawStream): number {
  const w = image.dict.get(PDFName.of("Width"));
  const h = image.dict.get(PDFName.of("Height"));
  const width = w && "asNumber" in w ? (w as any).asNumber() : 0;
  const height = h && "asNumber" in h ? (h as any).asNumber() : 0;
  return width * height;
}

export async function extractPdfPhoto(
  buffer: Buffer,
): Promise<string | undefined> {
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const page = pdfDoc.getPages()[0];
    if (!page) return undefined;

    const images: PDFRawStream[] = [];
    collectImageXObjects(pdfDoc, page.node.Resources(), images, new Set());
    if (images.length === 0) {
      console.warn("[pdfImage] no embedded image XObjects found on page 1");
      return undefined;
    }

    const best = images.reduce((a, b) =>
      imageArea(b) > imageArea(a) ? b : a,
    );

    const filterEntry = best.dict.get(PDFName.of("Filter"));
    const filters = !filterEntry
      ? []
      : filterEntry instanceof PDFArray
        ? filterEntry.asArray().map((f) => f.toString())
        : [filterEntry.toString()];

    let bytes: Buffer = Buffer.from(best.contents);
    let terminalFilter: string | null = null;

    for (const f of filters) {
      if (f === "/ASCII85Decode") {
        bytes = ascii85Decode(bytes);
      } else if (f === "/ASCIIHexDecode") {
        bytes = asciiHexDecode(bytes);
      } else if (f === "/DCTDecode" || f === "/JPXDecode") {
        terminalFilter = f;
      } else {
        // FlateDecode-only (raw pixels), CCITTFax, JBIG2, etc. — not
        // supported, bail rather than emit garbage.
        console.warn(
          `[pdfImage] found ${images.length} image(s), but the largest one uses unsupported filter(s) [${filters.join(", ")}] — skipping`,
        );
        return undefined;
      }
    }

    if (!terminalFilter) {
      console.warn(
        `[pdfImage] found ${images.length} image(s) but no terminal image codec (filters: [${filters.join(", ")}])`,
      );
      return undefined;
    }
    const mime = terminalFilter === "/JPXDecode" ? "image/jp2" : "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch (e) {
    // Photo extraction is best-effort — never let it break resume parsing.
    console.warn("[pdfImage] extraction threw", e);
    return undefined;
  }
}
