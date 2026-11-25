import { describe, expect, it } from "vitest";
import { createProjectData } from "@/lib/domain/project";
import {
  buildVideoHandoff,
  CHANGE_DEF_EN,
  CHANGE_ROOM,
  EXTRA_PER_BEAT,
  FACE_LINE_ROOM,
  FACES_IN_MOTION_EN,
  GROUP_NOTES_ROOM,
  NO_PICTURE_ROOM,
  VIDEO_PROMPT_EXTRA_PER_CHARACTER,
  VIDEO_PROMPT_TARGET_ACTING,
} from "@/lib/domain/handoff";
import { buildEnglishSheet, englishStale, freshEnglish } from "@/lib/domain/english";
import { preRenderCheck } from "@/lib/domain/check";

/** 영어 정리 with the acting part, as the AI writes it since 2026-11-25. */
const out = (multi: boolean) => ({
  language: "Old English",
  style: "Thin soft red-brown lines, cel shading with painterly texture.",
  continuity: "",
  arc: "",
  cast: Array.from({ length: multi ? 2 : 1 }, (_, i) => ({
    character: i + 1,
    look:
      i === 0
        ? ["dark chocolate-brown skin", "thick crimson rope braids", "patterned gold armband on her own left upper arm only"]
        : ["silver bob", "scar over his own right brow"],
    outfit: "Crimson wrap top with a gold fringe.",
    voice: i === 0 ? "Late-twenties alto, low and firm." : "Deep, dry baritone.",
  })),
  beats: [0, 1, 2].map((k) => ({
    panel: k + 1,
    emotion: ["fear held by courage", "grief spills", "unshakable resolve"][k],
    face: ["Screen-right inner brow lifts; tears pool.", "Both inner brows lift; tears spill down the screen-right cheek first.", "Brows drop into a level line; eyes locked."][k],
    body: ["Screen-right fist grips the strap.", "Screen-right fist opens flat on her heart.", "Screen-right hand drops to a fist."][k],
    others: multi ? [{ character: 2, emotion: "wary listening", face: "Brows knit, eyes on her.", body: "Arms crossed." }] : [],
    transition: k < 2 ? "On a breath her lids loosen." : "",
    delivery: k < 2 ? 'low, stress on "Wite"' : "",
    state: "",
    mood: ["braced fear", "OPEN GRIEF", "IRON RESOLVE"][k],
    signs: "inner brows raised",
    facework: 'brows: press down on "Wite"; lids: lower lids push up; eyes: on the lens; cheeks: screen-right firms',
    // the AI may name a change for the first beat: the app leaves it out
    change: (["snap", "slow", "snap"] as const)[k],
    trigger: ["Mīcaēl rises in her mind", "the dead Glaucus surfaces", ""][k],
    action: [
      'To draw a line, she inhales deep, shoulders rising high; on "Wite" her screen-right fist presses the strap.',
      "Slowly, over a long breath, baring her heart: lids loosen, tears spill, fist opening flat on her heart.",
      "On a breath and a blink, her face sets hard; her shoulders open wide.",
    ][k],
    hold: k === 2 ? "Pose locked, tears falling, chest heaving." : "",
    result: k === 2 ? "Fists clenched, shoulders open, chin raised." : "",
  })),
  scene: "Kaliela tells him her choice is not for him. Held-back tears give way to open tears.",
  eyeline: 'Eyes hold the lens from a turned head, sink low screen left on "for" and stay',
  frameZero: "She is already inhaling, screen-right fist gripping the chest strap.",
  weight: "her shoulders sink with each exhale",
  heavy: "thick crimson rope braids",
  light: "wine-drop earrings, bead tips",
});

