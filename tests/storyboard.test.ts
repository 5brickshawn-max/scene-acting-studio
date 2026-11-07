import { describe, expect, it } from "vitest";
import { addCastMember, approve, canApprove, createProjectData, imageAspectFor, MAX_CAST, MAX_CAST_STORYBOARD, parseProjectData, stepIssues, type ProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildFrameHandoff, buildVideoHandoff } from "@/lib/domain/handoff";
import { applyStoryboard } from "@/lib/domain/apply";
import { buildEnglishSheet, englishStale } from "@/lib/domain/english";
import { preRenderCheck } from "@/lib/domain/check";
import { projectContext } from "@/lib/ai/prompts";
import { consultSchemaFor, StoryboardOut } from "@/lib/ai/schemas";

/** A crowd scene: two named characters, a market crowd, four panels. */
function market(): ProjectData {
  const d = createProjectData("광장의 대치", 2, "storyboard");
  d.baseAssetId = "scene-1";
  d.cast = [
    { ...d.cast[0], name: "칼리엘라", locks: "1. 진홍색 꼬임 머리\n2. 엘프 귀", appearance: "짙은 갈색 피부", voice: "낮은 알토" },
    { ...d.cast[1], name: "브람", locks: "1. 은발 단발\n2. 검은 갑옷", appearance: "창백한 피부", voice: "맑은 테너" },
  ];
  d.extras = "횃불을 든 상인과 구경꾼 수십 명";
  d.style = "굵은 외곽선의 2D 셀 채색";
  d.dialogue.language = "영어";
  d.expressionSetup.count = 4;
  d.expressions = d.expressions.slice(0, 4).map((e, i) => ({
    ...e,
    characterId: d.cast[i < 2 ? 0 : 1].id,
    emotion: ["군중이 갈라짐", "칼리엘라 등장", "브람의 경고", "대치"][i],
    action: ["횃불을 든 군중이 좌우로 갈라진다.", "그 사이로 칼리엘라가 걸어 나온다.", "브람이 칼자루를 쥐고 앞으로 나선다.", "두 사람이 마주 선다."][i],
    camera: ["와이드 하이앵글", "칼리엘라 쪽으로 다가감", "브람 미디엄 샷으로", "두 사람을 담는 투샷"][i],
    imageAssetId: `panel-${i}`,
    imageFraming: "medium",
    imageAspect: "16:9",
  }));
  d.acting.duration = 8;
  d.acting.segments = d.expressions.map((e, i) => ({ expressionId: e.id, start: i * 2, end: i * 2 + 2, transition: "" }));
  d.dialogue.lines = d.expressions.map((e, i) => ({ expressionId: e.id, line: ["", "Step aside.", "Not one step further!", ""][i], meaning: "", delivery: "" }));
  return d;
}

