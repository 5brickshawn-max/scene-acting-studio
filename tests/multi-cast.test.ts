import { describe, expect, it } from "vitest";
import {
  addCastMember,
  approve,
  canApprove,
  createProjectData,
  imageAspectFor,
  imageIsStale,
  parseProjectData,
  performancesOf,
  removeCastMember,
  setLead,
  stepIssues,
  updatePerformance,
  type ProjectData,
} from "@/lib/domain/project";
import { buildExpressionHandoffs, buildFrameHandoff, buildVideoHandoff, MAX_VIDEO_REFERENCES, videoReferences } from "@/lib/domain/handoff";
import { applyCharacter, applyDialogue, applyExpressions } from "@/lib/domain/apply";
import { buildEnglishSheet, englishStale, freshEnglish } from "@/lib/domain/english";
import { preRenderCheck } from "@/lib/domain/check";
import { applyTextFix, fixWhere, resolveFix } from "@/lib/domain/fixes";
import { projectContext } from "@/lib/ai/prompts";

/** A two-character argument scene drawn from one scene picture, every character acting in every beat. */
function duo(): ProjectData {
  const d = createProjectData("결투 직전", 2);
  const [a, b] = d.cast;
  d.baseAssetId = "scene-1";
  d.cast = [
    { ...a, name: "칼리엘라", locks: "1. 진홍색 꼬임 머리\n2. 엘프 귀", appearance: "짙은 갈색 피부", outfit: "진홍 드레이프", voice: "낮고 허스키한 알토" },
    { ...b, name: "브람", locks: "1. 은발 단발\n2. 왼눈 흉터", appearance: "창백한 피부", outfit: "검은 갑옷", voice: "젊은 남성, 맑은 테너" },
  ];
  d.style = "굵은 외곽선의 2D 셀 채색";
  d.dialogue.language = "영어";
  const leadFeelings = ["도발", "분노", "비웃음", "체념"];
  const otherFeelings = ["경계", "움찔함", "굳은 얼굴", "안도"];
  d.expressions = d.expressions.map((e, i) => {
    const lead = d.cast[i % 2].id;
    const other = d.cast[(i + 1) % 2].id;
    let x = setLead({ ...e, characterId: d.cast[0].id, reactions: [] }, lead);
    x = { ...x, emotion: leadFeelings[i], directionStatus: "confirmed", imageAssetId: `img-${i}`, imageFraming: "medium", imageAspect: "16:9" };
    return updatePerformance(x, other, { emotion: otherFeelings[i], gesture: i === 1 ? "한발 물러서며 두 손을 든다" : "", directionStatus: "confirmed" });
  });
  d.dialogue.lines = d.expressions.map((e, i) => ({ expressionId: e.id, line: ["Come closer.", "Don't you dare!", "", "Fine."][i], meaning: "", delivery: "" }));
  return d;
}

