import { setCharacter } from "./helpers";
import { describe, expect, it } from "vitest";
import { approve, createProjectData, parseProjectData, type ProjectData } from "@/lib/domain/project";
import { buildVideoHandoff } from "@/lib/domain/handoff";
import { preRenderCheck, sceneCameraSentences } from "@/lib/domain/check";
import { plannedSeconds, retime, timingMismatch } from "@/lib/domain/timing";
import { appendDirection, applyRetime, applyTextFix, fixState, promptFixRows, removePromptFix, resolveFix, type CheckTextFix } from "@/lib/domain/fixes";
import { PromptCheckOut } from "@/lib/ai/schemas";
import { projectContext } from "@/lib/ai/prompts";

/** A camera plan from the team (written for 8 seconds, while the video is 10). */
const CAMERA = `CAMERA
Continuous 8-second single take in the style of modern film and TV drama. Eye-level Steadicam on a gravity-balanced rig, physically traveling backward. The frame floats throughout with a gentle, low-frequency sway, like a slow pendulum with soft operator breathing, smooth and comfortable to watch. 그리고 인물을 중심으로 회전을 하면 트랙아웃한다.(120도)

SEQUENCE
0–3s: Close-up on the subject's face. The camera eases back very slowly, barely perceptible at first.
3–6s: Backward speed builds gradually with visible weight and momentum, controlled and never rushed. The background opens up with natural parallax.
6–8s: The camera decelerates smoothly and settles into a chest-up bust shot.
End state: Bust shot with the subject centered, subtle sway still alive in the final frame.

CONSTRAINTS
One unbroken shot. Focus stays on the eyes and facial features stay stable. No cuts, zoom, jitter, whip pans, sudden speed changes or locked-off ending.`;

function project(): ProjectData {
  const d = createProjectData("스와르다");
  setCharacter(d, { baseAssetId: "base-1", locks: "1) 베일", appearance: "황금 장신구", style: "고대비 2D" });
  d.acting.duration = 10;
  d.acting.segments = d.acting.segments.map((s, i, all) => ({ ...s, start: (10 * i) / all.length, end: (10 * (i + 1)) / all.length }));
  return d;
}

describe("camera direction lives in 추가 연출", () => {
  it("moves text from the removed camera field to the front of 추가 연출 when a project is read", () => {
    const stored = (camera: string, extraDirection: string) => {
      const raw = JSON.parse(JSON.stringify(createProjectData())) as { video: Record<string, unknown> };
      raw.video.camera = camera;
      raw.video.extraDirection = extraDirection;
      return parseProjectData(raw);
    };
    const merged = stored("카메라가 핸드헬드로 인물을 중심으로 180도 회전한다.", "배경은 사막");
    expect(merged.video.extraDirection).toBe("카메라가 핸드헬드로 인물을 중심으로 180도 회전한다.\n\n배경은 사막");
    expect("camera" in merged.video).toBe(false);
    expect(stored("천천히 트랙아웃", "").video.extraDirection).toBe("천천히 트랙아웃");
    expect(stored("천천히 트랙아웃", "천천히 트랙아웃\n\n배경은 사막").video.extraDirection).toBe("천천히 트랙아웃\n\n배경은 사막");
    expect(stored("", "배경은 사막").video.extraDirection).toBe("배경은 사막");
    // and it reaches the video prompt as the director's own words
    expect(buildVideoHandoff(merged).directorBlock).toContain("180도 회전한다.\n\n배경은 사막");
  });

  it("keeps camera sentences under a CAMERA title as written, but still steps character motion", () => {
    const d = project();
    d.video.extraDirection = CAMERA + "\n\nLIGHT\nHer hair moves smoothly in the breeze.";
    const h = buildVideoHandoff(d);
    expect(h.directorBlock).toContain("smooth and comfortable to watch");
    expect(h.directorBlock).toContain("Her hair moves in the breeze.");
    expect(h.prompt).toContain("Camera: exactly as in the DIRECTOR'S DIRECTION below");
    expect(h.prompt).not.toContain("CAMERA DIRECTION (");
  });

  it("reaches the AI through the project context from step 5", () => {
    const d = project();
    d.video.extraDirection = "LIGHT: warm";
    expect(projectContext(d, 3)).not.toContain("LIGHT: warm");
    expect(projectContext(d, 4)).toContain("추가 연출 (감독 지시, 5단계):\nLIGHT: warm");
  });
});

