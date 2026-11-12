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
  for (const h of panels) expect(h.prompt, at("panel prompts never ask for 2D")).not.toMatch(/(^|[^\d.])2D(?!\w)/);
  for (const source of ["references", "start_frame"] as const) {
    const h = buildVideoHandoff(d, source);
    const p = h.prompt;
    preRenderCheck(d, h);
    guideIssues(d);
    // the studio block closes the prompt and is written positively
    expect(p.endsWith(h.constraints), at("constraints close the prompt")).toBe(true);
    expect(h.constraints, at("constraints have no 'never/NO' phrasing")).not.toMatch(/never gliding|\bNO [A-Z]|streaming/);
    expect(p, at("prompt never asks for 2D")).not.toMatch(/(^|[^\d.])2D(?!\w)/);
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