describe("a cast of several characters", () => {
  it("starts with one character by default, and with a blocked-out cast when asked", () => {
    const one = createProjectData();
    expect(one.cast).toHaveLength(1);
    expect(one.cast[0].position).toBe("center");
    expect(imageAspectFor(one)).toBe("3:4");
    expect(one.expressions[0].reactions).toEqual([]);

    const three = createProjectData("셋", 3);
    expect(three.cast.map((c) => c.position)).toEqual(["left", "center", "right"]);
    expect(three.expressionSetup.framing).toBe("medium");
    expect(three.expressions).toHaveLength(6);
    expect(three.expressions.map((e) => three.cast.findIndex((c) => c.id === e.characterId))).toEqual([0, 1, 2, 0, 1, 2]);
    // every beat already holds a performance for each of the other two
    expect(three.expressions.every((e) => e.reactions.length === 2)).toBe(true);
    expect(imageAspectFor(three)).toBe("16:9");
  });

  it("adds and removes cast members, keeping one performance per character in every beat", () => {
    let d = createProjectData("x");
    d.expressionSetup.framing = "close_up";
    d = addCastMember(d);
    expect(d.cast.map((c) => c.position)).toEqual(["left", "right"]);
    expect(d.expressionSetup.framing).toBe("medium");
    expect(d.expressions.every((e) => e.reactions.map((r) => r.characterId).join() === d.cast[1].id)).toBe(true);
    d = addCastMember(addCastMember(addCastMember(d)));
    expect(d.cast).toHaveLength(4);
    expect(d.expressions[0].reactions).toHaveLength(3);
    const gone = d.cast[1].id;
    d.expressions[0] = setLead(d.expressions[0], gone);
    d = removeCastMember(d, gone);
    expect(d.cast).toHaveLength(3);
    expect(d.cast.map((c) => c.position)).toEqual(["left", "center", "right"]);
    expect(d.expressions[0].characterId).toBe(d.cast[0].id);
    expect(d.expressions[0].reactions.map((r) => r.characterId)).toEqual([d.cast[1].id, d.cast[2].id]);
    let solo = createProjectData();
    solo = removeCastMember(solo, solo.cast[0].id);
    expect(solo.cast).toHaveLength(1);
  });

  it("switches the lead of a beat without losing anyone's acting", () => {
    const d = duo();
    const e = d.expressions[0];
    const [kal, bram] = d.cast;
    expect(e.characterId).toBe(kal.id);
    const swapped = setLead(e, bram.id);
    expect(swapped.characterId).toBe(bram.id);
    expect(swapped.emotion).toBe("경계");
    expect(swapped.reactions.find((r) => r.characterId === kal.id)?.emotion).toBe("도발");
    expect(performancesOf(d, swapped).map((p) => [p.emotion, p.lead])).toEqual([
      ["도발", false],
      ["경계", true],
    ]);
  });

  it("needs one scene picture for the whole cast and names that tell them apart", () => {
    const d = duo();
    expect(canApprove(d, 0)).toBe(true);
    d.baseAssetId = null;
    expect(stepIssues(d, 0).map((i) => i.message)).toContain("출연진이 함께 있는 장면 기준 그림을 올리세요.");
    d.baseAssetId = "scene-1";
    d.cast[1].name = "칼리엘라";
    expect(stepIssues(d, 0).map((i) => i.message).join(" ")).toContain("출연진 이름이 겹칩니다");
  });

  it("asks for every character's emotion and checked direction in every beat", () => {
    let d = approve(duo(), 0);
    expect(canApprove(d, 1)).toBe(true);
    d.expressions[2] = updatePerformance(d.expressions[2], d.cast[0].id, { emotion: "" });
    expect(stepIssues(d, 1).map((i) => i.message)).toContain("3번 표정: A 칼리엘라의 감정을 입력하세요.");
    d = approve(duo(), 0);
    d.expressions[1] = updatePerformance(d.expressions[1], d.cast[0].id, { directionStatus: "ai" });
    expect(stepIssues(d, 1).map((i) => i.message)).toContain("2번 표정 A 칼리엘라: AI가 추정한 방향을 아직 확인하지 않았습니다.");
    d = duo();
    d.expressionSetup.framing = "close_up";
    expect(stepIssues(d, 1).map((i) => i.message).join(" ")).toContain("클로즈업으로 담을 수 없습니다");
  });

  it("asks for a voice for every character who speaks", () => {
    const d = duo();
    d.cast[1].voice = "";
    expect(stepIssues(d, 2).map((i) => i.message)).toContain("B 브람의 목소리 설정을 입력하세요.");
    d.dialogue.lines = d.dialogue.lines.map((l) => (d.expressions.find((e) => e.id === l.expressionId)?.characterId === d.cast[1].id ? { ...l, line: "" } : l));
    expect(stepIssues(d, 2).map((i) => i.message).join(" ")).not.toContain("브람의 목소리");
  });

  it("treats group images as stale when they were drawn at another aspect ratio", () => {
    const d = duo();
    expect(imageIsStale(d.expressions[0], "medium", imageAspectFor(d))).toBe(false);
    d.video.aspectRatio = "9:16";
    expect(imageIsStale(d.expressions[0], "medium", imageAspectFor(d))).toBe(true);
  });
});

