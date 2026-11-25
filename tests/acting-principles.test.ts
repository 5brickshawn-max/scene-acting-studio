import { describe, expect, it } from "vitest";
import { ACTING_PRINCIPLES } from "@/lib/ai/prompts";

describe("acting principles brought over from Facial Acting Studio (2026-11-25)", () => {
  it("carries the rules against morphing, mirrored arms and there-and-back looks", () => {
    // two speeds of a change of expression: very slow, or a snap led by a breath and a blink
    expect(ACTING_PRINCIPLES).toContain("표정이 바뀌는 순간은 두 속도 중 하나입니다");
    expect(ACTING_PRINCIPLES).toContain("중간 속도로 스르르 바뀌면 얼굴이 녹듯 바뀝니다(모핑)");
    // eyes and head do not swing there and back
    expect(ACTING_PRINCIPLES).toContain("시선과 고개는 시계추처럼 왔다 갔다 하지 않습니다");
    // a calm head and hair; the body carries the size of the acting
    expect(ACTING_PRINCIPLES).toContain("고개와 머리카락은 차분하게 두고, 연기의 크기는 몸이 맡습니다");
    // the same hand carries on; the two arms are not mirrored between neighbours
    expect(ACTING_PRINCIPLES).toContain("이웃한 표정에서 두 팔의 자세를 좌우로 맞바꾸지 않습니다");
    expect(ACTING_PRINCIPLES).toContain("카메라에 가까운 손");
    // a near-front face is close to even
    expect(ACTING_PRINCIPLES).toContain("좌우 차이의 크기는 고개 방향을 따릅니다");
    // what the face reacts to, what leads
    expect(ACTING_PRINCIPLES).toContain("주도할 요소");
  });

  it("adds no speed-up: everything stays at real speed", () => {
    expect(ACTING_PRINCIPLES).toContain("동작은 실제 속도 그대로");
    expect(ACTING_PRINCIPLES).not.toMatch(/3분의 2|2\/3|1\.5배/);
  });
});
