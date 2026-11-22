/**
 * Cross-step consistency: whatever an earlier step changes, the later steps stay in step with it and the
 * prompts never contradict themselves. Runs on built-in scenes, and on a dump of live projects when
 * CONSISTENCY_DUMP points to one (a JSON array of { name, data }).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  addCastMember,
  createProjectData,
  readProjectData,
  removeCastMember,
  setDuration,
  setExpressionCount,
  shotsOf,
  usesConti,
  type ProjectData,
  type StepIndex,
} from "@/lib/domain/project";
import { buildExpressionHandoffs, buildSceneImageHandoff, buildSketchHandoffs, buildVideoHandoff, MAX_VIDEO_REFERENCES, referenceTarget } from "@/lib/domain/handoff";
import { preRenderCheck, guideIssues } from "@/lib/domain/check";
import { stepIssues } from "@/lib/domain/project";
import { applyActing } from "@/lib/domain/apply";

/** Everything that must hold whatever the team did in earlier steps. */
function invariants(d: ProjectData, where: string) {
  const at = (m: string) => `${where}: ${m}`;
  const ids = d.expressions.map((e) => e.id);
  const castIds = new Set(d.cast.map((c) => c.id));
  // step 2 ↔ step 4: one timeline segment per panel, contiguous from 0 to the duration
  const segIds = d.acting.segments.map((s) => s.expressionId);
  expect(new Set(segIds).size, at("each panel once on the timeline")).toBe(segIds.length);
  expect([...segIds].sort(), at("timeline covers exactly the panels")).toEqual([...ids].sort());
  d.acting.segments.forEach((s, k) => {
    if (k > 0) expect(Math.abs(s.start - d.acting.segments[k - 1].end) < 1e-6, at("timeline has no gap")).toBe(true);
  });
  if (d.acting.segments.length) {
    expect(d.acting.segments[0].start, at("timeline starts at 0")).toBe(0);
    expect(Math.abs(d.acting.segments[d.acting.segments.length - 1].end - d.acting.duration) < 1e-6, at("timeline ends at the duration")).toBe(true);
  }
  // storyboard: the panel order is the design order
  if (d.mode === "storyboard") expect(segIds, at("storyboard timeline in panel order")).toEqual(ids);
  // step 3 ↔ step 2: lines belong to existing panels
  for (const l of d.dialogue.lines) expect(ids, at("dialogue line points to a panel")).toContain(l.expressionId);
  // step 1 ↔ step 2: every lead and reaction is a cast member
  for (const e of d.expressions) {
    expect(castIds.has(e.characterId), at(`panel ${ids.indexOf(e.id) + 1} speaker is in the cast`)).toBe(true);
    for (const r of e.reactions) expect(castIds.has(r.characterId), at("reaction belongs to the cast")).toBe(true);
  }
  for (const c of d.english?.cast ?? []) expect(castIds.has(c.characterId), at("English cast entry belongs to the cast")).toBe(true);

  // every builder works on the current data
  for (let s = 0; s <= 4; s++) stepIssues(d, s as StepIndex);
  buildSceneImageHandoff(d);
  const panels = buildExpressionHandoffs(d);
  if (d.mode === "storyboard") buildSketchHandoffs(d);
  // a 3D & 2.5D project never asks for 2D (a 2D project does, on purpose)
  if (d.dimension !== "2d") for (const h of panels) expect(h.prompt, at("panel prompts never ask for 2D")).not.toMatch(/(^|[^\d.])2D(?!\w)/);
  for (const source of ["references", "start_frame"] as const) {
    const h = buildVideoHandoff(d, source);
    const p = h.prompt;
    preRenderCheck(d, h);
    guideIssues(d);
    // the studio block closes the prompt and is written positively
    expect(p.endsWith(h.constraints), at("constraints close the prompt")).toBe(true);
    expect(h.constraints, at("constraints have no 'never/NO' phrasing")).not.toMatch(/never gliding|\bNO [A-Z]|streaming/);
    if (d.dimension !== "2d") expect(p, at("prompt never asks for 2D")).not.toMatch(/(^|[^\d.])2D(?!\w)/);
    expect(p, at("prompt never forbids 3D")).not.toMatch(/never photorealistic or 3D|switch to photorealism or 3D/);
    // a cut storyboard is never told it is one continuous take, and the other way round
    if (d.mode === "storyboard" && shotsOf(d).length > 1) expect(p, at("cut scene not called one take")).not.toContain("ONE single continuous shot with no cuts");
    if (source === "references") {
      expect(h.references.length, at("at most the reference cap")).toBeLessThanOrEqual(MAX_VIDEO_REFERENCES);
      expect(new Set(h.references.map((r) => r.assetId)).size, at("no reference attached twice")).toBe(h.references.length);
      // every beat whose picture is attached is pointed at in the prompt
      for (const e of d.expressions) {
        const target = referenceTarget(h.references, e.id);
        if (target) expect(p, at(`panel ${ids.indexOf(e.id) + 1} is pointed at its picture`)).toContain(target);
      }
      if (usesConti(d)) expect(h.references.some((r) => r.sketch), at("conti mode attaches sketches")).toBe(true);
    }
  }
}

