import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { composeSideBySide } from "@/lib/higgsfield/pad";
import { comboId, comboLayout, comboParts } from "@/lib/combo";

const block = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

describe("combined reference images", () => {
  it("round-trips combo ids and leaves plain ids alone", () => {
    expect(comboParts(comboId(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
    expect(comboParts("plain-asset")).toBeNull();
  });

  it("lays parts out left to right at one height with a gutter", () => {
    const L = comboLayout([{ width: 1600, height: 900 }, { width: 800, height: 450 }]);
    expect(L.height).toBe(450);
    expect(L.widths).toEqual([800, 800]);
    expect(L.xs[1]).toBe(800 + Math.round(450 * 0.06));
  });

  it("joins panels side by side and pads the result to the video aspect", async () => {
    const out = await composeSideBySide([await block(1600, 900, "#ff0000"), await block(1600, 900, "#0000ff"), await block(900, 1200, "#00ff00")], "16:9");
    const { width, height } = await sharp(out).metadata();
    expect(Math.abs(width! / height! - 16 / 9)).toBeLessThan(0.01);
    // the left part is red and the right part green, in that order
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number) => {
      const i = (Math.floor(info.height / 2) * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect(px(5)).toEqual([255, 0, 0]);
    expect(px(info.width - 5)).toEqual([0, 255, 0]);
  });
});
