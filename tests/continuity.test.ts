import { describe, expect, it } from "vitest";
import { createProjectData, setExpressionCount, type ProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildVideoHandoff } from "@/lib/domain/handoff";
import { applyActing, applyStoryboard } from "@/lib/domain/apply";
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
      panels: d.expressions.map((_, i) => ({ title: `p${i}`, action: "a", camera: "c", state: `상태 ${i + 1}`, principles: [], speaker: 0, link: "continuous" as const })),
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
    expect(h.prompt).toContain("still one single frame): 샤르휘나가 숄을 듦.");
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
    d.english = { language: { text: "", key: "" }, style: { text: "", key: "" }, continuity: { text: "", key: "" }, arc: { text: "", key: "" }, cast: [], beats: [] };
    d.expressionSetup.continuity = "1) 규칙";
    expect(englishStale(d)).toContain("연결 규칙");
  });
});

describe("step 4 keeps the storyboard order", () => {
  it("an AI timing that reorders panels only changes their lengths", () => {
    const d = board();
    const ids = d.expressions.map((e) => e.id);
    const out = { segments: [4, 3, 2, 1].map((panel, k) => ({ panel, start: k * 2, end: k * 2 + 2, transition: "" })) } as Parameters<typeof applyActing>[1];
    const next = applyActing(d, out);
    expect(next.acting.segments.map((s) => s.expressionId)).toEqual(ids);
  });
});

describe("panel references follow the shot (no night picture in a dawn shot)", () => {
  it("a panel in a later shot is not given a picture from an earlier shot as its anchor, and states beat pictures", () => {
    const d = board(); // panels 1-2 shot 1, panels 3-4 shot 2 (cut before panel 3)
    d.expressions.forEach((e, i) => { e.imageAssetId = `img-${i + 1}`; e.imageAspect = "16:9"; });
    const hs = buildExpressionHandoffs(d);
    // panel 4: earlier panel of its own shot is panel 3, which is also the panel before → only that one, no panel-1 anchor
    expect(hs[3].references.map((r) => r.assetId)).not.toContain("img-1");
    expect(hs[3].references.map((r) => r.assetId)).toContain("img-3");
    // panel 3 opens a new shot: a new camera, not a copy of panel 2's composition
    expect(hs[2].prompt).toContain("a NEW camera position and framing — do not repeat that picture's composition");
    expect(hs[2].prompt).toContain("the description and continuity win");
    // a later panel of the same shot must not repeat the previous composition
    expect(hs[3].prompt).toContain("must look clearly different from that one");
    expect(hs[2].prompt).toContain("except what this moment changes (a hood taken off, hands let go");
  });
});

describe("hook-up in words and review corrections", async () => {
  const { endState } = await import("@/lib/domain/handoff");
  it("each panel starts from the previous panel's end state, and review notes go into a redraw", () => {
    expect(endState("시작: 왼쪽에 섬 / 끝: 오른쪽으로 한 걸음, 후드를 벗음")).toBe("오른쪽으로 한 걸음, 후드를 벗음");
    expect(endState("Start: left / End: hood off, hands let go")).toBe("hood off, hands let go");
    expect(endState("둘이 마주 봄")).toBe("둘이 마주 봄");
    const d = board();
    d.expressions[0].continuity = "시작: 손을 잡고 달림 / 끝: 손을 놓고 멈춤";
    const hs = buildExpressionHandoffs(d, { [d.expressions[1].id]: "후드가 다시 씌워져 있음 — 어깨에 걸친 상태로" });
    expect(hs[1].prompt).toContain("The previous panel (panel 1) ended like this — start this moment from it: 손을 놓고 멈춤.");
    expect(hs[1].prompt).toContain("Corrections from the review of the previous version of this panel (fix all of these; keep everything else): 후드가 다시 씌워져 있음");
    expect(hs[0].prompt).not.toContain("Corrections from the review");
  });
});

describe("storyboard panel limit (8)", async () => {
  const { MAX_PANELS_STORYBOARD, maxPanelsFor, stepIssues } = await import("@/lib/domain/project");
  it("storyboard and character scenes take at most eight panels", () => {
    expect(MAX_PANELS_STORYBOARD).toBe(8);
    expect(maxPanelsFor("cast")).toBe(8);
    expect(setExpressionCount(createProjectData("x", 1, "storyboard"), 10).expressions).toHaveLength(8);
    expect(setExpressionCount(createProjectData("x", 1, "cast"), 8).expressions).toHaveLength(8);
    const d = createProjectData("x", 1, "storyboard");
    const seven = { ...d, expressions: Array.from({ length: 9 }, (_, i) => ({ ...d.expressions[0], id: `p${i}` })) };
    expect(stepIssues(seven, 1).some((i) => i.level === "block" && i.message.includes("최대 8개"))).toBe(true);
  });
});

describe("scene costumes reach every panel (disguise vs design sheet)", () => {
  it("each panel prompt carries what everyone wears in this scene, and clothing follows the scene over the sheet", () => {
    const d = board();
    d.cast[1] = { ...d.cast[1], refAssetId: "sheet-2", outfit: "기본 차림: 회색 튜닉. 밤 탈출 변장: 튜닉 위에 남색 로브, 베일, 코와 입을 가리는 두건. 새벽: 변장을 벗음." };
    const p = buildExpressionHandoffs(d)[1].prompt;
    expect(p).toContain("Costumes in this scene (follow them, including disguises");
    expect(p).toContain("밤 탈출 변장: 튜닉 위에 남색 로브");
    expect(p).toContain("What they WEAR in this scene follows the scene's costume text");
    expect(p).not.toContain("costume designs always come from the design sheets");
  });
});
