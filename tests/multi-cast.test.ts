import { describe, expect, it } from "vitest";
import {
  addCastMember,
  approve,
  canApprove,
  createProjectData,
  imageAspectFor,
  imageIsStale,
  parseProjectData,
  removeCastMember,
  stepIssues,
  type ProjectData,
} from "@/lib/domain/project";
import { buildExpressionHandoffs, buildFrameHandoff, buildVideoHandoff, MAX_VIDEO_REFERENCES, videoReferences } from "@/lib/domain/handoff";
import { applyCharacter, applyDialogue, applyExpressions } from "@/lib/domain/apply";
import { buildEnglishSheet, englishStale, freshEnglish } from "@/lib/domain/english";
import { preRenderCheck } from "@/lib/domain/check";
import { applyTextFix, fixWhere, resolveFix } from "@/lib/domain/fixes";
import { projectContext } from "@/lib/ai/prompts";

/** A two-character argument scene, ready through step 4. */
function duo(): ProjectData {
  const d = createProjectData("결투 직전", 2);
  const [a, b] = d.cast;
  d.cast = [
    { ...a, name: "칼리엘라", baseAssetId: "base-a", locks: "1. 진홍색 꼬임 머리\n2. 엘프 귀", appearance: "짙은 갈색 피부", outfit: "진홍 드레이프", voice: "낮고 허스키한 알토" },
    { ...b, name: "브람", baseAssetId: "base-b", locks: "1. 은발 단발\n2. 왼눈 흉터", appearance: "창백한 피부", outfit: "검은 갑옷", voice: "젊은 남성, 맑은 테너" },
  ];
  d.style = "굵은 외곽선의 2D 셀 채색";
  d.dialogue.language = "영어";
  d.expressions = d.expressions.map((e, i) => ({
    ...e,
    characterId: d.cast[i % 2].id,
    emotion: ["도발", "분노", "비웃음", "체념"][i],
    directionStatus: "confirmed",
    imageAssetId: `img-${i}`,
    imageFraming: "medium",
    imageAspect: "16:9",
  }));
  d.dialogue.lines = d.expressions.map((e, i) => ({
    expressionId: e.id,
    line: ["Come closer.", "Don't you dare!", "", "Fine."][i],
    meaning: "",
    delivery: "",
  }));
  return d;
}