describe("prompts for a group scene", () => {
  it("draws each beat from the one scene picture, with every character's acting", () => {
    const d = duo();
    const [first, second] = buildExpressionHandoffs(d);
    expect(first.aspectRatio).toBe("16:9");
    expect(first.references[0].assetId).toBe("scene-1");
    expect(first.prompt).toContain("Scene frame of 2 characters together in ONE 16:9 image");
    expect(first.prompt).toContain("Image reference 1 is the scene reference drawing of the whole cast together: 칼리엘라 is the one on the screen-left side (진홍색 꼬임 머리); 브람 is the one on the screen-right side (은발 단발).");
    expect(first.prompt).toContain("the same relative heights and body sizes between the characters");
    expect(first.prompt).toContain("Acting in this moment — every character at once");
    expect(first.prompt).toMatch(/- 칼리엘라 — speaking: moderate 도발\./);
    expect(first.prompt).toMatch(/- 브람: moderate 경계\./);
    expect(first.prompt).not.toContain("no other characters");
    // the next beat: Bram leads, Kaliela's own acting is drawn too, and it matches the anchor frame
    expect(second.prompt).toMatch(/- 브람 — speaking: moderate 분노\./);
    expect(second.prompt).toMatch(/- 칼리엘라: moderate 움찔함\. .*Body: 한발 물러서며 두 손을 든다\./);
    expect(second.references.map((r) => r.assetId)).toEqual(["scene-1", "img-0"]);
  });

  it("keeps the single-character image prompt unchanged for a cast of one", () => {
    const d = createProjectData("solo");
    d.cast[0] = { ...d.cast[0], name: "A" };
    d.baseAssetId = "base-1";
    const p = buildExpressionHandoffs(d)[0].prompt;
    expect(p).toContain("Single character illustration of ONE character, portrait 3:4");
    expect(p).toContain("The character must match image reference 1 exactly");
    expect(p).not.toContain("Acting in this moment");
  });

  it("tells the video model who is where, everyone's acting per beat, who says each line, and who keeps quiet", () => {
    const d = duo();
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain("a 8-second 2-character scene, 16:9");
    expect(h.prompt).toContain("Cast (exactly these 2 characters, always in these screen positions; nobody else): 칼리엘라 (screen-left), 브람 (screen-right).");
    expect(h.prompt).toContain('칼리엘라 says exactly (English): "Come closer."');
    expect(h.prompt).toContain('브람 says exactly (English): "Don\'t you dare!"');
    expect(h.prompt).toMatch(/브람 \(경계\): 중간 강도\./);
    expect(h.prompt).toContain("while one character speaks the others keep their mouths closed");
    expect(h.prompt).toContain("Voices (each character keeps their own voice): 칼리엘라 — 낮고 허스키한 알토; 브람 — 젊은 남성, 맑은 테너.");
    expect(h.prompt).toContain("1. scene reference drawing of the whole cast — 칼리엘라 is the one on the screen-left side");
    expect(h.prompt).not.toContain("Only one character appears");
    expect(h.prompt.endsWith(h.constraints)).toBe(true);
  });

  it("attaches the scene picture once, then the beat frames up to the cap", () => {
    const d = createProjectData("넷", 4);
    d.baseAssetId = "scene-1";
    d.cast = d.cast.map((c, i) => ({ ...c, name: `인물${i}` }));
    d.expressions = d.expressions.map((e, i) => ({ ...e, imageAssetId: `img-${i}`, imageFraming: "medium", imageAspect: "16:9" }));
    const refs = videoReferences(d);
    expect(refs).toHaveLength(MAX_VIDEO_REFERENCES);
    expect(refs.filter((r) => r.role === "identity").map((r) => r.assetId)).toEqual(["scene-1"]);
    expect(preRenderCheck(d, buildVideoHandoff(d)).some((i) => i.area === "참고 그림 수")).toBe(true);
  });

  it("draws start/end frames with the whole cast", () => {
    const d = duo();
    const f = buildFrameHandoff(d, d.expressions[1].id, "bust");
    expect(f.prompt).toContain("2 characters together, group bust shot");
    expect(f.prompt).toContain("Blocking (screen positions): 칼리엘라 (screen-left), 브람 (screen-right).");
    expect(f.references.map((r) => r.assetId)).toEqual(["scene-1", "img-1"]);
  });

  it("describes every character's acting per beat to Claude", () => {
    const ctx = projectContext(duo(), 2);
    expect(ctx).toContain("인물 2 (B 브람) · 화면 위치 화면 오른쪽");
    expect(ctx).toContain("표정 2: B 브람 · 분노");
    expect(ctx).toContain("  같은 순간 A 칼리엘라: 움찔함");
    expect(ctx).toContain('대사 2: B 브람: "Don\'t you dare!"');
  });
});

