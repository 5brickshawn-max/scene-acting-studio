import { keepPainted, ACTING_EN } from "@/lib/domain/handoff";
import { describe, expect, it } from "vitest";
import { addCastMember, shotsOf, approve, canApprove, createProjectData, imageAspectFor, MAX_CAST, MAX_CAST_STORYBOARD, parseProjectData, stepIssues, type ProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildFrameHandoff, buildVideoHandoff, cameraTextMoves } from "@/lib/domain/handoff";
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
    expect(first.prompt).toContain("One finished 16:9 frame of the animation (moment 1 of 4 in this scene)");
    expect(first.prompt).toContain("never a storyboard sheet, a grid");
    expect(first.prompt).toContain("Named characters (each keeps their identity exactly as in the scene reference; never mix features between them): 칼리엘라 — 진홍색 꼬임 머리, 엘프 귀; 브람 — 은발 단발, 검은 갑옷.");
    expect(first.prompt).toContain("Crowd and background people (unnamed): 횃불을 든 상인과 구경꾼 수십 명.");
    expect(first.prompt).toContain("This moment: 횃불을 든 군중이 좌우로 갈라진다.");
    expect(first.prompt).toContain("FRAMING OF THIS PANEL (follow it over every reference picture): 와이드 하이앵글.");
    expect(first.prompt).toContain("NOT for its composition, camera angle, framing or poses");
    expect(first.prompt).not.toContain("is speaking");
    expect(first.prompt).not.toMatch(/screen-left|Blocking/);
    expect(second.references.map((r) => r.assetId)).toEqual(["scene-1", "sketch-2", "panel-0"]);
    expect(second.prompt).toContain("Image reference 2 is a rough storyboard sketch of this panel: follow its composition");
    expect(second.prompt).toContain("Image reference 3 is the panel just before this one (panel 1)");
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
      continuity: "",
      panels: d.expressions.map((_, i) => ({ title: `T${i}`, action: `A${i}`, camera: `C${i}`, state: "", principles: [], speaker: i === 3 ? 2 : 0, link: i === 3 ? "cut" : "continuous" })),
    });
    const next = applyStoryboard(d, out, [0, 3]);
    expect(next.expressions[0]).toMatchObject({ emotion: "T0", action: "A0", camera: "C0" });
    expect(next.expressions[1].action).toBe(d.expressions[1].action);
    expect(next.expressions[3].characterId).toBe(d.cast[1].id);
    expect(next.expressions[3].link).toBe("cut");

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
    expect(englishStale(d)).toEqual(["감정 흐름", "1번 컷"]);
  });

  it("tells Claude it is a storyboard and offers storyboard proposals in the chat", () => {
    const ctx = projectContext(market(), 1);
    expect(ctx).toContain("통제 방식: 스토리보드");
    expect(ctx).toContain("군중·배경 인물: 횃불을 든 상인과 구경꾼 수십 명");
    expect(ctx).toContain("컷 2: [이어짐] 칼리엘라 등장 · 장면 묘사: 그 사이로 칼리엘라가 걸어 나온다.");
    const panels = { summary: "", continuity: "", panels: [{ title: "t", action: "a", camera: "c", state: "", principles: [], speaker: 0, link: "continuous" }] };
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
    expect(h.lengthTarget).toBe(3500 + 3 * 200 + (h.constraints.length - 700) + 150 + keepPainted(d.style).length + ACTING_EN.length + 150);
    expect(h.prompt.length).toBeLessThanOrEqual(h.lengthTarget);
  });

  it("cuts panels into shots where the team marks a cut (컷 분할)", () => {
    const d = market();
    d.expressions[1].link = "cut";
    d.expressions[3].link = "cut";
    expect(shotsOf(d).map((sh) => sh.map((id) => d.expressions.findIndex((e) => e.id === id) + 1))).toEqual([[1], [2, 3], [4]]);
    // the first panel never cuts
    d.expressions[0].link = "cut";
    expect(shotsOf(d)).toHaveLength(3);

    d.expressions[2].action = "다음 컷으로 넘어가며 브람이 앞으로 나선다.";
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain("edited in 3 shots: shot 1 = panel 1; shot 2 = panels 2–3; shot 3 = panel 4. Cut ONLY where a beat says HARD CUT");
    expect(h.prompt).not.toContain("ONE single continuous shot");
    expect(h.prompt).toContain("panel 2 — 칼리엘라 등장 (shot 2)\nHARD CUT to a new shot here.");
    expect(h.prompt).toContain("panel 3 — 브람의 경고 (shot 2)\nSame shot: the camera moves on continuously from the previous panel, no cut.");
    // talk of cuts is kept as written when the scene is cut on purpose
    expect(h.prompt).toContain("다음 컷으로 넘어가며");
    expect(h.adjustments.some((a) => a.rule.includes("‘컷’"))).toBe(false);
    expect(preRenderCheck(d, h).find((i) => i.area === "컷 분할")?.text).toContain("3개 쇼트");

    const imgs = buildExpressionHandoffs(d);
    expect(imgs[1].prompt).toContain("ONE scene of 3 shots");
    expect(imgs[1].prompt).toContain("This panel is in shot 2 and opens it with a hard cut");
    expect(imgs[2].prompt).toContain("This panel is in shot 2.");
  });

  it("keeps one continuous shot (and rewrites stray cut talk) when nothing is cut", () => {
    const d = market();
    d.expressions[2].action = "다음 컷으로 넘어가며 브람이 앞으로 나선다.";
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain("ONE single continuous shot with no cuts");
    expect(h.prompt).not.toContain("HARD CUT");
    expect(h.prompt).not.toContain("다음 컷으로");
  });

  it("joins consecutive panels side by side instead of leaving any out when there are too many", () => {
    const d = createProjectData("많은 컷", 1, "storyboard");
    d.baseAssetId = "scene-1";
    d.expressionSetup.count = 8;
    d.expressions = Array.from({ length: 8 }, (_, i) => ({ ...d.expressions[i % d.expressions.length], id: `p${i}`, action: "x", imageAssetId: `img-${i}` }));
    d.acting.segments = d.expressions.map((e, i) => ({ expressionId: e.id, start: i, end: i + 1, transition: "" }));
    d.acting.duration = 8;
    const refs = buildVideoHandoff(d).references;
    // 8 panels, 6 slots: two pairs; first and last stay alone
    expect(refs.map((r) => r.assetId)).toEqual(["scene-1", "img-0", "combo:img-1+img-2", "combo:img-3+img-4", "img-5", "img-6", "img-7"]);
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain("3. panels 2, 3 side by side, left to right");
    expect(h.prompt).toContain("Frame target: reference image 3 (right frame).");
    expect(h.prompt).toContain("never show a split screen");
    const items = preRenderCheck(d, h).filter((i) => i.area === "참고 그림 수");
    expect(items.map((i) => i.level)).toEqual(["ok"]);
    expect(items[0].text).toContain("2·3번 컷 (나란히 2장)");
  });

  it("drops the least useful panels only past three per combined image", () => {
    const d = createProjectData("아주 많은 컷", 1, "storyboard");
    d.baseAssetId = "scene-1";
    d.expressions = Array.from({ length: 20 }, (_, i) => ({ ...d.expressions[i % d.expressions.length], id: `p${i}`, action: "x", imageAssetId: `img-${i}` }));
    d.acting.segments = d.expressions.map((e, i) => ({ expressionId: e.id, start: i, end: i + 1, transition: "" }));
    d.acting.duration = 20;
    const refs = buildVideoHandoff(d).references;
    expect(refs).toHaveLength(7);
    const shown = refs.flatMap((r) => r.parts?.map((p) => p.assetId) ?? (r.role === "expression" ? [r.assetId] : []));
    expect(shown).toHaveLength(18);
    expect(shown).toContain("img-0");
    expect(shown).toContain("img-19");
    expect(refs.every((r) => (r.parts?.length ?? 1) <= 3)).toBe(true);
  });

  it("voice-over lines are heard, not spoken on screen (auto from the delivery, or set by hand)", () => {
    const d = market();
    d.dialogue.lines[1].delivery = "샤리의 V.O.(속마음)입니다. 낮게.";
    let p = buildVideoHandoff(d).prompt;
    expect(p).toContain('칼리엘라 is heard in voice-over (heard over the picture, lips closed) (English): "Step aside."');
    expect(p).toContain('브람 says exactly (English): "Not one step further!"');
    expect(p).toContain("Lines marked voice-over are heard over the picture; nobody lip-syncs them.");
    d.dialogue.lines[2].vo = true;
    p = buildVideoHandoff(d).prompt;
    expect(p).toContain("Dialogue: every line is voice-over");
    d.dialogue.lines[1].vo = false;
    expect(buildVideoHandoff(d).prompt).toContain('칼리엘라 says exactly (English): "Step aside."');
  });

  it("locked framings are not a camera move; motion words in a camera field are", () => {
    expect(cameraTextMoves("Ultra-wide eye-level locked shot; only the heat haze moves.")).toBe(false);
    expect(cameraTextMoves("수직 완전 부감 와이드 고정 샷")).toBe(false);
    expect(cameraTextMoves("칼리엘라 쪽으로 다가감")).toBe(true);
    expect(cameraTextMoves("slow push-in toward her face")).toBe(true);
    const d = market();
    d.expressions.forEach((e) => (e.camera = "고정 샷"));
    const h = buildVideoHandoff(d);
    expect(h.cameraMove).toBe(false);
    expect(h.prompt).not.toContain("HANDHELD as in the Constraints");
  });

  it("fits nine panels (the reported case) by joining panels of the same shot first", () => {
    const d = createProjectData("많은 컷", 1, "storyboard");
    d.baseAssetId = "scene-1";
    d.expressionSetup.count = 9;
    d.expressions = Array.from({ length: 9 }, (_, i) => ({ ...d.expressions[i % d.expressions.length], id: `p${i}`, action: "x", imageAssetId: `img-${i}`, link: [1, 2, 3, 4, 6, 7].includes(i) ? ("cut" as const) : ("continuous" as const) }));
    d.acting.segments = d.expressions.map((e, i) => ({ expressionId: e.id, start: i, end: i + 1, transition: "" }));
    d.acting.duration = 9;
    d.dialogue.lines = [{ expressionId: "p7", line: "Surely…", meaning: "", delivery: "" }];
    const imgs = buildVideoHandoff(d).references.filter((r) => r.role === "expression").map((r) => r.assetId);
    // 9 panels in 6 images: panels of one shot share an image first (5·6, 8·9), then one pair across a cut
    expect(imgs).toEqual(["img-0", "combo:img-1+img-2", "img-3", "combo:img-4+img-5", "img-6", "combo:img-7+img-8"]);
  });
});