describe("camera timing", () => {
  it("finds the length a camera plan was written for", () => {
    expect(plannedSeconds(CAMERA)).toBe(8);
    expect(timingMismatch(CAMERA, 10)).toBe(8);
    expect(timingMismatch(CAMERA, 8)).toBeNull();
    expect(plannedSeconds("0~3초 클로즈업, 3~6초 트랙아웃")).toBe(6);
    expect(plannedSeconds("8초짜리 롱테이크")).toBe(8);
    // not the length of the take
    expect(plannedSeconds("a 2-second hold, 24fps, 120도")).toBeNull();
    expect(plannedSeconds("1-2 seconds pause")).toBeNull();
  });

  it("stretches every mark to the video length, keeping the writing as it is", () => {
    const { text, changes } = retime(CAMERA, 10);
    expect(changes).toEqual(["8-second single take → 10-second single take", "0–3s → 0–4s", "3–6s → 4–7.5s", "6–8s → 7.5–10s"]);
    expect(text).toContain("Continuous 10-second single take");
    expect(text).toContain("\n7.5–10s: The camera decelerates smoothly");
    expect(text).toContain("(120도)");
    expect(plannedSeconds(text)).toBe(10);
    expect(retime(CAMERA, 8).changes).toEqual([]);
  });
});

describe("render check fixes", () => {
  it("offers to stretch a camera plan written for another length", () => {
    const d = project();
    d.video.extraDirection = CAMERA;
    const timing = preRenderCheck(d, buildVideoHandoff(d)).find((i) => i.area === "추가 연출 시간");
    expect(timing?.level).toBe("warn");
    expect(timing?.text).toContain("8초 기준인데 영상은 10초");
    expect(timing?.fix).toMatchObject({ kind: "retime", to: 10, label: "10초에 맞추기" });
    const fixed = applyRetime(d, 10);
    expect(fixed.video.extraDirection).toContain("7.5–10s:");
    expect(preRenderCheck(fixed, buildVideoHandoff(fixed)).some((i) => i.area === "추가 연출 시간")).toBe(false);
  });

  it("moves the scene's camera sentences into 추가 연출", () => {
    const d = project();
    d.video.extraDirection = "배경은 사막";
    d.expressionSetup.scene = "반투명 베일 너머로 보이는 스와르다의 이목구비. 베일이 숨결에 미세하게 흔들린다. 천천히 트랙아웃(클로즈업에서 바스트쇼트로)\n스와르다 : “사람들은 나의 아름다움을 축복이라 불렀다.”";
    expect(sceneCameraSentences(d.expressionSetup.scene)).toBe("천천히 트랙아웃(클로즈업에서 바스트쇼트로)");
    const item = preRenderCheck(d, buildVideoHandoff(d)).find((i) => i.area === "상황 설정");
    expect(item?.fix).toEqual({ kind: "append_direction", text: "천천히 트랙아웃(클로즈업에서 바스트쇼트로)", label: "추가 연출로 옮기기" });
    const moved = appendDirection(d, "천천히 트랙아웃(클로즈업에서 바스트쇼트로)");
    expect(moved.video.extraDirection).toBe("배경은 사막\n\n천천히 트랙아웃(클로즈업에서 바스트쇼트로)");
    expect(preRenderCheck(moved, buildVideoHandoff(moved)).some((i) => i.area === "상황 설정")).toBe(false);
  });

  it("gives warnings a way forward: the step to open, or the AI to write the fix", () => {
    const d = project();
    d.video.extraDirection = CAMERA + "\n" + "LIGHT: warm key, soft fill. ".repeat(40);
    const items = preRenderCheck(d, buildVideoHandoff(d));
    const warn = (area: string) => items.find((i) => i.level === "warn" && i.area === area);
    expect(warn("길이")?.fix).toEqual({ kind: "ai_check", label: "AI로 줄일 안 만들기" });
    expect(warn("표정 그림")?.fix).toEqual({ kind: "goto", step: 1, label: "2단계 표정 그림으로" });
  });
});