describe("AI proposals and fixes for the cast", () => {
  it("applies one analysis of the scene picture to every character; the style is shared", () => {
    const d = duo();
    const out = applyCharacter(
      d,
      {
        summary: "",
        characters: [
          { character: 1, locks: "A-LOCKS", appearance: "", outfit: "" },
          { character: 2, locks: "B-LOCKS", appearance: "", outfit: "" },
        ],
        style: "NEW STYLE",
        questions: ["누가 더 큰가?"],
      },
      ["locks", "style", "questions"],
    );
    expect(out.cast.map((c) => c.locks)).toEqual(["A-LOCKS", "B-LOCKS"]);
    expect(out.cast[0].outfit).toBe("진홍 드레이프");
    expect(out.style).toBe("NEW STYLE");
    expect(out.cast[0].questions.map((q) => q.question)).toEqual(["누가 더 큰가?"]);
  });

  it("maps the AI's beats to a lead plus every other character's acting, waiting for a direction check", () => {
    const d = duo();
    const dir = { facing: "front" as const, pitch: "level" as const, tilt: "none" as const, gaze: "camera" as const, body: "front" as const };
    const ex = applyExpressions(d, {
      summary: "",
      styleWarning: null,
      expressions: d.expressions.map((_, i) => ({
        character: 2,
        reactions: [{ character: 1, emotion: `kal${i}`, intensity: "strong" as const, brows: "", eyes: "", mouth: "", gesture: "팔짱", ...dir }],
        panel: null, emotion: `bram${i}`, intensity: "medium" as const, brows: "", eyes: "", mouth: "", notes: "", gesture: "",
        ...dir, directionEvidence: "",
      })),
    });
    expect(ex.expressions.every((e) => e.characterId === d.cast[1].id)).toBe(true);
    expect(ex.expressions[0].emotion).toBe("bram0");
    expect(ex.expressions[0].reactions).toEqual([expect.objectContaining({ characterId: d.cast[0].id, emotion: "kal0", gesture: "팔짱", directionStatus: "ai" })]);
    expect(canApprove(approve(ex, 0), 1)).toBe(false);

    const dl = applyDialogue(d, { summary: "", voices: [{ character: 2, voice: "갈라진 바리톤" }], lines: [] });
    expect(dl.cast[0].voice).toBe("낮고 허스키한 알토");
    expect(dl.cast[1].voice).toBe("갈라진 바리톤");
  });

  it("fixes one character's voice in the video prompt only", () => {
    const d = duo();
    const fix = resolveFix(d, { target: "voice", expression: 2, text: "젊은 남성, 맑고 높은 테너, 빠르게" })!;
    expect(fix.expressionId).toBe(d.cast[1].id);
    expect(fixWhere(d, "voice", fix.expressionId)).toBe("B 브람 목소리");
    const fixed = applyTextFix(d, fix, "x");
    expect(fixed.cast[1].voice).toBe("젊은 남성, 맑은 테너");
    expect(buildVideoHandoff(fixed).prompt).toContain("브람 — 젊은 남성, 맑고 높은 테너, 빠르게");
  });

  it("keeps English per character and per beat for everyone, and reports what went stale", () => {
    const d = duo();
    d.english = buildEnglishSheet(d, {
      language: "English",
      style: "Bold outlines, flat cel colors.",
      cast: [
        { character: 1, look: ["crimson twisted locks", "elf ears"], outfit: "Crimson drape.", voice: "Low husky alto." },
        { character: 2, look: ["silver bob", "scar over left eye"], outfit: "Black armor.", voice: "Young clear tenor." },
      ],
      beats: d.expressions.map((e, i) => ({
        panel: i + 1,
        emotion: `lead ${i + 1}`,
        face: "Narrowed eyes.",
        body: "Leans in.",
        transition: "",
        delivery: "",
        others: [{ character: e.characterId === d.cast[0].id ? 2 : 1, emotion: `other ${i + 1}`, face: "Wide eyes, lips pressed.", body: "Steps back." }],
      })),
    });
    expect(englishStale(d)).toEqual([]);
    expect(freshEnglish(d).cast.get(d.cast[1].id)?.look).toEqual(["silver bob", "scar over left eye"]);
    const p = buildVideoHandoff(d).prompt;
    expect(p).toContain("Keep visible — 칼리엘라: crimson twisted locks; elf ears | 브람: silver bob; scar over left eye.");
    expect(p).toContain("브람 (moderate other 1): Wide eyes, lips pressed. Steps back.");
    expect(buildExpressionHandoffs(d)[0].prompt).toContain("- 브람: moderate other 1. Wide eyes, lips pressed.");
    // changing a listener's acting makes that beat stale
    d.expressions[0] = updatePerformance(d.expressions[0], d.cast[1].id, { gesture: "칼을 뽑는다" });
    expect(englishStale(d)).toEqual(["1번 표정"]);
    d.cast[1].voice = "다른 목소리";
    expect(englishStale(d)).toEqual(["B 목소리", "1번 표정"]);
  });
});

