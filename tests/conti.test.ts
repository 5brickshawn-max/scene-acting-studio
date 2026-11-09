import { describe, expect, it } from "vitest";
import { createProjectData, setExpressionCount, stepIssues, usesConti, type ProjectData } from "@/lib/domain/project";
import { buildVideoHandoff } from "@/lib/domain/handoff";
import { preRenderCheck } from "@/lib/domain/check";

const board = (): ProjectData => {
  const d = setExpressionCount(createProjectData("탈출", 2, "storyboard"), 4);
  d.baseAssetId = "scene-1";
  d.designRefAssetIds = ["bg-1"];
  d.cast = d.cast.map((c, i) => ({ ...c, name: ["아스파샤", "바헬"][i], refAssetId: `sheet-${i + 1}` }));
  d.expressions = d.expressions.map((e, i) => ({ ...e, action: `순간 ${i + 1}`, camera: "고정", sketchAssetId: `sk-${i + 1}` }));
  return d;
};

describe("콘티 방식 (storyboard video from sheets, places and rough sketches)", () => {
  it("is chosen automatically when every panel has a sketch, or by hand", () => {
    const d = board();
    expect(usesConti(d)).toBe(true);
    d.expressions[2].sketchAssetId = null;
    expect(usesConti(d)).toBe(false);
    d.video.refMode = "conti";
    expect(usesConti(d)).toBe(true);
    d.video.refMode = "panels";
    expect(usesConti(board())).toBe(true);
    expect(usesConti({ ...board(), video: { ...board().video, refMode: "panels" } })).toBe(false);
  });

  it("attaches 1) character sheets 2) scene picture and backgrounds 3) the sketches, and says what each is for", () => {
    const h = buildVideoHandoff(board());
    expect(h.references.map((r) => r.assetId)).toEqual(["sheet-1", "sheet-2", "scene-1", "bg-1", "sk-1", "combo:sk-2+sk-3", "sk-4"]);
    expect(h.prompt).toContain("1. character design sheet of 아스파샤 — face, hair, body and costume design only");
    expect(h.prompt).toContain("3. scene picture — the world, its light and the finished art style; not the composition");
    expect(h.prompt).toContain("4. background / asset reference — the place, props and architecture");
    expect(h.prompt).toContain("5. panel 1 — rough storyboard sketch");
    expect(h.prompt).toContain("6. panels 2, 3 side by side, left to right — rough storyboard sketches");
    expect(h.prompt).toContain("take from them only each panel's composition, where everyone stands, their poses and the camera framing");
    expect(h.prompt).toContain("never as line art");
    expect(h.prompt).toContain("Composition, blocking and camera: as in reference image 6 (right frame) (rough sketch).");
    expect(h.startFrame).toContain("① 캐릭터 시트 ② 장면 그림·배경·에셋 ③ 러프 콘티");
  });

  it("needs no finished panel images: step 2 and the render check look at the sketches", () => {
    const d = board();
    const warns = stepIssues(d, 1).filter((i) => i.level === "warn").map((i) => i.message).join(" ");
    expect(warns).not.toContain("그림이 없는 컷");
    const checks = preRenderCheck(d, buildVideoHandoff(d));
    expect(checks.some((i) => i.area === "콘티 방식" && i.level === "ok")).toBe(true);
    expect(checks.some((i) => i.area === "표정 그림")).toBe(false);
  });
});
