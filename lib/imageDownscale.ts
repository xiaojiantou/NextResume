// Copyright (c) 2026 HowBe LLC. All rights reserved.

// Shrinks a rendered page before it is sent to a vision model.
//
// Pages are rasterized at ~150 DPI because the personalized style has to read
// typography and colour off them. Column layout is a far coarser question —
// a sidebar is obvious in a thumbnail — and image tokens scale with area, so
// sending the full-resolution page to answer it is the single most wasteful
// part of an upload.
import "server-only";

const LAYOUT_JPEG_QUALITY = 70;

/**
 * Returns a narrower JPEG data URI, or the original when it is already small
 * enough or cannot be decoded. Never throws: a failed downscale must degrade
 * to the original image, not fail the upload.
 */
export async function downscaleDataUri(
  dataUri: string,
  maxWidth: number,
): Promise<string> {
  try {
    const comma = dataUri.indexOf(",");
    if (!dataUri.startsWith("data:image/") || comma === -1) return dataUri;
    const source = Buffer.from(dataUri.slice(comma + 1), "base64");

    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(source);
    if (!image.width || image.width <= maxWidth) return dataUri;

    const scale = maxWidth / image.width;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    // Pages are rendered on white; without this a transparent source would
    // composite onto black and invert the layout the model has to read.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const jpeg = canvas.toBuffer("image/jpeg", LAYOUT_JPEG_QUALITY);
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return dataUri;
  }
}
