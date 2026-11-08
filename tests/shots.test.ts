import { describe, expect, it } from "vitest";
import { capShots, stepIssues, createProjectData, MAX_SHOTS, setExpressionCount, shotsOf, type ProjectData } from "@/lib/domain/project";
import { applyStoryboard, composeStructure } from "@/lib/domain/apply";

const board = (n: number, cuts: number[]): ProjectData => {
  const d = setExpressionCount(createProjectData("시퀀스", 2, "storyboard"), n);
  return { ...d, expressions: d.expressions.map((e, i) => ({ ...e, action: "x", link: cuts.includes(i) ? ("cut" as const) : ("continuous" as const) })) };
};

describe(`storyboard shots (at most ${MAX_SHOTS})`, () => {
  it("12 panels in 4 shots is fine", () => {
    const d = board(12, [3, 6, 9]);
    expect(shotsOf(d)).toHaveLength(4);
    expect(capShots(d)).toBe(d);
  });

  it("joins the shortest shots into the one before until four remain", () => {
    // shots: [0,1] [2] [3,4,5] [6] [7,8] [9,10,11] → six shots
    const d = capShots(board(12, [2, 3, 6, 7, 9]));
    const shots = shotsOf(d);
    expect(shots).toHaveLength(4);
    expect(shots.map((s) => s.length)).toEqual([3, 4, 2, 3]);
  });

  it("blocks approval of the storyboard step with more than four shots", () => {
    const d = board(8, [1, 2, 3, 4, 5, 6, 7]);
    const blocks = (x: ProjectData) => stepIssues(x, 1).filter((i) => i.level === "block").map((i) => i.message).join(" ");
    expect(blocks(d)).toContain("쇼트가 8개입니다");
    expect(blocks(capShots(d))).not.toContain("쇼트가");
  });

  it("an AI storyboard with too many cuts is brought down to four shots", () => {
    const d = board(8, []);
    const out = { summary: "", panels: d.expressions.map((_, i) => ({ title: `p${i}`, action: "a", camera: "c", speaker: 0, link: "cut" as const })) };
    expect(shotsOf(applyStoryboard(d, out))).toHaveLength(4);
  });

  it("the scene composition proposes at most four shots", () => {
    const st = composeStructure({ mode: "storyboard" }, { duration: 20, shots: Array.from({ length: 6 }, (_, k) => ({ title: `s${k}`, seconds: 3, panels: ["a", "b"] })) });
    expect(st.shots).toBe(4);
    expect(st.panels).toHaveLength(12);
    expect(new Set(st.panels.map((p) => p.shot)).size).toBe(4);
  });
});