describe("AI check fixes", () => {
  it("ties each fix to the text it replaces, and drops fixes it cannot place", () => {
    const d = project();
    d.video.extraDirection = CAMERA;
    d.acting.segments[1].transition = "카메라를 향해 손을 뻗는다";
    const id2 = d.expressions[1].id;
    expect(resolveFix(d, { target: "transition", expression: 2, text: "손을 가슴께로 거둔다" })).toEqual({
      target: "transition",
      expression: 2,
      text: "손을 가슴께로 거둔다",
      expressionId: id2,
      before: "카메라를 향해 손을 뻗는다",
    });
    expect(resolveFix(d, { target: "direction", expression: null, text: "  " })).toBeNull();
    expect(resolveFix(d, { target: "gesture", expression: 9, text: "x" })).toBeNull();
    expect(resolveFix(d, { target: "direction", expression: null, text: CAMERA })).toBeNull(); // no change
    // the schema accepts results with and without fixes, and no longer knows the camera field
    const conflict = { severity: "high", where: "a", problem: "p", suggestion: "s", step: 5 };
    expect(PromptCheckOut.parse({ summary: "s", conflicts: [{ ...conflict, fix: { target: "direction", expression: null, text: "t" } }, { ...conflict, fix: null }] }).conflicts).toHaveLength(2);
    expect(PromptCheckOut.safeParse({ summary: "s", conflicts: [{ ...conflict, fix: { target: "camera", expression: null, text: "t" } }] }).success).toBe(false);
  });

  it("changes 추가 연출 directly", () => {
    let d = project();
    d.video.extraDirection = CAMERA;
    for (const s of [0, 1, 2, 3, 4] as const) d = approve(d, s);
    const fix = resolveFix(d, { target: "direction", expression: null, text: CAMERA.replace("그리고 인물을 중심으로 회전을 하면 트랙아웃한다.(120도)", "While traveling back, it also arcs 120° around her.") })!;
    expect(fixState(d, fix)).toBe("ready");
    const next = applyTextFix(d, fix, "한국어 문장");
    expect(next.video.extraDirection).toContain("arcs 120° around her");
    expect(fixState(next, fix)).toBe("applied");
    expect(next.approvedThrough).toBe(3); // only the video step re-opens
    const edited = { ...d, video: { ...d.video, extraDirection: CAMERA + " Slow." } };
    expect(fixState(edited, fix)).toBe("changed");
  });

  it("cannot apply an older result's fix for the removed camera field", () => {
    const d = project();
    const old: CheckTextFix = { target: "camera", expression: null, text: "new camera", expressionId: null, before: "old camera" };
    expect(fixState(d, old)).toBe("changed");
    expect(applyTextFix(d, old, "x")).toBe(d);
  });

  it("fixes an approved step's text only in the video prompt, while that text is unchanged", () => {
    let d = project();
    d.acting.segments[1].transition = "카메라를 향해 손을 뻗는다";
    for (const s of [0, 1, 2, 3, 4] as const) d = approve(d, s);
    const fix = resolveFix(d, { target: "transition", expression: 2, text: "손을 가슴께로 거둔다" })!;
    const next = applyTextFix(d, fix, "카메라가 뒤로 물러나는데 손이 카메라로 다가옴");

    // the acting step keeps its approved text and its approval
    expect(next.acting.segments[1].transition).toBe("카메라를 향해 손을 뻗는다");
    expect(next.approvedThrough).toBe(3);
    expect(fixState(next, fix)).toBe("applied");
    // the video prompt uses the fix
    const prompt = buildVideoHandoff(next).prompt;
    expect(prompt).toContain("다음 표정으로: 손을 가슴께로 거둔다");
    expect(prompt).not.toContain("카메라를 향해 손을 뻗는다");
    expect(promptFixRows(next)).toMatchObject([{ where: "2번 표정 다음 표정으로 넘어가는 연기", active: true }]);

    // when the team rewrites the transition, the fix steps aside
    const rewritten = { ...next, acting: { ...next.acting, segments: next.acting.segments.map((s, i) => (i === 1 ? { ...s, transition: "고개를 숙인다" } : s)) } };
    expect(buildVideoHandoff(rewritten).prompt).toContain("다음 표정으로: 고개를 숙인다");
    expect(promptFixRows(rewritten)[0].active).toBe(false);
    expect(fixState(rewritten, fix)).toBe("changed");

    // and it can be undone
    const undone = removePromptFix(next, next.video.promptFixes[0]);
    expect(undone.video.promptFixes).toEqual([]);
    expect(buildVideoHandoff(undone).prompt).toContain("카메라를 향해 손을 뻗는다");
  });
});
