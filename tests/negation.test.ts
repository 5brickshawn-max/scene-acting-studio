import { describe, expect, it } from "vitest";
import { reconcile, type Adjustment } from "@/lib/domain/constraints";

const run = (t: string, kind: "direction" | "motion" = "direction") => {
  const log: Adjustment[] = [];
  return { out: reconcile(t, kind, "추가 연출", log), log };
};

describe("constraint words the team already forbids", () => {
  it("keeps 'never gliding / NO motion blur / NO morphing' intact (it agrees with the constraints)", () => {
    const t = "CONSTRAINTS : stop-motion stepped cadence on ones at 24fps, every character stepping pose to pose, never gliding. NO motion blur, NO morphing.";
    const { out, log } = run(t);
    expect(out).toBe(t);
    expect(log).toEqual([]);
  });
  it("keeps Korean negations: 모핑 없이, 모션 블러 금지, BGM 금지, NO MUSIC", () => {
    for (const t of ["모핑 없이 포즈에서 포즈로 끊어 움직인다.", "모션 블러 금지.", "BGM 금지, 자연음만.", "NO MUSIC, only natural sound.", "no smooth interpolation."]) {
      expect(run(t).out).toBe(t);
    }
  });
  it("still removes asked-for morphing, smoothness and music", () => {
    expect(run("표정이 모핑처럼 자연스럽게 바뀐다.", "motion").out).not.toContain("모핑");
    expect(run("Her face morphs into a smile.", "motion").out).not.toMatch(/morph/i);
    expect(run("Soft piano music swells. She turns.").out).toBe("She turns.");
    expect(run("천천히 부드럽게 돌아선다.", "motion").out).toBe("천천히 돌아선다.");
  });
});

describe("director paragraphs that only repeat the constraints", async () => {
  const { dropConstraintRepeats } = await import("@/lib/domain/constraints");
  it("drops verbatim constraint paragraphs and keeps ones that add something", () => {
    const t = [
      "CONSTRAINTS : stop-motion stepped cadence on ones at 24fps, every character, creature and moving object stepping pose to pose, never gliding. NO motion blur, NO morphing.",
      "SOUND : Natural sound & Sound effects.",
      "SECONDARY ACTION on ones: whichever loose elements are present (hair, clothing, fabric, straps, accessories, fur) swinging, streaming and settling with follow-through.",
      "CAMERA: slow crane-up over the wall at the end.",
    ].join("\n\n");
    const log: Adjustment[] = [];
    const out = dropConstraintRepeats(t, "추가 연출", log);
    expect(out).toBe("SOUND : Natural sound & Sound effects.\n\nCAMERA: slow crane-up over the wall at the end.");
    expect(log[0].rule).toContain("제약사항과 같은 문단");
    expect(dropConstraintRepeats("CAMERA: slow crane-up.", "추가 연출", [])).toBe("CAMERA: slow crane-up.");
  });
});
