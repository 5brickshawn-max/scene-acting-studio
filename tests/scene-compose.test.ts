import { describe, expect, it } from "vitest";
import { canApprove, createProjectData, shotsOf, stepIssues, updatePerformance } from "@/lib/domain/project";
import { applyComposition, composeStructure } from "@/lib/domain/apply";
import { buildExpressionHandoffs, buildSceneImageHandoff, buildVideoHandoff } from "@/lib/domain/handoff";
import { SceneComposeOut, JOB_STEP } from "@/lib/ai/schemas";

const OUT = SceneComposeOut.parse({
  summary: "광장 대치 장면",
  characters: [
    { name: "칼리엘라", locks: "1. 진홍색 꼬임 머리", appearance: "갈색 피부, 큰 키", outfit: "진홍 드레이프", voice: "낮은 알토" },
    { name: "브람", locks: "1. 은발 단발", appearance: "창백한 피부", outfit: "검은 갑옷", voice: "맑은 테너" },
    { name: "세라", locks: "1. 짧은 녹색 머리", appearance: "작은 체구", outfit: "상인 앞치마", voice: "" },
  ],
  extras: "횃불을 든 군중 수십 명",
  style: "굵은 외곽선의 2D 셀 채색",
  opening: "해 질 녘 광장, 군중 사이로 칼리엘라가 걸어 나오고 브람이 막아선다. 세라는 노점 뒤에서 지켜본다.",
  questions: ["칼리엘라의 키를 브람보다 크게 정했습니다, 맞나요?"],
  scenario: "",
  duration: 16,
  shots: [
    { title: "광장 와이드", seconds: 4, panels: ["군중이 술렁이는 광장", "카메라가 다가가 칼리엘라를 찾음"] },
    { title: "칼리엘라 클로즈업", seconds: 2, panels: ["칼리엘라의 눈"] },
    { title: "대치", seconds: 10, panels: ["브람이 막아섬", "두 사람의 투샷", "칼리엘라가 한 걸음"] },
  ],
});

describe("씬 구성 (scene composed from the scenario)", () => {
  it("is a step-1 AI job", () => {
    expect(JOB_STEP.compose_scene).toBe(0);
  });

  it("replaces the named cast in order, keeping each member's id, picture and voice", () => {
    let d = createProjectData("광장", 2, "storyboard");
    d.cast[0] = { ...d.cast[0], name: "칼리", voice: "팀이 정한 목소리", refAssetId: "ref-a" };
    const keep = d.cast[0].id;
    d.expressionSetup.scene = "칼리엘라 : “Step aside.”";
    d = applyComposition(d, OUT, ["cast", "style", "extras", "opening", "questions"]);
    expect(d.cast.map((c) => c.name)).toEqual(["칼리엘라", "브람", "세라"]);
    expect(d.cast[0]).toMatchObject({ id: keep, refAssetId: "ref-a", voice: "팀이 정한 목소리", outfit: "진홍 드레이프" });
    expect(d.cast[1].voice).toBe("맑은 테너");
    expect(d.style).toBe("굵은 외곽선의 2D 셀 채색");
    expect(d.extras).toBe("횃불을 든 군중 수십 명");
    expect(d.opening).toContain("해 질 녘 광장");
    expect(d.cast[0].questions.map((q) => q.question)).toEqual(["칼리엘라의 키를 브람보다 크게 정했습니다, 맞나요?"]);
    // every beat still names an existing character and has one performance per other character
    expect(d.expressions.every((e) => d.cast.some((c) => c.id === e.characterId) && e.reactions.length === 2)).toBe(true);
  });

  it("caps the cast at the mode's limit and leaves unpicked parts alone", () => {
    const d = createProjectData("둘", 1, "cast");
    d.style = "기존 그림체";
    const many = { ...OUT, characters: [...OUT.characters, ...OUT.characters] };
    const next = applyComposition(d, many, ["cast"]);
    expect(next.cast).toHaveLength(4);
    expect(next.style).toBe("기존 그림체");
    expect(next.opening).toBe("");
  });

  it("drops beats' acting for characters that are gone", () => {
    let d = createProjectData("넷", 4, "cast");
    d.expressions[0] = updatePerformance(d.expressions[0], d.cast[3].id, { emotion: "x" });
    d = applyComposition(d, { ...OUT, characters: OUT.characters.slice(0, 2) }, ["cast"]);
    expect(d.cast).toHaveLength(2);
    expect(d.expressions.every((e) => e.reactions.length === 1)).toBe(true);
  });

  it("asks for a scene picture (uploaded or generated) before step 1 can be approved", () => {
    let d = applyComposition(createProjectData("광장", 1, "storyboard"), OUT, ["cast", "style", "opening"]);
    d.cast = d.cast.map((c) => ({ ...c, appearance: c.appearance || "외형" }));
    expect(stepIssues(d, 0).map((i) => i.message)).toContain("장면 기준 그림을 올리거나 시나리오로 첫 장면을 생성하세요.");
    d = { ...d, baseAssetId: "generated-1" };
    expect(canApprove(d, 0)).toBe(true);
  });
});