function scene(castCount: number) {
  const d = createProjectData("칼리엘라", castCount, "cast");
  d.baseAssetId = "base-1";
  d.cast[0] = { ...d.cast[0], name: "칼리엘라", locks: "1) 금 암밴드: 캐릭터 본인의 왼쪽 위팔", voice: "낮은 알토" };
  if (castCount > 1) d.cast[1] = { ...d.cast[1], name: "브람", locks: "1) 은발", voice: "굵은 바리톤" };
  d.style = "셀 채색";
  d.expressionSetup.framing = "bust";
  d.expressionSetup.count = 3;
  d.expressionSetup.scene = "칼리엘라가 선을 긋는다.";
  d.expressions = d.expressions.slice(0, 3).map((e, i) => ({
    ...e,
    characterId: d.cast[0].id,
    emotion: ["두려움", "슬픔", "결의"][i],
    gesture: "화면 오른쪽 손을 가슴에.",
    direction: (
      [
        { facing: "left_3q", pitch: "level", tilt: "none", gaze: "camera", body: "left_3q" },
        { facing: "front", pitch: "down", tilt: "right", gaze: "camera", body: "left_3q" },
        { facing: "front", pitch: "up", tilt: "none", gaze: "camera", body: "front" },
      ] as const
    )[i],
    // the second expression has no picture
    imageAssetId: i === 1 ? null : `img-${i}`,
    imageFraming: i === 1 ? null : ("bust" as const),
    imageAspect: i === 1 ? null : castCount > 1 ? "16:9" : "3:4",
  }));
  d.dialogue = { ...d.dialogue, language: "고대 영어", lines: d.expressions.map((e, i) => ({ expressionId: e.id, line: ["Wite þū!", "For Mīcaēle.", ""][i], meaning: "", delivery: "" })) };
  d.acting.duration = 15;
  d.acting.segments = d.expressions.map((e, i) => ({ expressionId: e.id, start: [0, 4.2, 8.5][i], end: [4.2, 8.5, 15][i], transition: "" }));
  d.english = buildEnglishSheet(d, out(castCount > 1));
  return d;
}