describe("storyboard mode (스토리보드 · 컷 단위)", () => {
  it("starts with six panels at the video's aspect ratio, even for one character", () => {
    const d = createProjectData("혼자", 1, "storyboard");
    expect(d.mode).toBe("storyboard");
    expect(d.expressions).toHaveLength(6);
    expect(imageAspectFor(d)).toBe("16:9");
    expect(createProjectData().mode).toBe("cast");
    // older data has no mode: character-by-character
    expect(parseProjectData({ ...createProjectData(), mode: undefined }).mode).toBe("cast");
  });

  it("asks for a description (or a sketch) per panel instead of per-character acting", () => {
    let d = approve(market(), 0);
    expect(canApprove(d, 1)).toBe(true);
    d.expressions[2].action = "";
    expect(stepIssues(d, 1).map((i) => i.message)).toContain("3번 컷: 장면 묘사를 쓰거나 러프 스케치를 올리세요.");
    d.expressions[2].sketchAssetId = "sketch-3";
    expect(canApprove(d, 1)).toBe(true);
    // no direction or emotion checks, and no fixed positions to clash
    d = market();
    d.cast[1].position = d.cast[0].position;
    expect(stepIssues(d, 0).map((i) => i.message).join(" ")).not.toContain("화면 위치");
  });

  it("draws each panel as one finished picture of the whole moment, with the crowd and the sketch", () => {
    const d = market();
    d.expressions[1].sketchAssetId = "sketch-2";
    const [first, second] = buildExpressionHandoffs(d);
    expect(first.aspectRatio).toBe("16:9");
    expect(first.prompt).toContain("Storyboard panel 1 of 4, drawn as a finished 16:9 frame");
    expect(first.prompt).toContain("Named characters (each keeps their identity exactly as in the scene reference; never mix features between them): 칼리엘라 — 진홍색 꼬임 머리, 엘프 귀; 브람 — 은발 단발, 검은 갑옷.");
    expect(first.prompt).toContain("Crowd and background people (unnamed): 횃불을 든 상인과 구경꾼 수십 명.");
    expect(first.prompt).toContain("This moment: 횃불을 든 군중이 좌우로 갈라진다.");
    expect(first.prompt).toContain("Camera: 와이드 하이앵글.");
    expect(first.prompt).not.toContain("is speaking");
    expect(first.prompt).not.toMatch(/screen-left|Blocking/);
    expect(second.references.map((r) => r.assetId)).toEqual(["scene-1", "sketch-2", "panel-0"]);
    expect(second.prompt).toContain("Image reference 2 is a rough storyboard sketch of this panel: follow its composition");
    expect(second.prompt).toContain("Image reference 3 is panel 1 of this same shot");
    expect(second.prompt).toContain("칼리엘라 is speaking in this moment");
  });

  it("builds a video prompt that follows the panels in one continuous take", () => {
    const d = market();
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain("The beats below follow storyboard panels — successive moments of this same shot; the camera travels continuously");
    expect(h.prompt).toContain("2. 2–4 seconds: panel 2 — 칼리엘라 등장\nFrame target: reference image 3.\nAction: 그 사이로 칼리엘라가 걸어 나온다.\nCamera: 칼리엘라 쪽으로 다가감.");
    expect(h.prompt).toContain('칼리엘라 says exactly (English): "Step aside."');
    expect(h.prompt).toContain('브람 says exactly (English): "Not one step further!"');
    expect(h.prompt).toContain("Crowd sound only as quiet natural ambience, never words.");
    expect(h.prompt).toContain("1. scene reference drawing — named characters, style and world; identity only");
    expect(h.cameraMove).toBe(true);
    expect(h.prompt.endsWith(h.constraints)).toBe(true);
    expect(h.prompt.length).toBeLessThanOrEqual(h.lengthTarget);
    expect(preRenderCheck(d, h).find((i) => i.area === "출연진")?.text).toContain("스토리보드 방식");
  });

  it("draws start/end frames from a panel", () => {
    const d = market();
    const f = buildFrameHandoff(d, d.expressions[3].id, "bust");
    expect(f.references.map((r) => r.assetId)).toEqual(["scene-1", "panel-3"]);
    expect(f.prompt).toContain("Image reference 2 is the exact moment to draw");
  });

  it("applies the AI's panels and uses English panels where they are fresh", () => {
    const d = market();
    const out = StoryboardOut.parse({
      summary: "",
      panels: d.expressions.map((_, i) => ({ title: `T${i}`, action: `A${i}`, camera: `C${i}`, speaker: i === 3 ? 2 : 0 })),
    });
    const next = applyStoryboard(d, out, [0, 3]);
    expect(next.expressions[0]).toMatchObject({ emotion: "T0", action: "A0", camera: "C0" });
    expect(next.expressions[1].action).toBe(d.expressions[1].action);
    expect(next.expressions[3].characterId).toBe(d.cast[1].id);

    d.english = buildEnglishSheet(d, {
      language: "English",
      style: "Bold outlines.",
      cast: [
        { character: 1, look: ["crimson locks"], outfit: "", voice: "Low alto." },
        { character: 2, look: ["silver bob"], outfit: "", voice: "Clear tenor." },
      ],
      beats: d.expressions.map((_, i) => ({ panel: i + 1, emotion: `Panel ${i + 1}`, face: `The crowd parts ${i}.`, body: `Wide shot ${i}.`, transition: "", delivery: "" })),
    });
    expect(englishStale(d)).toEqual([]);
    expect(buildVideoHandoff(d).prompt).toContain("Action: The crowd parts 1.\nCamera: Wide shot 1.");
    d.expressions[0].camera = "다른 카메라";
    expect(englishStale(d)).toEqual(["1번 컷"]);
  });

  it("tells Claude it is a storyboard and offers storyboard proposals in the chat", () => {
    const ctx = projectContext(market(), 1);
    expect(ctx).toContain("통제 방식: 스토리보드");
    expect(ctx).toContain("군중·배경 인물: 횃불을 든 상인과 구경꾼 수십 명");
    expect(ctx).toContain("컷 2: 칼리엘라 등장 · 장면 묘사: 그 사이로 칼리엘라가 걸어 나온다.");
    const panels = { summary: "", panels: [{ title: "t", action: "a", camera: "c", speaker: 0 }] };
    expect(consultSchemaFor(1, true).safeParse({ reply: "", proposal: panels }).success).toBe(true);
    expect(consultSchemaFor(1, false).safeParse({ reply: "", proposal: panels }).success).toBe(false);
  });

  it("takes up to eight named characters; character-by-character mode stays at four", () => {
    expect(MAX_CAST_STORYBOARD).toBe(8);
    let d = createProjectData("대연회", 6, "storyboard");
    expect(d.cast).toHaveLength(6);
    expect(createProjectData("x", 9, "storyboard").cast).toHaveLength(8);
    expect(createProjectData("x", 6, "cast").cast).toHaveLength(MAX_CAST);
    d = addCastMember(addCastMember(addCastMember(d)));
    expect(d.cast).toHaveLength(8);
    expect(d.cast[0].position).toBe("left");
    expect(d.cast[7].position).toBe("right");
    // survives saving and loading
    expect(parseProjectData(JSON.parse(JSON.stringify(d))).cast).toHaveLength(8);
    // switching such a scene to character-by-character mode cannot be approved
    d.cast = d.cast.map((c, i) => ({ ...c, name: `인물${i + 1}`, locks: "1. 특징", appearance: "외형" }));
    d.baseAssetId = "scene-1";
    d.style = "2D";
    expect(canApprove(d, 0)).toBe(true);
    expect(stepIssues({ ...d, mode: "cast" }, 0).map((i) => i.message).join(" ")).toContain("인물별 연기 방식의 출연진은 1~4명");
  });

  it("keeps a big named cast short in the prompts and gives the video prompt more room", () => {
    const d = market();
    const extra = ["세라", "도윤", "미라", "카이", "루엔"];
    d.cast = [...d.cast, ...extra.map((name) => ({ ...d.cast[0], id: name, name, locks: "1. 첫째 특징\n2. 둘째 특징\n3. 셋째 특징" }))];
    const p = buildExpressionHandoffs(d)[0].prompt;
    expect(p).toContain("세라 — 첫째 특징, 둘째 특징;");
    expect(p).not.toContain("셋째 특징");
    const h = buildVideoHandoff(d);
    expect(h.lengthTarget).toBe(3500 + 3 * 200);
    expect(h.prompt.length).toBeLessThanOrEqual(h.lengthTarget);
  });
});