describe("첫 장면 (opening scene picture drawn from the scenario)", () => {
  it("draws every named character clearly in the scene's world, with their material as references", () => {
    let d = createProjectData("광장", 2, "storyboard");
    d = applyComposition(d, OUT, ["cast", "style", "extras", "opening"]);
    d.cast[1] = { ...d.cast[1], refAssetId: "ref-bram" };
    const h = buildSceneImageHandoff(d);
    expect(h.aspectRatio).toBe("16:9");
    expect(h.references.map((r) => r.assetId)).toEqual(["ref-bram"]);
    expect(h.prompt).toContain("Opening frame of an animated scene, 16:9");
    expect(h.prompt).toContain("draw every named character clearly");
    expect(h.prompt).toContain("- 브람: 1. 은발 단발 창백한 피부. Outfit: 검은 갑옷 Image reference 1 is their design sheet: copy face, hair colour and hairstyle");
    // the picture beats the written description (which may be an old AI guess)
    expect(h.prompt).toContain("where the text above differs, the design sheet wins");
    expect(h.prompt).toContain("Crowd and background people (unnamed): 횃불을 든 군중 수십 명.");
    expect(h.prompt).toContain("The moment: 해 질 녘 광장");
  });

  it("uses the screen positions in character-by-character mode and a portrait for one character", () => {
    let d = createProjectData("둘", 2, "cast");
    d = applyComposition(d, { ...OUT, characters: OUT.characters.slice(0, 2) }, ["cast", "style", "opening"]);
    const h = buildSceneImageHandoff(d);
    expect(h.prompt).toContain("- 칼리엘라 (screen-left):");
    expect(h.prompt).toContain("Background: plain and light");
    const solo = applyComposition(createProjectData("혼자"), { ...OUT, characters: OUT.characters.slice(0, 1) }, ["cast", "style"]);
    const s = buildSceneImageHandoff(solo);
    expect(s.aspectRatio).toBe("3:4");
    expect(s.prompt).toContain("Single character illustration of ONE character, portrait 3:4");
  });
});

describe("쇼트 구성 (shots and panels proposed by the scene composition)", () => {
  it("sets the panel count, titles, cut links and the time split for a storyboard", () => {
    const d = applyComposition(createProjectData("광장", 2, "storyboard"), OUT, ["structure"]);
    expect(d.expressionSetup.count).toBe(6);
    expect(d.expressions.map((e) => e.emotion)).toEqual(["군중이 술렁이는 광장", "카메라가 다가가 칼리엘라를 찾음", "칼리엘라의 눈", "브람이 막아섬", "두 사람의 투샷", "칼리엘라가 한 걸음"]);
    expect(d.expressions.map((e) => e.link)).toEqual(["continuous", "continuous", "cut", "cut", "continuous", "continuous"]);
    expect(shotsOf(d)).toHaveLength(3);
    expect(d.acting.duration).toBe(16);
    // each shot's seconds are shared by its panels: 2 + 2 | 2 | 3.3 + 3.3 + 3.4
    expect(d.acting.segments.map((x) => x.end)).toEqual([2, 4, 6, 9.3, 12.7, 16]);
    expect(d.expressions.every((e) => e.reactions.length === 1)).toBe(true);
  });

  it("keeps character-by-character scenes in one shot: the panels become beats", () => {
    const d = applyComposition(createProjectData("둘", 2, "cast"), OUT, ["structure"]);
    expect(d.expressionSetup.count).toBe(6);
    expect(d.expressions.every((e) => e.link === "continuous")).toBe(true);
    expect(d.expressions[2].notes).toBe("칼리엘라의 눈");
    expect(d.acting.duration).toBe(16);
  });

  it("caps at 6 storyboard panels and 60 seconds, and leaves the structure alone when not picked", () => {
    const big = { ...OUT, duration: 90, shots: Array.from({ length: 5 }, (_, k) => ({ title: `s${k}`, seconds: 18, panels: ["a", "b", "c"] })) };
    const st = composeStructure({ mode: "storyboard" }, big);
    // no limit on shots: five proposed shots stay five
    expect(st).toMatchObject({ shots: 2, total: 15, clipped: true, duration: 60 }); // the first 6 panels cover two shots
    expect(st.panels).toHaveLength(6);
    const before = createProjectData("x", 1, "storyboard");
    expect(applyComposition(before, OUT, ["style"]).expressionSetup.count).toBe(before.expressionSetup.count);
  });
});

