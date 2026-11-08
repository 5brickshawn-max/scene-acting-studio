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
    const out = { summary: "", continuity: "", panels: d.expressions.map((_, i) => ({ title: `p${i}`, action: "a", camera: "c", state: "", speaker: 0, link: "cut" as const })) };
    expect(shotsOf(applyStoryboard(d, out))).toHaveLength(4);
  });

  it("the scene composition proposes at most four shots", () => {
    const st = composeStructure({ mode: "storyboard" }, { duration: 20, shots: Array.from({ length: 6 }, (_, k) => ({ title: `s${k}`, seconds: 3, panels: ["a", "b"] })) });
    expect(st.shots).toBe(4);
    expect(st.panels).toHaveLength(12);
    expect(new Set(st.panels.map((p) => p.shot)).size).toBe(4);
  });
});

describe("shot count and panel count chosen separately", async () => {
  const { evenShots, setPanelCount, syncChosenShots } = await import("@/lib/domain/project");
  it("4 shots × 12 panels: three panels per shot, and the choice is kept", () => {
    let d = setPanelCount(board(6, []), 12);
    d = evenShots(d, 4);
    expect(shotsOf(d).map((s) => s.length)).toEqual([3, 3, 3, 3]);
    expect(d.expressionSetup.shots).toBe(4);
    // changing the panel count keeps four shots, spread again
    d = setPanelCount(d, 8);
    expect(shotsOf(d).map((s) => s.length)).toEqual([2, 2, 2, 2]);
  });
  it("the AI keeps a chosen shot count, moving cuts where it wants", () => {
    const d = evenShots(board(8, []), 2);
    const out = { summary: "", continuity: "", panels: d.expressions.map((_, i) => ({ title: `p${i}`, action: "a", camera: "c", state: "", speaker: 0, link: [2, 5, 6].includes(i) ? ("cut" as const) : ("continuous" as const) })) };
    const next = applyStoryboard(d, out);
    expect(shotsOf(next)).toHaveLength(2);
  });
  it("without a chosen count the AI decides (up to four); a hand edit updates a chosen count", () => {
    const d = board(8, []);
    expect(d.expressionSetup.shots).toBeNull();
    const out = { summary: "", continuity: "", panels: d.expressions.map((_, i) => ({ title: `p${i}`, action: "a", camera: "c", state: "", speaker: 0, link: i === 4 ? ("cut" as const) : ("continuous" as const) })) };
    expect(shotsOf(applyStoryboard(d, out))).toHaveLength(2);
    const chosen = evenShots(board(8, []), 2);
    const edited = syncChosenShots({ ...chosen, expressions: chosen.expressions.map((e, i) => (i === 6 ? { ...e, link: "cut" as const } : e)) });
    expect(edited.expressionSetup.shots).toBe(3);
  });
});
