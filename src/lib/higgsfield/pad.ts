/**
 * Pads an image with white to the video's aspect ratio, never stretching it.
 * Video models squeeze/stretch square references to fill a 16:9 frame, which
 * distorts the character (wider face, shorter neck). A reference that already
 * has the output's shape keeps the drawing's proportions.
 */
import sharp from "sharp";

export type VideoAspect = "16:9" | "9:16";
export const ratioOf = (a: VideoAspect) => (a === "16:9" ? 16 / 9 : 9 / 16);

/** Canvas size that contains (w, h) unchanged at the target ratio, or null if already that shape. */
export function paddedSize(w: number, h: number, aspect: VideoAspect) {
  const r = ratioOf(aspect);
  if (Math.abs(w / h - r) / r < 0.03) return null;
  return w / h < r ? { width: Math.round(h * r), height: h } : { width: w, height: Math.round(w / r) };
}

export async function padToAspect(input: Buffer, aspect: VideoAspect): Promise<Buffer | null> {
  const img = sharp(input).flatten({ background: "#ffffff" });
  const { width, height } = await img.metadata();
  if (!width || !height) return null;
  const size = paddedSize(width, height, aspect);
  if (!size) return null;
  const left = Math.floor((size.width - width) / 2);
  const top = Math.floor((size.height - height) / 2);
  return img
    .extend({ left, right: size.width - width - left, top, bottom: size.height - height - top, background: "#ffffff" })
    .png()
    .toBuffer();
}