describe("references are always explained", () => {
  it("tells the panel and scene prompts what a character's design sheet and the extra references are", () => {
    let d = createProjectData("사막", 1, "storyboard");
    d = applyComposition(d, { ...OUT, characters: OUT.characters.slice(0, 1) }, ["cast", "style", "opening", "structure"]);
    d.baseAssetId = "scene-1";
    d.cast[0] = { ...d.cast[0], refAssetId: "sheet-1" };
    // the same sheet uploaded as an extra reference too: attached once
    d.designRefAssetIds = ["sheet-1", "prop-1"];
    const panel = buildExpressionHandoffs(d)[0];
    expect(panel.references.map((r) => r.assetId)).toEqual(["scene-1", "sheet-1", "prop-1"]);
    expect(panel.prompt).toContain("Image reference 2 is the design sheet of 칼리엘라: copy their face, hair colour and hairstyle, costume (colours, shapes, accessories) and proportions exactly from it — where the text describes them differently, the design sheet wins");
    expect(panel.prompt).toContain("Image reference 3 is extra design reference for this scene");
    const scene = buildSceneImageHandoff(d);
    expect(scene.references.map((r) => r.assetId)).toEqual(["sheet-1", "prop-1"]);
    expect(scene.prompt).toContain("Image reference 2 is extra design reference for this scene");
    // video references: the scene picture labelled as such in storyboard mode
    expect(buildVideoHandoff(d).references[0].label).toContain("scene reference");
  });

  it("uses a character's design sheet in character-by-character mode too", () => {
    let d = createProjectData("둘", 2, "cast");
    d = applyComposition(d, { ...OUT, characters: OUT.characters.slice(0, 2) }, ["cast", "style"]);
    d.baseAssetId = "scene-1";
    d.cast[1] = { ...d.cast[1], refAssetId: "sheet-b" };
    const p = buildExpressionHandoffs(d)[0];
    expect(p.references.map((r) => r.assetId).slice(0, 2)).toEqual(["scene-1", "sheet-b"]);
    expect(p.prompt).toContain("Image reference 2 is the design sheet of 브람");
  });
});


describe("확인 답변 반영 (answers to the AI's questions)", () => {
  it("a scenario revised from the answers is applied when picked, and asked questions are not added again", () => {
    let d = createProjectData("정원", 2, "storyboard");
    d.expressionSetup.scene = "횃불 하나 없는 정원";
    d.cast[1] = { ...d.cast[1], questions: [{ question: "칼리엘라의 키를 브람보다 크게 정했습니다, 맞나요?", answer: "네" }] };
    const out = { ...OUT, scenario: "횃불이 켜진 정원" };
    const next = applyComposition(d, out, ["scenario", "questions"]);
    expect(next.expressionSetup.scene).toBe("횃불이 켜진 정원");
    expect(next.cast.flatMap((c) => c.questions).filter((q) => q.question.startsWith("칼리엘라의 키"))).toHaveLength(1);
    d = applyComposition(d, out, ["style"]);
    expect(d.expressionSetup.scene).toBe("횃불 하나 없는 정원");
  });
});
