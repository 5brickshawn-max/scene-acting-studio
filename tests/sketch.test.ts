import { describe, expect, it } from "vitest";
import { createProjectData, MAX_DESIGN_REFS } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildSketchHandoffs, MAX_IMAGE_REFERENCES } from "@/lib/domain/handoff";

const board = () => {
  const d = createProjectData("러프", 2, "storyboard");
  d.baseAssetId = "scene-1";
  d.cast = d.cast.map((c, i) => ({ ...c, name: ["샤리", "브람"][i], locks: i ? "짧은 회색 머리" : "긴 금발 곱슬" }));
  d.expressions = d.expressions.map((e, i) => ({ ...e, action: `${i + 1}번 순간: 샤리가 돌아선다`, camera: "로우 앵글 와이드" }));
  return d;
};

describe("러프 콘티 (rough sketches)", () => {
  it("asks for simple black lines on white at the video aspect, one per panel", () => {
    const d = board();
    const hs = buildSketchHandoffs(d);
    expect(hs).toHaveLength(d.expressions.length);
    const p = hs[0].prompt;
    expect(p).toContain("black pencil line drawing on a plain white background");
    expect(p).toContain("no colour, no shading");
    expect(p).toContain("Do NOT copy its colours");
    expect(p).toContain("This moment: 1번 순간: 샤리가 돌아선다");
    expect(p).toContain("Camera and framing: 로우 앵글 와이드");
    expect(p).toContain("샤리 (긴 금발 곱슬)");
    expect(hs[0].aspectRatio).toBe("16:9");
    expect(hs[0].references.map((r) => r.assetId)).toEqual(["scene-1"]);
  });

  it("a panel's sketch then guides its finished panel art", () => {
    const d = board();
    d.expressions[0].sketchAssetId = "sketch-1";
    const h = buildExpressionHandoffs(d)[0];
    expect(h.references.some((r) => r.assetId === "sketch-1")).toBe(true);
    expect(h.prompt).toContain("rough storyboard sketch of this panel");
  });
});

describe("extra reference pictures", () => {
  it("takes up to five, and image requests stay within the reference cap", () => {
    expect(MAX_DESIGN_REFS).toBe(5);
    const d = board();
    d.cast = Array.from({ length: 8 }, (_, i) => ({ ...d.cast[0], id: `c${i}`, name: `인물${i}`, refAssetId: `mat-${i}` }));
    d.designRefAssetIds = ["x1", "x2", "x3", "x4", "x5"];
    d.expressions[1].sketchAssetId = "sketch-2";
    for (const h of buildExpressionHandoffs(d)) expect(h.references.length).toBeLessThanOrEqual(MAX_IMAGE_REFERENCES);
    const few = board();
    few.designRefAssetIds = ["x1", "x2", "x3", "x4", "x5"];
    expect(buildExpressionHandoffs(few)[0].references.filter((r) => r.why === "추가 참고 그림")).toHaveLength(5);
  });
});
