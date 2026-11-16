import { describe, expect, it } from "vitest";
import { createProjectData, setExpressionCount, type ProjectData } from "@/lib/domain/project";
import { buildVideoHandoff, principleLine } from "@/lib/domain/handoff";
import { applyStoryboard } from "@/lib/domain/apply";
import { cameraMoveKinds, guideIssues } from "@/lib/domain/check";
import { PRINCIPLES } from "@/lib/domain/principles";

const board = (): ProjectData => {
  const d = setExpressionCount(createProjectData("점프", 1, "storyboard"), 3);
  d.baseAssetId = "scene-1";
  d.cast[0].name = "모험가";
  d.expressionSetup.continuity = "1) 모험가 화면 왼쪽에서 오른쪽으로 이동";
  d.expressions = d.expressions.map((e, i) => ({ ...e, action: `순간 ${i + 1}`, camera: "고정 풀숏", continuity: "시작: 왼쪽 / 끝: 오른쪽" }));
  return d;
};

describe("8 animation principles (field guide)", () => {
  it("eight principles, each with a movement instruction and a review question", () => {
    expect(PRINCIPLES).toHaveLength(8);
    expect(PRINCIPLES.every((p) => p.en.length > 40 && p.check.endsWith("?"))).toBe(true);
  });

  it("the AI's priority principles are kept (known keys, at most three)", () => {
    const d = board();
    const out = {
      summary: "",
      continuity: "",
      panels: d.expressions.map((_, i) => ({
        title: "t", action: "a", camera: "c", state: "", speaker: 0, link: "continuous" as const,
        principles: (i === 0 ? ["anticipation", "squash_stretch", "timing", "arcs"] : ["follow_through"]) as never,
      })),
    };
    const next = applyStoryboard(d, out);
    expect(next.expressions[0].principles).toEqual(["anticipation", "squash_stretch", "timing"]);
    expect(next.expressions[1].principles).toEqual(["follow_through"]);
  });

  it("the video prompt spells each beat's principles out as movement, and the guide's action order", () => {
    const d = board();
    d.expressions[0].principles = ["anticipation", "follow_through"];
    const p = buildVideoHandoff(d).prompt;
    expect(p).toContain("Motion: before the main action the character first looks at the target and visibly prepares");
    expect(p).toContain("the torso stops first, then the arms");
    expect(p).toContain("Each action reads in order: look, prepare, act, contact, settle");
    expect(principleLine(d.expressions[0], 1)).toBe("Motion priorities: anticipation, follow-through.");
    expect(principleLine(d.expressions[1], 2)).toBe("");
  });
});

describe("guide checks", () => {
  it("one clear camera move per panel", () => {
    expect(cameraMoveKinds("샤르휘나를 축으로 화면 오른쪽 방향 호를 그리며 타이트 쓰리 쇼트까지 천천히 트랙인")).toEqual(["트랙", "오빗"]);
    expect(cameraMoveKinds("고정 풀숏")).toEqual([]);
    expect(cameraMoveKinds("slow push-in")).toEqual(["트랙"]);
    const d = board();
    d.expressions[1].camera = "천천히 돌며 트랙인한 뒤 틸트업";
    expect(guideIssues(d).find((i) => i.area === "카메라 이동")?.text).toContain("2번 컷(틸트+트랙+오빗)");
  });

  it("vague wording and missing hook-ups are flagged", () => {
    const d = board();
    d.expressions[2].action = "자연스럽게 걸어간다";
    d.expressions[1].continuity = "";
    const areas = guideIssues(d).map((i) => `${i.area}: ${i.text}`).join(" | ");
    expect(areas).toContain("모호한 표현: 3번 컷");
    expect(areas).toContain("연결 상태(HU): 2번 컷");
    expect(guideIssues(board())).toEqual([]);
  });
});