describe("a cast of several characters", () => {
  it("starts with one character by default, and with a blocked-out cast when asked", () => {
    const one = createProjectData();
    expect(one.cast).toHaveLength(1);
    expect(one.cast[0].position).toBe("center");
    expect(imageAspectFor(one)).toBe("3:4");

    const three = createProjectData("셋", 3);
    expect(three.cast.map((c) => c.position)).toEqual(["left", "center", "right"]);
    expect(three.expressionSetup.framing).toBe("medium");
    expect(three.expressions).toHaveLength(6);
    // beats rotate through the cast
    expect(three.expressions.map((e) => three.cast.findIndex((c) => c.id === e.characterId))).toEqual([0, 1, 2, 0, 1, 2]);
    expect(imageAspectFor(three)).toBe("16:9");
  });

  it("adds and removes cast members, re-spreading positions and handing beats over", () => {
    let d = createProjectData("x");
    d.expressionSetup.framing = "close_up";
    d = addCastMember(d);
    expect(d.cast.map((c) => c.position)).toEqual(["left", "right"]);
    // a close-up cannot hold two people
    expect(d.expressionSetup.framing).toBe("medium");
    d = addCastMember(addCastMember(addCastMember(d)));
    expect(d.cast).toHaveLength(4);
    const gone = d.cast[1].id;
    d.expressions[0].characterId = gone;
    d = removeCastMember(d, gone);
    expect(d.cast).toHaveLength(3);
    expect(d.cast.map((c) => c.position)).toEqual(["left", "center", "right"]);
    expect(d.expressions[0].characterId).toBe(d.cast[0].id);
    // never below one
    let solo = createProjectData();
    solo = removeCastMember(solo, solo.cast[0].id);
    expect(solo.cast).toHaveLength(1);
  });

  it("checks every cast member in step 1, and names that tell them apart", () => {
    const d = duo();
    expect(canApprove(d, 0)).toBe(true);
    d.cast[1].name = "칼리엘라";
    expect(stepIssues(d, 0).map((i) => i.message).join(" ")).toContain("출연진 이름이 겹칩니다");
    d.cast[1].name = "브람";
    d.cast[1].baseAssetId = null;
    expect(stepIssues(d, 0).map((i) => i.message).join(" ")).toContain("B 브람: 기본 그림을 올리세요.");
  });

  it("blocks close-ups in a group scene and flags a character who never acts", () => {
    let d = approve(duo(), 0);
    expect(canApprove(d, 1)).toBe(true);
    d.expressionSetup.framing = "close_up";
    expect(stepIssues(d, 1).map((i) => i.message).join(" ")).toContain("클로즈업으로 담을 수 없습니다");
    d = duo();
    d.expressions.forEach((e) => (e.characterId = d.cast[0].id));
    expect(stepIssues(d, 1).map((i) => i.message).join(" ")).toContain("B 브람에게 맡긴 표정이 없습니다");
  });

  it("asks for a voice for every character who speaks", () => {
    const d = duo();
    d.cast[1].voice = "";
    expect(stepIssues(d, 2).map((i) => i.message)).toContain("B 브람의 목소리 설정을 입력하세요.");
    // a character with no lines needs no voice
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
  it("draws each beat as one scene frame with the whole cast in fixed positions", () => {
    const d = duo();
    const [first, second] = buildExpressionHandoffs(d);
    expect(first.aspectRatio).toBe("16:9");
    expect(first.references.slice(0, 2).map((r) => r.assetId)).toEqual(["base-a", "base-b"]);
    expect(first.prompt).toContain("Scene frame of 2 characters together in ONE 16:9 image");
    expect(first.prompt).toContain("Blocking (screen positions, identical in every frame of this scene): 칼리엘라 (screen-left), 브람 (screen-right).");
    expect(first.prompt).toContain("칼리엘라 (screen-left) must match image reference 1 exactly");
    expect(first.prompt).toContain("브람 (screen-right) must match image reference 2 exactly");
    expect(first.prompt).toContain("Must keep (브람): 1. 은발 단발 2. 왼눈 흉터");
    expect(first.prompt).toContain("칼리엘라 acts this moment (the focus of the frame)");
    expect(first.prompt).toContain("The others (브람): listening to 칼리엘라");
    expect(first.prompt).not.toContain("no other characters");
    // the next beat matches the anchor frame (the first one on the timeline)
    expect(second.prompt).toContain("브람 acts this moment");
    expect(second.references.map((r) => r.assetId)).toContain("img-0");
    // the team's own direction for the others wins over the default
    d.expressions[0].others = "브람은 칼자루에 손을 얹고 노려본다";
    expect(buildExpressionHandoffs(d)[0].prompt).toContain("The others: 브람은 칼자루에 손을 얹고 노려본다.");
  });

  it("keeps the single-character image prompt unchanged for a cast of one", () => {
    const d = createProjectData("solo");
    d.cast[0] = { ...d.cast[0], name: "A", baseAssetId: "base-1" };
    const p = buildExpressionHandoffs(d)[0].prompt;
    expect(p).toContain("Single character illustration of ONE character, portrait 3:4");
    expect(p).toContain("The character must match image reference 1 exactly");
    expect(p).not.toContain("Blocking");
  });

  it("tells the video model who is where, who says each line, and who keeps quiet", () => {
    const d = duo();
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain("a 8-second 2-character scene, 16:9");
    expect(h.prompt).toContain("Cast (exactly these 2 characters, always in these screen positions; nobody else): 칼리엘라 (screen-left), 브람 (screen-right).");
    expect(h.prompt).toContain('칼리엘라 says exactly (English): "Come closer."');
    expect(h.prompt).toContain('브람 says exactly (English): "Don\'t you dare!"');
    expect(h.prompt).toContain("while one character speaks the others keep their mouths closed");
    expect(h.prompt).toContain("Voices (each character keeps their own voice): 칼리엘라 — 낮고 허스키한 알토; 브람 — 젊은 남성, 맑은 테너.");
    expect(h.prompt).toContain("1. character design of 칼리엘라 (screen-left) — identity only");
    expect(h.prompt).toContain("never swap or blend features between characters");
    expect(h.prompt).not.toContain("Only one character appears");
    expect(h.prompt.endsWith(h.constraints)).toBe(true);
  });

  it("puts the whole cast first in the video references and caps the total", () => {
    const d = createProjectData("넷", 4);
    d.cast = d.cast.map((c, i) => ({ ...c, name: `인물${i}`, baseAssetId: `base-${i}` }));
    d.expressions = d.expressions.map((e, i) => ({ ...e, imageAssetId: `img-${i}`, imageFraming: "medium", imageAspect: "16:9" }));
    const refs = videoReferences(d);
    expect(refs).toHaveLength(MAX_VIDEO_REFERENCES);
    expect(refs.slice(0, 4).every((r) => r.role === "identity")).toBe(true);
    expect(preRenderCheck(d, buildVideoHandoff(d)).some((i) => i.area === "참고 그림 수")).toBe(true);
  });

  it("draws start/end frames with the whole cast", () => {
    const d = duo();
    const f = buildFrameHandoff(d, d.expressions[1].id, "bust");
    expect(f.prompt).toContain("2 characters together, group bust shot");
    expect(f.prompt).toContain("Blocking (screen positions): 칼리엘라 (screen-left), 브람 (screen-right).");
    expect(f.references.map((r) => r.assetId)).toEqual(["base-a", "base-b", "img-1"]);
  });

  it("describes the cast to Claude with numbers, names and positions", () => {
    const ctx = projectContext(duo(), 2);
    expect(ctx).toContain("인물 2 (B 브람) · 화면 위치 화면 오른쪽");
    expect(ctx).toContain("표정 2: B 브람 · 분노");
    expect(ctx).toContain('대사 2: B 브람: "Don\'t you dare!"');
    expect(ctx).toContain("목소리 (A 칼리엘라): 낮고 허스키한 알토");
  });
});

describe("AI proposals and fixes per character", () => {
  it("applies a drawing analysis to the character it was made for; the style is shared", () => {
    const d = duo();
    const out = applyCharacter(d, { summary: "", locks: "NEW", appearance: "", outfit: "", style: "NEW STYLE", questions: [] }, ["locks", "style"], d.cast[1].id);
    expect(out.cast[0].locks).toBe(d.cast[0].locks);
    expect(out.cast[1].locks).toBe("NEW");
    expect(out.style).toBe("NEW STYLE");
  });

  it("maps the AI's cast numbers to actors, and voices to characters", () => {
    const d = duo();
    const ex = applyExpressions(d, {
      summary: "",
      styleWarning: null,
      expressions: d.expressions.map((_, i) => ({
        character: 2, others: "칼리엘라가 웃는다", panel: null, emotion: `e${i}`, intensity: "medium" as const, brows: "", eyes: "", mouth: "", notes: "", gesture: "",
        facing: "front" as const, pitch: "level" as const, tilt: "none" as const, gaze: "camera" as const, body: "front" as const, directionEvidence: "",
      })),
    });
    expect(ex.expressions.every((e) => e.characterId === d.cast[1].id)).toBe(true);
    expect(ex.expressions[0].others).toBe("칼리엘라가 웃는다");

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

  it("keeps English per character and reports exactly which one went stale", () => {
    const d = duo();
    d.english = buildEnglishSheet(d, {
      language: "English",
      style: "Bold outlines, flat cel colors.",
      cast: [
        { character: 1, look: ["crimson twisted locks", "elf ears"], outfit: "Crimson drape.", voice: "Low husky alto." },
        { character: 2, look: ["silver bob", "scar over left eye"], outfit: "Black armor.", voice: "Young clear tenor." },
      ],
      beats: d.expressions.map((_, i) => ({ panel: i + 1, emotion: `beat ${i + 1}`, face: "Narrowed eyes.", body: "Leans in.", transition: "", delivery: "" })),
    });
    expect(englishStale(d)).toEqual([]);
    expect(freshEnglish(d).cast.get(d.cast[1].id)?.look).toEqual(["silver bob", "scar over left eye"]);
    const p = buildVideoHandoff(d).prompt;
    expect(p).toContain("Keep visible — 칼리엘라: crimson twisted locks; elf ears | 브람: silver bob; scar over left eye.");
    d.cast[1].voice = "다른 목소리";
    expect(englishStale(d)).toEqual(["B 목소리"]);
  });
});

describe("projects from the single-character app", () => {
  it("open as a cast of one with the voice moved to the character", () => {
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
    expect(d.cast).toHaveLength(1);
    expect(d.cast[0]).toMatchObject({ name: "칼리엘라", baseAssetId: "b1", locks: "L", voice: "허스키", position: "center" });
    expect(d.expressions.map((e) => e.characterId)).toEqual([d.cast[0].id, d.cast[0].id]);
    expect(d.approvedThrough).toBe(1);
    expect(d.video.aspectRatio).toBe("9:16");
  });
});