describe("older project data", () => {
  it("opens a single-character project as a cast of one with the voice moved to the character", () => {
    const d = parseProjectData({
      schemaVersion: 1,
      currentStep: 2,
      approvedThrough: 1,
      character: { name: "칼리엘라", baseAssetId: "b1", designRefAssetIds: [], locks: "L", appearance: "A", outfit: "O", style: "S", questions: [] },
      expressionSetup: { count: 2, refAssetId: null, refColumns: 4, refRows: 1, transfer: "expression_only", instruction: "", styleWarning: null, sheetAssetId: null, framing: "bust", scene: "" },
      expressions: [
        { id: "e1", panel: 1, emotion: "웃음", intensity: "medium", brows: "", eyes: "", mouth: "", notes: "", direction: { facing: "front", pitch: "level", tilt: "none", gaze: "camera", body: "front" }, directionStatus: "confirmed" },
        { id: "e2", panel: 2, emotion: "분노", intensity: "strong", brows: "", eyes: "", mouth: "", notes: "", direction: { facing: "front", pitch: "level", tilt: "none", gaze: "camera", body: "front" }, directionStatus: "confirmed" },
      ],
      dialogue: { voice: "허스키", language: "영어", lines: [{ expressionId: "e1", line: "Hi", meaning: "", delivery: "" }] },
      acting: { duration: 4, segments: [{ expressionId: "e1", start: 0, end: 2, transition: "" }, { expressionId: "e2", start: 2, end: 4, transition: "" }] },
      video: { aspectRatio: "9:16", extraDirection: "", resultAssetIds: [] },
    });
    expect(d.title).toBe("칼리엘라");
    expect(d.style).toBe("S");
    expect(d.baseAssetId).toBe("b1");
    expect(d.cast).toHaveLength(1);
    expect(d.cast[0]).toMatchObject({ name: "칼리엘라", locks: "L", voice: "허스키", position: "center" });
    expect(d.expressions.map((e) => e.characterId)).toEqual([d.cast[0].id, d.cast[0].id]);
    expect(d.approvedThrough).toBe(1);
    expect(d.video.aspectRatio).toBe("9:16");
  });

  it("takes the first per-character drawing of the earlier multi-cast version as the scene picture", () => {
    const now = createProjectData("둘", 2) as unknown as Record<string, unknown>;
    delete now.baseAssetId;
    delete now.designRefAssetIds;
    now.cast = (now.cast as Record<string, unknown>[]).map((c, i) => ({ ...c, baseAssetId: `old-${i}`, designRefAssetIds: [] }));
    const d = parseProjectData(now);
    expect(d.baseAssetId).toBe("old-0");
    expect(d.cast).toHaveLength(2);
  });
});

describe("prompt length for a group scene", () => {
  it("keeps everyone's gestures and faces by giving a group more room", () => {
    const d = duo();
    d.expressions[1] = updatePerformance(d.expressions[1], d.cast[0].id, { eyes: "눈을 크게 뜸" });
    const h = buildVideoHandoff(d);
    expect(h.lengthTarget).toBeGreaterThan(3500);
    expect(h.prompt.length).toBeLessThanOrEqual(h.lengthTarget);
    expect(h.prompt).toContain("팔·손: 한발 물러서며 두 손을 든다");
    expect(h.prompt).toContain("눈: 눈을 크게 뜸");
  });
});
