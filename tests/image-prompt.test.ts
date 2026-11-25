import { describe, expect, it } from "vitest";
import { createProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, oneSidedFeatures } from "@/lib/domain/handoff";

/** One character, bust shot, with one-sided features written the way the analysis writes them. */
function solo() {
  const d = createProjectData("칼리엘라", 1, "cast");
  d.baseAssetId = "base-1";
  d.cast[0] = {
    ...d.cast[0],
    name: "칼리엘라",
    locks: "1) 불꽃 문신: 캐릭터 본인의 왼쪽 어깨와 팔\n2) 금 암밴드: 캐릭터 본인의 왼쪽 위팔\n3) 진홍 땋은 머리",
    appearance: "짙은 갈색 피부",
    outfit: "붉은 랩 상의",
  };
  d.expressionSetup.framing = "bust";
  d.expressions[0] = {
    ...d.expressions[0],
    emotion: "두려움을 누르는 용기",
    brows: "안쪽이 들립니다.",
    gesture: "화면 오른쪽 손을 가슴에 얹습니다.",
    direction: { facing: "left_3q", pitch: "level", tilt: "none", gaze: "camera", body: "left_3q" },
    imageAssetId: "img-0",
    imageFraming: "bust",
    imageAspect: "3:4",
  };
  d.expressions[1] = {
    ...d.expressions[1],
    emotion: "터져 나오는 슬픔",
    gesture: "화면 오른쪽 손바닥을 심장 위에 얹습니다.",
    direction: { facing: "front", pitch: "down", tilt: "right", gaze: "camera", body: "left_3q" },
  };
  return d;
}

describe("expression image prompt, brought over from Facial Acting Studio (2026-11-25)", () => {
  it("puts the head angle first and says where each one-sided feature shows from that angle", () => {
    const [first, second] = buildExpressionHandoffs(solo()).map((h) => h.prompt);
    expect(first.startsWith("HEAD ANGLE (the main change in this picture): the head turned three-quarter to screen-left")).toBe(true);
    // a feature on an arm goes by the body's direction and stays on that arm
    expect(first).toContain(
      "SIDE CHECK: 금 암밴드 (on the character's own left side) — in this picture it is on the arm at the screen-right shoulder, the one nearer the viewer, and it stays on that arm wherever the hand goes; on the screen-left one the picture would be a mirror image.",
    );
    expect(first).toContain("Turn the head, never mirror the picture");
    // the continuity picture gives the framing, never this moment's head angle
    expect(second).toContain("Image reference 2 (expression 1) shows the head three-quarter view turned toward screen-left; this picture is a different camera angle on the character");
    expect(second).toContain("Do not copy its head angle, gaze, expression or gesture: this moment's are set in this prompt.");
    // the expression text carries the face; the direction is not said a second time
    expect(second).toContain("Expression: moderate 터져 나오는 슬픔.");
    expect(second).not.toContain("Head almost toward the viewer");
  });

  it("keeps a near-front face close to even, and a turned one clearly one-sided", () => {
    const [turned, front] = buildExpressionHandoffs(solo()).map((h) => h.prompt);
    expect(front).toContain("from this near-front angle the two sides stay close to even, one side leading only slightly");
    expect(turned).toContain("Eyes, brows and mouth: asymmetric, one side leading, as strongly as the emotion asks");
    expect(turned).not.toContain("from this near-front angle");
  });

  it("names each hand by its side, joins it to its own arm and keeps a reach inside a bust shot", () => {
    const d = solo();
    const bust = buildExpressionHandoffs(d)[1].prompt;
    expect(bust).toContain("Each hand is the one named, by its side of the picture");
    expect(bust).toContain("Each hand is joined to its own arm in plain view: its forearm comes in from that arm's own side of the picture");
    expect(bust).toContain("Any reach stays close to the body: elbow bent, the hand in front of the chest inside this bust shot");
    expect(bust).toContain("Props: only the ones this body language names");
    // the frame itself crops the figure: no straight cut with a white band under it
    expect(bust).toContain("the image frame itself crops the figure, so the body runs off the bottom edge of the image, with no white band under it");
    d.expressionSetup.framing = "medium";
    expect(buildExpressionHandoffs(d)[1].prompt).not.toContain("Any reach stays close");
    d.expressionSetup.framing = "close_up";
    expect(buildExpressionHandoffs(d)[1].prompt).not.toContain("joined to its own arm");
  });

  it("checks each character's sides in a frame of several characters", () => {
    const d = createProjectData("둘", 2, "cast");
    d.baseAssetId = "base-2";
    d.cast[0] = { ...d.cast[0], name: "브람", locks: "1) 흉터: 캐릭터 본인의 오른쪽 눈썹" };
    d.cast[1] = { ...d.cast[1], name: "하루" };
    d.expressionSetup.framing = "bust";
    const p = buildExpressionHandoffs(d)[0].prompt;
    expect(p).toContain("브람 — SIDE CHECK: 흉터 (on the character's own right side) — in this picture it is on the screen-left side of the head, in view");
    expect(p).not.toContain("하루 — SIDE CHECK");
    expect(p).toContain("Each head is turned to its own angle above, whatever angle the reference images show. Turn the head, never mirror the picture");
    expect(p).toContain("one side of each face leads");
    expect(p).toContain("Each hand is joined to its own arm in plain view");
    expect(p).toContain("The image frame itself crops the figures at this shot size");
  });

  it("reads the side of a feature from the English look or the Korean features", () => {
    expect(oneSidedFeatures(["gold armband on her own left upper arm only", "crimson braids"], "")).toEqual([
      { text: "gold armband on her own left upper arm only", side: "left", part: "arm" },
    ]);
    expect(oneSidedFeatures(null, "1) 관자놀이 장식: 캐릭터 본인의 왼쪽 관자놀이(기본 그림의 화면 오른쪽)")).toEqual([
      { text: "관자놀이 장식 (on the character's own left side)", side: "left", part: "head" },
    ]);
  });
});