/** What earlier steps can do to a scene, in turn. */
function edits(d: ProjectData): [string, ProjectData][] {
  const out: [string, ProjectData][] = [["as is", d]];
  const max = d.mode === "storyboard" ? 8 : 8;
  for (const n of [2, 3, max]) out.push([`step 2: ${n} panels`, setExpressionCount(d, n)]);
  out.push(["step 2: 9.5 s", setDuration(d, 9.5)]);
  out.push(["step 1: one more cast member", addCastMember(d)]);
  if (d.cast.length > 1) out.push(["step 1: first cast member removed", removeCastMember(d, d.cast[0].id)]);
  out.push(["step 1: mode switched", { ...d, mode: d.mode === "storyboard" ? "cast" : "storyboard" }]);
  out.push(["step 5: 9:16", { ...d, video: { ...d.video, aspectRatio: "9:16" } }]);
  // step 4: an AI timing that lists the panels backwards
  const backwards = d.expressions.map((_, i) => ({ panel: d.expressions.length - i, start: i, end: i + 1, transition: "" }));
  out.push(["step 4: AI timing in reverse", applyActing(d, { segments: backwards } as Parameters<typeof applyActing>[1])]);
  return out;
}

function scenes(): [string, ProjectData][] {
  const single = createProjectData("혼자", 1, "cast");
  const duo = createProjectData("둘", 2, "cast");
  const board = setExpressionCount(createProjectData("콘티", 3, "storyboard"), 6);
  board.baseAssetId = "scene-1";
  board.designRefAssetIds = ["bg-1", "bg-2"];
  board.cast = board.cast.map((c, i) => ({ ...c, name: `인물${i + 1}`, refAssetId: `sheet-${i + 1}`, outfit: "밤: 로브 / 새벽: 튜닉" }));
  board.expressions = board.expressions.map((e, i) => ({
    ...e,
    action: `순간 ${i + 1}`,
    camera: i % 2 ? "고정" : "천천히 트랙인",
    continuity: `시작: 상태 ${i} / 끝: 상태 ${i + 1}`,
    link: i === 3 ? ("cut" as const) : ("continuous" as const),
    sketchAssetId: `sk-${i + 1}`,
    imageAssetId: `img-${i + 1}`,
    imageAspect: "16:9",
  }));
  board.style = "회화풍 2D, 붓자국";
  board.dialogue.lines = [{ expressionId: board.expressions[1].id, line: "Run!", meaning: "", delivery: "" }];
  const panels = { ...board, video: { ...board.video, refMode: "panels" as const } };
  return [
    ["one character", single],
    ["two characters", duo],
    ["storyboard, conti", board],
    ["storyboard, panel images", panels],
  ];
}

describe("cross-step consistency", () => {
  for (const [name, d] of scenes())
    it(`${name}: later steps follow every earlier change`, () => {
      for (const [what, x] of edits(d)) invariants(x, `${name} / ${what}`);
    });

  const dump = process.env.CONSISTENCY_DUMP;
  if (dump && fs.existsSync(dump))
    it("live projects", () => {
      const rows = JSON.parse(fs.readFileSync(dump, "utf8")) as { name: string; data: unknown }[];
      for (const r of rows) {
        const { data } = readProjectData(r.data);
        for (const [what, x] of edits(data)) invariants(x, `${r.name} / ${what}`);
      }
    });
});

