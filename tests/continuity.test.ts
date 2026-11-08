import { describe, expect, it } from "vitest";
import { createProjectData, setExpressionCount, type ProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildVideoHandoff } from "@/lib/domain/handoff";
import { applyStoryboard } from "@/lib/domain/apply";
import { englishStale } from "@/lib/domain/english";

const board = (): ProjectData => {
  const d = setExpressionCount(createProjectData("성문", 2, "storyboard"), 4);
  d.baseAssetId = "scene-1";
  d.cast = d.cast.map((c, i) => ({ ...c, name: ["아스파샤", "샤르휘나"][i] }));
  d.expressions = d.expressions.map((e, i) => ({ ...e, action: `순간 ${i + 1}`, camera: "미디엄", link: i === 2 ? ("cut" as const) : ("continuous" as const) }));
  return d;
};

describe("storyboard continuity (연결성)", () => {
  it("the AI's continuity rules and each panel's state are applied with the design", () => {
    const d = board();
    const out = {
      summary: "",
      continuity: "1) 아스파샤 화면 왼쪽, 샤르휘나 오른쪽 2) 성문은 왼쪽",
      panels: d.expressions.map((_, i) => ({ title: `p${i}`, action: "a", camera: "c", state: `상태 ${i + 1}`, speaker: 0, link: "continuous" as const })),
    };
    const next = applyStoryboard(d, out);
    expect(next.expressionSetup.continuity).toContain("화면 왼쪽");
    expect(next.expressions.map((e) => e.continuity)).toEqual(["상태 1", "상태 2", "상태 3", "상태 4"]);
    // picking only some panels keeps the team's rules
    expect(applyStoryboard(d, out, [0]).expressionSetup.continuity).toBe("");
  });

  it("each panel image sees the panel before it and the scene's continuity rules", () => {
    const d = board();
    d.expressionSetup.continuity = "1) 아스파샤 화면 왼쪽, 샤르휘나 오른쪽";
    d.expressions[2].continuity = "샤르휘나가 숄을 듦";
    d.expressions[1].imageAssetId = "img-2";
    d.expressions[1].imageAspect = "16:9";
    const h = buildExpressionHandoffs(d)[2];
    expect(h.references.map((r) => r.assetId)).toContain("img-2");
    expect(h.prompt).toContain("is the panel just before this one (panel 2)");
    expect(h.prompt).toContain("180° rule");
    expect(h.prompt).toContain("opens a new shot after a hard cut");
    expect(h.prompt).toContain("Continuity rules of this scene (every panel keeps them): 1) 아스파샤 화면 왼쪽");
    expect(h.prompt).toContain("Continuity at this moment: 샤르휘나가 숄을 듦.");
    // the first panel has nothing before it
    expect(buildExpressionHandoffs(d)[0].prompt).not.toContain("panel just before");
  });

  it("the video prompt carries the rules and each beat's state", () => {
    const d = board();
    d.expressionSetup.continuity = "1) 아스파샤 화면 왼쪽";
    d.expressions[0].continuity = "둘이 마주 봄";
    const p = buildVideoHandoff(d).prompt;
    expect(p).toContain("Continuity rules (keep them in every shot): 1) 아스파샤 화면 왼쪽");
    expect(p).toContain("Across each HARD CUT the screen sides, eyelines, costumes, props and light carry on.");
    expect(p).toContain("Continuity: 둘이 마주 봄.");
  });

  it("changed rules make the English out of date", () => {
    const d = board();
    d.english = { language: { text: "", key: "" }, style: { text: "", key: "" }, continuity: { text: "", key: "" }, cast: [], beats: [] };
    d.expressionSetup.continuity = "1) 규칙";
    expect(englishStale(d)).toContain("연결 규칙");
  });
});