describe("the acting written as states, brought over from Facial Acting Studio (2026-11-25)", () => {
  it("keeps the acting part with the sheet: states in capitals, no change into the first beat", () => {
    const d = scene(1);
    expect(englishStale(d)).toEqual([]);
    expect(d.english!.beats.map((b) => [b.mood, b.change])).toEqual([
      ["BRACED FEAR", ""],
      ["OPEN GRIEF", "slow"],
      ["IRON RESOLVE", "snap"],
    ]);
    expect(freshEnglish(d).acting?.frameZero).toBe("She is already inhaling, screen-right fist gripping the chest strap.");
    // a direction set anew writes the acting again; a sheet made before the acting part is due once
    const turned = structuredClone(d);
    turned.expressions[2].direction.facing = "right_3q";
    expect(englishStale(turned)).toEqual(["연기 흐름"]);
    const old = structuredClone(d);
    old.english = { ...old.english!, acting: { key: "", scene: "", eyeline: "", frameZero: "", weight: "", heavy: "", light: "" } };
    expect(englishStale(old)).toEqual(["연기 흐름"]);
    expect(buildVideoHandoff(old).prompt).not.toContain("DIRECTOR'S NOTES:");
  });

  it("writes the video prompt as director's notes, then the shot, the voices, frame zero and the beats", () => {
    const d = scene(1);
    const h = buildVideoHandoff(d);
    const p = h.prompt;
    expect(p.startsWith("15 seconds, 16:9, ONE continuous shot in one unbroken take: every beat below is a moment of this same shot.")).toBe(true);
    const order = ["DIRECTOR'S NOTES:", "1. THE SCENE:", "2. THE EMOTIONAL ARC:", "3. FACE AND BODY:", "4. CONTINUITY:", "5. WEIGHT AND FOLLOW-THROUGH:", "6. CAMERA:", "\nSHOT: ", "\nVoice: ", "\nFrame zero: ", "\n0–4.2s, BRACED FEAR:", "[MOTION"];
    order.reduce((at, x) => {
      const i = p.indexOf(x, at);
      expect(i, x).toBeGreaterThan(-1);
      return i;
    }, 0);
    expect(p).toContain("every change has a trigger: BRACED FEAR → Mīcaēl rises in her mind → OPEN GRIEF → the dead Glaucus surfaces → IRON RESOLVE. Play the transitions.");
    // a calm head, the body carrying the size; breath, blinks and eyes of their own
    expect(p).toContain("a calm head and hair, the size carried by the shoulders, torso and arms, one sizable body action in every beat.");
    expect(p).toContain("BREATH, BLINKS AND EYES, the whole time");
    expect(p).toContain("Each expression change rides on a physical action");
    expect(p).toContain('EYELINE: Eyes hold the lens from a turned head, sink low screen left on "for" and stay; each look lands and rests a moment.');
    // one-sided features first, staying on their side
    expect(p).toContain(
      "Keep visible: patterned gold armband on her own left upper arm only; dark chocolate-brown skin; thick crimson rope braids. A feature on one side stays on the character's own same side at every head angle.",
    );
    // the studio's own blocks stay last, and the negative prompt stays apart
    expect(p.endsWith(h.constraints)).toBe(true);
    expect(h.negativePrompt).toContain("morphing");
    expect(p.length).toBeLessThanOrEqual(h.lengthTarget);
    const ok = preRenderCheck(d, h);
    expect(ok.find((i) => i.area === "구도")?.level).toBe("ok");
    expect(ok.find((i) => i.area === "제약사항")?.level).toBe("ok");
  });

  it("plays every change at one of two speeds, named in the beat and described once", () => {
    const d = scene(1);
    const p = buildVideoHandoff(d).prompt;
    expect(p).toContain(`Every change of expression plays at one of two speeds only, as each beat says. ${CHANGE_DEF_EN.slow} ${CHANGE_DEF_EN.snap} Either way through real in-between steps`);
    expect(p).toContain("4.2–8.5s, OPEN GRIEF: SLOW CHANGE. Slowly, over a long breath, baring her heart");
    // the head goes to another angle in the snap (chin down and tilted → chin up)
    expect(p).toContain("8.5–15s, IRON RESOLVE: SNAP CHANGE, the head straight to its new angle. On a breath and a blink, her face sets hard; her shoulders open wide. A moving hold: Pose locked, tears falling, chest heaving. Result pose: Fists clenched, shoulders open, chin raised.");
    expect(p.match(/SLOW CHANGE: about two seconds/g)).toHaveLength(1);
    // the same head direction as the beat before: the head keeps its angle
    const same = structuredClone(d);
    same.expressions[2].direction = { ...same.expressions[1].direction };
    same.english = buildEnglishSheet(same, out(false));
    expect(buildVideoHandoff(same).prompt).toContain("IRON RESOLVE: SNAP CHANGE, the head keeping its angle.");
  });

  it("gives each beat its face line, its picture or its words, and its line", () => {
    const d = scene(1);
    const h = buildVideoHandoff(d);
    const beat = (k: number) => h.prompt.split("\n\n").find((x) => x.startsWith(`${d.acting.segments[k].start}–${d.acting.segments[k].end}s`))!;
    expect(beat(0)).toContain('Face: brows: press down on "Wite"; lids: lower lids push up; eyes: on the lens; cheeks: screen-right firms.');
    // a look into the lens names its head angle next to the picture
    expect(beat(0)).toContain("Expression target: reference image 2 (head three-quarter to screen-left, eyes on the lens).");
    expect(beat(0)).toContain('Say exactly (Old English): "Wite þū!" — low, stress on "Wite"');
    // no picture: the look and the head direction in words, stopping a little short of the front
    expect(beat(1)).toContain(
      "Expression from this text (the text is this beat's reference): Both inner brows lift; tears spill down the screen-right cheek first. Head almost facing the viewer, a little toward screen-left, chin lowered, tilted toward screen-right; eyes looking at the viewer; body three-quarter view turned toward screen-left.",
    );
    expect(beat(1)).not.toContain("Expression target");
    expect(beat(2)).toContain("Wordless beat: acting in full; only breath and natural sounds are heard.");
    // room for it all in the length target
    const base = buildVideoHandoff({ ...d, english: null });
    expect(h.lengthTarget).toBeGreaterThan(base.lengthTarget);
    expect(VIDEO_PROMPT_TARGET_ACTING + FACE_LINE_ROOM * 3 + CHANGE_ROOM * 2 + NO_PICTURE_ROOM).toBeLessThan(h.lengthTarget);
    expect([EXTRA_PER_BEAT, FACE_LINE_ROOM, CHANGE_ROOM, NO_PICTURE_ROOM]).toEqual([350, 180, 230, 420]);
  });

  it("goes back to the earlier form when the design changed after the English was written", () => {
    const d = scene(1);
    d.expressions[1].brows = "양쪽 눈썹 안쪽이 크게 들립니다.";
    expect(englishStale(d)).toContain("연기 흐름");
    const p = buildVideoHandoff(d).prompt;
    expect(p).not.toContain("DIRECTOR'S NOTES:");
    expect(p.startsWith("ONE single continuous shot with no cuts")).toBe(true);
  });

  it("names who acts and who speaks in a scene of several characters, the listeners staying live", () => {
    const d = scene(2);
    const h = buildVideoHandoff(d);
    const p = h.prompt;
    expect(p.startsWith("15 seconds, 16:9, ONE continuous shot in one unbroken take of 2 characters:")).toBe(true);
    expect(p).toContain("Cast (exactly these 2 characters, always in these screen positions; nobody else): 칼리엘라 (screen-left), 브람 (screen-right).");
    expect(p).toContain("BRACED FEAR (칼리엘라) → Mīcaēl rises in her mind → OPEN GRIEF (칼리엘라)");
    expect(p).toContain("Keep visible — 칼리엘라: patterned gold armband on her own left upper arm only; dark chocolate-brown skin; thick crimson rope braids | 브람: scar over his own right brow; silver bob.");
    expect(p).toContain("Everyone in frame is live: whoever is listening keeps reacting with the eyes, brows, breath and a body action of their own.");
    expect(p).toContain("Dialogue: only the character named for a line speaks it");
    expect(p).toContain("Voices (each character keeps their own voice): 칼리엘라 — Late-twenties alto, low and firm; 브람 — Deep, dry baritone.");
    const first = p.split("\n\n").find((x) => x.startsWith("0–4.2s"))!;
    expect(first.split("\n")).toEqual([
      '0–4.2s, BRACED FEAR — 칼리엘라: To draw a line, she inhales deep, shoulders rising high; on "Wite" her screen-right fist presses the strap.',
      'Face: brows: press down on "Wite"; lids: lower lids push up; eyes: on the lens; cheeks: screen-right firms.',
      "Frame target: reference image 2.",
      "브람 (moderate wary listening): Brows knit, eyes on her. Arms crossed. Pose: head front; eyes at the viewer; body front.",
      '칼리엘라 says exactly (Old English): "Wite þū!" — low, stress on "Wite"',
    ]);
    expect(p).toContain("Frame from this text (the text is this beat's reference): Both inner brows lift");
    expect(p.length).toBeLessThanOrEqual(h.lengthTarget);
    expect(h.lengthTarget - buildVideoHandoff(scene(1)).lengthTarget).toBe(VIDEO_PROMPT_EXTRA_PER_CHARACTER + GROUP_NOTES_ROOM);
  });

  it("carries the rules that hold in any mode into the storyboard prompt", () => {
    const d = createProjectData("콘티", 2, "storyboard");
    d.expressions = d.expressions.map((e, i) => ({ ...e, emotion: `컷 ${i + 1}`, action: `동작 ${i + 1}` }));
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain(FACES_IN_MOTION_EN);
    expect(FACES_IN_MOTION_EN).toContain("Every change of a face plays at one of two speeds only");
    expect(FACES_IN_MOTION_EN).not.toMatch(/\bnever\b|\bno\b|\bnot\b/i);
    // a storyboard has no acting part: nothing of it is asked for
    expect(englishStale(d)).not.toContain("연기 흐름");
  });
});
