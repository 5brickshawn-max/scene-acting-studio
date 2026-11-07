/**
 * Combined reference images: when a scene has more beat images than the video model takes, consecutive
 * panels are attached side by side in one image (left to right) instead of being left out.
 * A combined image has no asset row of its own; its id lists the parts and it is composed when needed.
 */
const PREFIX = "combo:";

export const comboId = (assetIds: string[]) => PREFIX + assetIds.join("+");

/** The part asset ids of a combined image, or null for an ordinary asset id. */
export function comboParts(id: string): string[] | null {
  if (!id.startsWith(PREFIX)) return null;
  const parts = id.slice(PREFIX.length).split("+").filter(Boolean);
  return parts.length ? parts : null;
}

/** Panels per combined image at most (smaller ones stop reading as separate frames). */
export const MAX_COMBO_PARTS = 3;

/** Canvas layout for parts drawn side by side at a common height with a white gutter. */
export function comboLayout(sizes: { width: number; height: number }[]) {
  const height = Math.min(...sizes.map((s) => s.height));
  const widths = sizes.map((s) => Math.round((s.width * height) / s.height));
  const gutter = Math.round(height * 0.06);
  const xs: number[] = [];
  let x = 0;
  for (const w of widths) {
    xs.push(x);
    x += w + gutter;
  }
  return { width: x - gutter, height, widths, xs };
}