describe("prompt wording fixes", () => {
  it("continuity rules with list numbers are not cut inside brackets", async () => {
    const { buildVideoHandoff } = await import("@/lib/domain/handoff");
    const d = setExpressionCount(createProjectData("규칙", 1, "storyboard"), 3);
    d.expressionSetup.continuity =
      "1) Shots 1,2,3 from ahead of her path, she nears camera, her right side (braid, loose strap) screen left; overheads put path at frame top. 2) " +
      "x".repeat(900);
    const p = buildVideoHandoff(d, "references").prompt;
    expect(p).not.toMatch(/\(braid\./);
  });
  it("a locked panel camera becomes handheld-steady; a painted style stays painted", async () => {
    const { heldSteady, keepPainted } = await import("@/lib/domain/handoff");
    expect(heldSteady("Low-angle locked shot near ground")).toBe("Low-angle steady handheld shot near ground");
    expect(heldSteady("Wide shot, locked at eye level")).toBe("Wide shot, held steady by hand at eye level");
    expect(heldSteady("고정된 채 클로즈업")).toBe("핸드헬드로 거의 고정된 채 클로즈업");
    expect(keepPainted("Painterly 3D & 2.5D with watercolor brushwork")).toMatch(/hand-painted/);
    expect(keepPainted("pink clay")).toBe("");
  });
});

describe("conti check: text corrections", () => {
  it("rewrites only the named fields of existing panels and keeps every invariant", async () => {
    const { applyTextFixes } = await import("@/lib/domain/apply");
    const d = setExpressionCount(createProjectData("콘티", 1, "storyboard"), 3);
    const x = applyTextFixes(d, [
      { panel: 2, field: "action", text: "모래를 움켜쥔 주먹" },
      { panel: 3, field: "continuity", text: "시작: 엎드림 / 끝: 일어서서 한 걸음" },
      { panel: 9, field: "camera", text: "없는 컷" },
    ]);
    expect(x.expressions[1].action).toBe("모래를 움켜쥔 주먹");
    expect(x.expressions[2].continuity).toBe("시작: 엎드림 / 끝: 일어서서 한 걸음");
    expect(x.expressions[0]).toEqual(d.expressions[0]);
    expect(x.expressions.length).toBe(3);
    invariants(x, "after text fixes");
  });
});

describe("safeguards: sketch ↔ text ↔ acting", () => {
  it("flags a sketch whose text changed, and clears it when the text is matched to the sketch", async () => {
    const { withSketch, sketchIsStale } = await import("@/lib/domain/project");
    const { applyTextFixes } = await import("@/lib/domain/apply");
    let d = setExpressionCount(createProjectData("콘티", 1, "storyboard"), 3);
    d = { ...d, expressions: d.expressions.map((e) => withSketch({ ...e, action: "손을 편다" }, "sk")) };
    expect(sketchIsStale(d.expressions[0])).toBe(false);
    d = { ...d, expressions: d.expressions.map((e, i) => (i === 0 ? { ...e, action: "주먹을 쥔다" } : e)) };
    expect(sketchIsStale(d.expressions[0])).toBe(true);
    const fixed = applyTextFixes(d, [{ panel: 1, field: "action", text: "모래를 움켜쥔 주먹" }]);
    expect(sketchIsStale(fixed.expressions[0])).toBe(false);
  });
  it("applies acting fixes: transition, text, and a new length that keeps the timeline whole", async () => {
    const { applyActingFixes } = await import("@/lib/domain/apply");
    const d = setDuration(setExpressionCount(createProjectData("콘티", 1, "storyboard"), 4), 8);
    const x = applyActingFixes(d, [
      { panel: 2, field: "length", text: "", seconds: 4, },
      { panel: 1, field: "transition", text: "숨이 끝나는 순간 컷", seconds: null },
      { panel: 3, field: "continuity", text: "시작: 엎드림 / 끝: 무릎", seconds: null },
    ]);
    const seg2 = x.acting.segments.find((s) => s.expressionId === x.expressions[1].id)!;
    expect(Math.abs(seg2.end - seg2.start - 4) < 0.01).toBe(true);
    expect(x.acting.segments.find((s) => s.expressionId === x.expressions[0].id)!.transition).toBe("숨이 끝나는 순간 컷");
    expect(x.expressions[2].continuity).toBe("시작: 엎드림 / 끝: 무릎");
    invariants(x, "after acting fixes");
    // an impossible length is skipped
    const y = applyActingFixes(d, [{ panel: 1, field: "length", text: "", seconds: 7.9 }]);
    expect(y.acting.segments).toEqual(d.acting.segments);
  });
  it("the sketch prompt draws the pose the panel ends on", async () => {
    const { buildSketchHandoffs } = await import("@/lib/domain/handoff");
    const d = setExpressionCount(createProjectData("콘티", 1, "storyboard"), 2);
    d.expressions[0] = { ...d.expressions[0], action: "pushes up and kneels", continuity: "시작: 엎드림 / 끝: 무릎을 꿇은 자세" };
    const p = buildSketchHandoffs(d)[0].prompt;
    expect(p).toContain("The pose to draw");
    expect(p).toContain("무릎을 꿇은 자세");
  });
});

describe("Seedance acting doctrine (SH04_3 tests)", () => {
  it("puts the acting rules, the arc and the result pose in the prompt, and keeps negative wording low", async () => {
    const { buildVideoHandoff, ACTING_EN, startState } = await import("@/lib/domain/handoff");
    const { buildEnglishSheet } = await import("@/lib/domain/english");
    const { preRenderCheck, NEGATIVE_LIMIT } = await import("@/lib/domain/check");
    let d = setExpressionCount(createProjectData("결의", 1, "storyboard"), 3);
    d = {
      ...d,
      expressions: d.expressions.map((e, i) => ({ ...e, action: `동작 ${i + 1}`, continuity: `시작: 상태 ${i} / 끝: 상태 ${i + 1}` })),
    };
    d.english = buildEnglishSheet(d, {
      language: "English",
      style: "",
      arc: "SPENT (brows low, empty eyes) → her fingers find the toy → STRUCK (inner brows lift, a long still stare)",
      cast: [],
      beats: [],
    });
    const h = buildVideoHandoff(d, "references");
    expect(h.prompt).toContain(ACTING_EN);
    expect(h.prompt).toContain("THE EMOTIONAL ARC: THIS IS THE WHOLE POINT.");
    expect(h.prompt).toContain("→ her fingers find the toy →");
    expect(h.prompt).toContain("Frame zero: 상태 0.");
    expect(h.prompt).toContain("Result pose: 상태 3.");
    expect(h.constraints).toContain("[CAMERA] Handheld from the hand, intimate and alive");
    const negatives = (h.prompt.match(/\bnever\b|\bno\b|\bnot\b|\bnothing\b/gi) ?? []).length;
    expect(negatives).toBeLessThanOrEqual(NEGATIVE_LIMIT);
    expect(preRenderCheck(d, h).find((i) => i.area === "금지 표현")?.level).toBe("ok");
    expect(startState("시작: 엎드림 / 끝: 무릎")).toBe("엎드림");
    expect(startState("그냥 상태")).toBe("");
  });
});

describe("dialogue acting cues (Z_1–Z_4 references)", () => {
  it("keeps word-cued gestures and volume in the delivery, and tells the model how to read them", async () => {
    const { buildVideoHandoff, ACTING_EN } = await import("@/lib/domain/handoff");
    const d = setExpressionCount(createProjectData("대화", 1, "storyboard"), 2);
    d.expressions = d.expressions.map((e, i) => ({ ...e, action: `동작 ${i + 1}` }));
    const cue = 'quiet, stress on "HER"; on "HER" she turns her eyes to her own right and nods toward Haru';
    d.dialogue.lines = [{ expressionId: d.expressions[0].id, line: "We've got HER, though.", meaning: "", delivery: cue }];
    const p = buildVideoHandoff(d, "references").prompt;
    expect(p).toContain(cue);
    expect(ACTING_EN).toContain("lands exactly on that word");
    expect(ACTING_EN).toContain("Everyone in frame is live");
    // Z_1: a reaction layers on top of ongoing business (chewing through the surprise), which then resumes
    expect(ACTING_EN).toContain("Ongoing business (eating, sipping, smoking, handling a prop) carries on through a reaction");
    expect(ACTING_EN).not.toMatch(/business[^.]*\b(never|not|no)\b/);
  });
});

describe("composition rule (storyboard)", () => {
  it("forbids a frontal face and a lens stare in a horizontally symmetrical frame, in the video and sketch prompts", async () => {
    const { buildVideoHandoff, buildSketchHandoffs, COMPOSITION_EN } = await import("@/lib/domain/handoff");
    const d = setExpressionCount(createProjectData("구도", 1, "storyboard"), 2);
    d.expressions = d.expressions.map((e, i) => ({ ...e, action: `동작 ${i + 1}` }));
    expect(buildVideoHandoff(d, "references").prompt).toContain(COMPOSITION_EN);
    expect(buildSketchHandoffs(d)[0].prompt).toContain("never drawn frontal in a horizontally symmetrical frame");
  });
});

describe("composition rule (cast mode)", () => {
  it("draws a 'front' head slightly off-axis and adds the face-angle line to images, frames and the video", async () => {
    const { buildVideoHandoff, buildExpressionHandoffs, buildFrameHandoff, FACE_ANGLE_EN } = await import("@/lib/domain/handoff");
    const { preRenderCheck } = await import("@/lib/domain/check");
    const d = createProjectData("정면", 1, "cast");
    d.expressions = d.expressions.map((e) => ({ ...e, direction: { ...e.direction, facing: "front" as const, body: "front" as const } }));
    const img = buildExpressionHandoffs(d)[0].prompt;
    expect(img).toContain(FACE_ANGLE_EN);
    expect(img).toContain("Head toward the viewer, turned or tilted slightly off-axis");
    expect(img).toContain("body facing the viewer");
    expect(buildFrameHandoff(d, d.expressions[0].id, "bust").prompt).toContain(FACE_ANGLE_EN);
    const h = buildVideoHandoff(d, "references");
    expect(h.prompt).toContain(FACE_ANGLE_EN);
    expect(preRenderCheck(d, h).find((i) => i.area === "구도")?.text).toContain("비대칭 정면");
  });
});

describe("review fixes (몰리송 test)", () => {
  it("a voice-over line keeps mouths closed in the panel image; lists are not cut after their first item; child wording is flagged", async () => {
    const { buildExpressionHandoffs, buildVideoHandoff } = await import("@/lib/domain/handoff");
    const { preRenderCheck, isChildCharacter } = await import("@/lib/domain/check");
    const d = setExpressionCount(createProjectData("춤", 1, "storyboard"), 2);
    d.expressions = d.expressions.map((e, i) => ({ ...e, action: i === 0 ? "Hana drops her hips into a squat, fists on hips." : "동작" }));
    d.dialogue.lines = [{ expressionId: d.expressions[0].id, line: "One, two!", meaning: "", delivery: "", vo: true }];
    const img = buildExpressionHandoffs(d)[0].prompt;
    expect(img).toContain("is a voice-over heard over the picture");
    expect(img).not.toContain("mouth open mid-word");
    d.dialogue.lines[0].vo = false;
    expect(buildExpressionHandoffs(d)[0].prompt).toContain("mouth open mid-word");

    expect(isChildCharacter("5~7세쯤의 작은 여자아이")).toBe(true);
    expect(isChildCharacter("30대 여성, 키 170cm")).toBe(false);
    d.cast[0] = { ...d.cast[0], appearance: "5~7세쯤의 작은 여자아이" };
    const h = buildVideoHandoff(d, "references");
    const warn = preRenderCheck(d, h).find((i) => i.area === "어린이 표현");
    expect(warn?.text).toContain("hips");
    d.cast[0] = { ...d.cast[0], appearance: "30대 여성" };
    expect(preRenderCheck(d, buildVideoHandoff(d, "references")).find((i) => i.area === "어린이 표현")).toBeUndefined();
  });
});

describe("화풍 차원 (2D / 2.5D & 3D)", () => {
  it("a 2D project asks for 2D everywhere; the default stays 3D & 2.5D", async () => {
    const { buildVideoHandoff, buildExpressionHandoffs, studioStyle } = await import("@/lib/domain/handoff");
    const { englishStale } = await import("@/lib/domain/english");
    for (const mode of ["storyboard", "cast"] as const) {
      const d = setExpressionCount(createProjectData("차원", 1, mode), 2);
      d.expressions = d.expressions.map((e, i) => ({ ...e, action: `동작 ${i + 1}` }));
      d.style = "3D & 2.5D animation with soft cel shading, painterly brushwork";
      expect(buildVideoHandoff(d, "references").prompt).toContain("3D & 2.5D animation style");
      d.dimension = "2d";
      const h = buildVideoHandoff(d, "references");
      expect(h.prompt).not.toMatch(/3D|2\.5D/);
      expect(h.prompt).toContain("2D animation style");
      expect(h.constraints).toContain("A hand-drawn 2D animated feature film.");
      expect(h.negativePrompt).toContain("3D render");
      expect(buildExpressionHandoffs(d)[0].prompt).not.toMatch(/3D|2\.5D/);
    }
    expect(studioStyle("Painterly 2D look", "3d")).toBe("Painterly 3D & 2.5D look");
    expect(studioStyle("Painterly 3D & 2.5D animation", "2d")).toBe("Painterly 2D animation");
    const d = createProjectData("영어", 1, "storyboard");
    d.style = "수채 붓자국";
    d.dimension = "2d";
    expect(englishStale(d)).toContain("그림체");
  });
});

describe("rough conti redraw loop", () => {
  it("sketches carry the character sheets, the costumes and the review notes", async () => {
    const { buildSketchHandoffs } = await import("@/lib/domain/handoff");
    const d = setExpressionCount(createProjectData("콘티", 2, "storyboard"), 2);
    d.baseAssetId = "scene-1";
    d.cast = d.cast.map((c, i) => ({ ...c, name: `인물${i + 1}`, refAssetId: `sheet-${i + 1}`, outfit: i ? "heart-shaped body, no legs" : "sleeveless top with frills, black bowler hat" }));
    d.expressions = d.expressions.map((e, i) => ({ ...e, action: `동작 ${i + 1}` }));
    const [h] = buildSketchHandoffs(d, { [d.expressions[0].id]: "the hat is missing" });
    expect(h.references.map((r) => r.assetId)).toEqual(["scene-1", "sheet-1", "sheet-2"]);
    expect(h.prompt).toContain("Image reference 2 is the design sheet of 인물1");
    expect(h.prompt).toContain("black bowler hat");
    expect(h.prompt).toContain("the hat is missing");
    expect(h.prompt).toContain("its end pose");
  });
});

describe("panel titles", () => {
  it("drop time ranges and stay short in the prompts", async () => {
    const { panelTitle } = await import("@/lib/domain/project");
    const { buildVideoHandoff } = await import("@/lib/domain/handoff");
    expect(panelTitle("0~1.5초 · 밤거리 와이드 고정: 코발트블루 별밤과 노란 창문 불빛 건물, 젖은 돌바닥. 화면 왼쪽 가운데 공중의 보라 이모지가")).toBe("밤거리 와이드 고정");
    expect(panelTitle("4.5~6초 · 같은 구도 홀드")).toBe("같은 구도 홀드");
    expect(panelTitle("군중이 갈라지며 칼리엘라 등장")).toBe("군중이 갈라지며 칼리엘라 등장");
    const d = setExpressionCount(createProjectData("제목", 1, "storyboard"), 2);
    d.expressions = d.expressions.map((e, i) => ({ ...e, emotion: `${i * 2}~${i * 2 + 2}초 · 장면 ${i + 1}`, action: `동작 ${i + 1}` }));
    const p = buildVideoHandoff(d, "references").prompt;
    expect(p).not.toMatch(/panel \d+ — \d+~\d+초/);
    expect(p).toContain("— 장면 1");
  });
});

describe("short storyboard cuts (guidance only)", () => {
  it("warns under about 4 s a cut and never blocks", async () => {
    const { cutLengthNotice, suggestedCutsFor, stepIssues } = await import("@/lib/domain/project");
    const d = setDuration(setExpressionCount(createProjectData("길이", 1, "storyboard"), 5), 8);
    expect(cutLengthNotice(d)).toContain("컷당 약 1.6초");
    expect(suggestedCutsFor(8)).toBe(2);
    const issue = stepIssues(d, 1).find((i) => i.message.includes("컷당 약"));
    expect(issue?.level).toBe("warn");
    expect(cutLengthNotice(setExpressionCount(d, 2))).toBe("");
  });
});

describe("다음 장면 만들기 (sequence)", () => {
  it("keeps what a sequence shares, starts the scene's own work fresh and remembers where the last scene ended", async () => {
    const { nextSceneData, readProjectData } = await import("@/lib/domain/project");
    const { projectContext } = await import("@/lib/ai/prompts");
    const prev = setExpressionCount(createProjectData("몰리송", 2, "storyboard"), 3);
    prev.style = "2D 셀 애니메이션";
    prev.dimension = "2d";
    prev.baseAssetId = "scene-1";
    prev.cast = prev.cast.map((c, i) => ({ ...c, name: `인물${i + 1}`, refAssetId: `sheet-${i + 1}`, voice: "밝은 목소리" }));
    prev.expressionSetup.continuity = "1) 하나는 화면 왼쪽";
    prev.expressions = prev.expressions.map((e, i) => ({ ...e, action: `동작 ${i + 1}`, continuity: `시작: 상태 ${i} / 끝: 상태 ${i + 1}` }));
    prev.dialogue.lines = [{ expressionId: prev.expressions[0].id, line: "안녕", meaning: "", delivery: "" }];
    prev.video.weight = "extra";
    const next = nextSceneData(prev, "prev-id", "몰리송 #2");
    expect(next.title).toBe("몰리송 #2");
    expect(next.cast.map((c) => c.refAssetId)).toEqual(["sheet-1", "sheet-2"]);
    expect(next.style).toBe(prev.style);
    expect(next.dimension).toBe("2d");
    expect(next.baseAssetId).toBe("scene-1");
    expect(next.expressionSetup.continuity).toBe(prev.expressionSetup.continuity);
    expect(next.video.weight).toBe("extra");
    expect(next.video.resultAssetIds).toEqual([]);
    expect(next.dialogue.lines).toEqual([]);
    expect(next.expressions.every((e) => !e.action && !e.sketchAssetId)).toBe(true);
    expect(next.previous).toEqual({ projectId: "prev-id", name: "몰리송", endState: "상태 3", index: 2 });
    expect(readProjectData(next).recovered).toBe(false);
    expect(projectContext(next, 1)).toContain("앞 장면은 이렇게 끝났습니다: 상태 3");
    invariants(next, "next scene");
  });
});

describe("rough conti carries what the conti check holds it to", () => {
  it("rules, the start state, each character's build and age, the place references, left/right and the shot size", async () => {
    const { buildSketchHandoffs } = await import("@/lib/domain/handoff");
    const d = setExpressionCount(createProjectData("훈련장", 2, "storyboard"), 3);
    d.cast[0] = { ...d.cast[0], name: "꼬마", locks: "1. 주황 곱슬머리\n2. 보라 숄\n3. 가는 팔\n4. 짧은 나무 검", appearance: "열 살 남자아이, 키 130cm" };
    d.cast[1] = { ...d.cast[1], name: "에일레스", locks: "1. 허리까지 오는 웨이브 머리", appearance: "190cm 전사", refAssetId: "sheet-e" };
    d.designRefAssetIds = ["bg-1"];
    d.expressionSetup.continuity = "2) 횃불은 화면 오른쪽 벽 4) 칼끝은 화면 왼쪽 아래";
    d.expressions = d.expressions.map((e, i) => ({ ...e, action: `동작 ${i + 1}`, camera: "허리 위 미디엄 클로즈업", continuity: `시작: 시작 ${i + 1} / 끝: 끝 ${i + 1}` }));
    d.expressions[1] = { ...d.expressions[1], continuity: "끝: 끝 2" };
    const hs = buildSketchHandoffs(d);
    const p = hs[1].prompt;
    expect(hs[1].references.map((r) => r.assetId)).toEqual(["sheet-e", "bg-1"]);
    expect(p).toContain("Image reference 2 is the place and props of this scene");
    expect(p).toContain("Continuity rules of this scene (every panel keeps them): 2) 횃불은 화면 오른쪽 벽 4) 칼끝은 화면 왼쪽 아래");
    expect(p).toContain("build and age: 열 살 남자아이, 키 130cm");
    expect(p).toContain("짧은 나무 검");
    expect(p).toContain("a child stays child-sized next to adults");
    // no start of its own: it starts where panel 1 ended
    expect(p).toContain("Where this moment starts (it continues from the panel before — same positions, same hands on the same props): 끝 1.");
    expect(hs[0].prompt).toContain("Where this moment starts (it continues from the panel before — same positions, same hands on the same props): 시작 1.");
    expect(p).toContain("for someone facing the camera their own right hand is on screen-left");
    expect(p).toContain("at exactly this shot size");
  });
});
