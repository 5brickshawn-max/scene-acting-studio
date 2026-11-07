import { setCharacter } from "./helpers";
import { describe, expect, it } from "vitest";
import {
  approve,
  canApprove,
  createProjectData,
  directionIssues,
  facesOppositeSides,
  parseProjectData,
  reopenFrom,
  setDuration,
  setExpressionCount,
  distributionPlans,
  stepIssues,
  timelineIssues,
  type ProjectData,
} from "@/lib/domain/project";
import { applyActing, applyCharacter, applyExpressions } from "@/lib/domain/apply";
import { buildExpressionHandoffs, buildVideoHandoff, languageEn, shortLocks, VIDEO_PROMPT_TARGET, videoReferences } from "@/lib/domain/handoff";
import { hasCameraMove, reconcile, STUDIO_CONSTRAINTS, type Adjustment } from "@/lib/domain/constraints";
import { continuityAnchor, imageIsStale, ratioLabel } from "@/lib/domain/project";
import { indexedJobIds } from "@/lib/higgsfield/gen";
import { estimateSpeechSeconds } from "@/lib/domain/speech";

function readyCharacter(): ProjectData {
  const d = createProjectData("캐시");
  setCharacter(d, { baseAssetId: "base-1", locks: "1) 비대칭 헤어", appearance: "호박색 눈", style: "고대비 2D" });
  return d;
}

describe("approval flow", () => {
  it("blocks step 1 approval until required fields exist", () => {
    const d = createProjectData();
    expect(canApprove(d, 0)).toBe(false);
    expect(canApprove(readyCharacter(), 0)).toBe(true);
  });

  it("cannot approve a step before the previous one", () => {
    const d = readyCharacter();
    d.expressions.forEach((e) => (e.emotion = "웃음"));
    expect(canApprove(d, 1)).toBe(false);
    expect(canApprove(approve(d, 0), 1)).toBe(true);
  });

  it("editing an approved step re-opens it and later steps only", () => {
    let d = approve(readyCharacter(), 0);
    d.expressions.forEach((e) => (e.emotion = "웃음"));
    d = approve(d, 1);
    expect(d.approvedThrough).toBe(1);
    expect(reopenFrom(d, 1).approvedThrough).toBe(0);
    expect(reopenFrom(d, 3).approvedThrough).toBe(1);
  });
});

describe("directions", () => {
  it("AI-estimated directions block approval until confirmed", () => {
    let d = approve(readyCharacter(), 0);
    d = applyExpressions(d, {
      summary: "",
      styleWarning: null,
      expressions: d.expressions.map((_, i) => ({
        character: 1, others: "", panel: i + 1, emotion: `감정${i}`, intensity: "medium", brows: "", eyes: "", mouth: "", notes: "", gesture: i === 0 ? "손을 가슴에" : "",
        facing: i < 2 ? "left_3q" : "right_3q", pitch: "level", tilt: "none", gaze: "camera", body: i < 2 ? "left_3q" : "right_3q",
        directionEvidence: "",
      })),
    });
    expect(d.expressions[0].direction.facing).toBe("left_3q");
    expect(d.expressions[2].direction.facing).toBe("right_3q");
    expect(canApprove(d, 1)).toBe(false);
    d.expressions.forEach((e) => (e.directionStatus = "confirmed"));
    expect(canApprove(d, 1)).toBe(true);
  });

  it("warns when head and body face opposite sides", () => {
    expect(facesOppositeSides("left_3q", "right_3q")).toBe(true);
    expect(facesOppositeSides("front", "right_3q")).toBe(false);
    const e = createProjectData().expressions[0];
    e.direction = { ...e.direction, facing: "right_3q", body: "left_3q" };
    expect(directionIssues(e, 0).some((i) => i.level === "warn")).toBe(true);
  });
});

describe("expression count & timeline", () => {
  it("resizes expressions and keeps the timeline contiguous", () => {
    const d = setExpressionCount(createProjectData(), 6);
    expect(d.expressions).toHaveLength(6);
    expect(timelineIssues(d)).toEqual([]);
    expect(setExpressionCount(d, 20).expressions).toHaveLength(12);
  });

  it("detects gaps and overruns", () => {
    const d = createProjectData();
    d.acting.segments[1].start += 0.5;
    expect(timelineIssues(d).length).toBeGreaterThan(0);
    d.acting.duration = 90;
    expect(stepIssues(d, 3).some((i) => i.message.includes("60초"))).toBe(true);
  });

  it("keeps the fixed total length when applying an AI distribution", () => {
    const d = createProjectData();
    const out = applyActing(d, {
      summary: "",
      duration: 75,
      segments: [
        { panel: 2, start: 3, end: 5, transition: "" },
        { panel: 1, start: 0, end: 3, transition: "" },
        { panel: 3, start: 5, end: 7, transition: "" },
      ],
    });
    expect(out.acting.duration).toBe(8);
    expect(timelineIssues(out)).toEqual([]);
    expect(out.acting.segments[0].expressionId).toBe(d.expressions[0].id);
    expect(out.acting.segments).toHaveLength(4); // the omitted 4th expression is appended
  });

  it("allows 2 to 8 expressions", () => {
    expect(setExpressionCount(createProjectData(), 1).expressions).toHaveLength(2);
    expect(timelineIssues(setExpressionCount(createProjectData(), 2))).toEqual([]);
  });

  it("changing the total length keeps each segment's share", () => {
    let d = createProjectData();
    d = { ...d, acting: { ...d.acting, segments: d.acting.segments.map((s, i) => ({ ...s, start: [0, 4, 5, 6][i], end: [4, 5, 6, 8][i] })) } };
    const out = setDuration(d, 16);
    expect(out.acting.duration).toBe(16);
    expect(out.acting.segments.map((s) => s.end)).toEqual([8, 10, 12, 16]);
    expect(timelineIssues(out)).toEqual([]);
  });

  it("offers distribution plans that all fill the fixed length", () => {
    const d = createProjectData();
    d.dialogue.lines = [{ expressionId: d.expressions[0].id, line: "그게 계획이라고? 정말로?", meaning: "", delivery: "" }];
    const plans = distributionPlans(d);
    expect(plans.map((p) => p.key)).toEqual(["even", "speech", "open", "close", "build"]);
    for (const p of plans) expect(timelineIssues({ ...d, acting: { ...d.acting, segments: p.segments } })).toEqual([]);
    const speech = plans.find((p) => p.key === "speech")!.segments;
    expect(speech[0].end - speech[0].start).toBeGreaterThan(speech[1].end - speech[1].start);
  });

  it("checks the total length in step 2 and warns when dialogue overflows it", () => {
    const d = createProjectData();
    d.acting.duration = 90;
    expect(stepIssues(d, 1).some((i) => i.level === "block" && i.message.includes("전체 길이"))).toBe(true);
    const e = createProjectData();
    e.acting.duration = 2;
    e.dialogue.lines = [{ expressionId: e.expressions[0].id, line: "이건 정말 아주 아주 긴 대사라서 이초 안에 말할 수가 없습니다", meaning: "", delivery: "" }];
    expect(stepIssues(e, 2).some((i) => i.level === "warn")).toBe(true);
  });
});

describe("applying AI proposals", () => {
  it("applies only the picked character fields and merges questions", () => {
    const d = readyCharacter();
    const out = applyCharacter(
      d,
      { summary: "", locks: "NEW", appearance: "NEW", outfit: "NEW", style: "NEW", questions: ["왕관 탈착?"] },
      ["outfit", "questions"],
    );
    expect(out.cast[0].locks).toBe("1) 비대칭 헤어");
    expect(out.cast[0].outfit).toBe("NEW");
    expect(out.cast[0].questions).toEqual([{ question: "왕관 탈착?", answer: "" }]);
  });
});

describe("hand-off prompts", () => {
  it("builds one portrait 3:4 single-character prompt per expression with only its reference panel", () => {
    const d = readyCharacter();
    d.expressionSetup.refAssetId = "ref-1";
    d.expressions[1].panel = 3;
    d.expressions[0].panel = null;
    const items = buildExpressionHandoffs(d);
    expect(items).toHaveLength(4);
    expect(items[0].references.map((r) => r.assetId)).toEqual(["base-1"]);
    expect(items[1].references.map((r) => r.assetId)).toEqual(["base-1", "ref-1"]);
    expect(items[1].prompt).toContain("Use ONLY panel 3");
    expect(items[1].prompt).toContain("bust shot");
    expect(items[1].prompt).toContain("portrait 3:4");
    expect(items[1].aspectRatio).toBe("3:4");
  });

  it("video prompt numbers each expression image as its own reference", () => {
    const d = readyCharacter();
    d.expressions[0].imageAssetId = "img-1";
    d.expressions[1].imageAssetId = "img-2";
    d.expressions[0].emotion = "교활한 미소";
    d.dialogue.lines = [{ expressionId: d.expressions[0].id, line: "Think again.", meaning: "", delivery: "비꼬듯" }];
    const refs = videoReferences(d);
    expect(refs.map((r) => r.assetId)).toEqual(["base-1", "img-1", "img-2"]);
    const v = buildVideoHandoff(d);
    expect(v.prompt).toContain("Reference images (upload in this order):");
    expect(v.prompt).toContain("1. 0–2 seconds: 교활한 미소");
    expect(v.prompt).toContain("Expression target: reference image 2.");
    expect(v.prompt).toContain('"Think again."');
    expect(v.prompt).toContain("Do not render a grid");
    const sf = buildVideoHandoff(d, "start_frame");
    expect(sf.references).toEqual([]);
    expect(sf.prompt).toContain("Use the start frame");
  });

  it("maps batch job ids by request index", () => {
    expect(indexedJobIds({ jobs: [{ index: 1, job_id: "b" }, { index: 0, job_id: "a" }] }, 2)).toEqual(["a", "b"]);
    expect(indexedJobIds({ items: [{ jobId: "x" }] }, 1)).toEqual(["x"]);
  });
});

describe("misc", () => {
  it("parses partial/old data without crashing", () => {
    const d = parseProjectData({ character: { name: "옛 작업" } });
    expect(d.title).toBe("옛 작업");
    expect(d.cast).toHaveLength(1);
    expect(d.cast[0].name).toBe("옛 작업");
    expect(d.expressions).toHaveLength(4);
  });
  it("estimates Korean speech time", () => {
    expect(estimateSpeechSeconds("그게 계획이라고?")).toBeCloseTo(1.6, 1);
  });
});

describe("Higgsfield models", async () => {
  const { VIDEO_MODELS, videoDuration, IMAGE_MODELS } = await import("@/lib/higgsfield/models");
  it("clamps the acting length to each video model's range", () => {
    expect(videoDuration(VIDEO_MODELS.minimax_h3, 20)).toBe(15);
    expect(videoDuration(VIDEO_MODELS.kling4_0, 2)).toBe(3);
    expect(videoDuration(VIDEO_MODELS.seedance_2_5, 8.2)).toBe(9);
  });
  it("offers the requested models and resolutions", () => {
    expect(Object.keys(IMAGE_MODELS)).toEqual(["nano_banana_2_1", "gpt_image_2_5"]);
    expect(IMAGE_MODELS.gpt_image_2_5.params.resolution).toBe("1k");
    expect(VIDEO_MODELS.kling4_0.resolutions.map((r) => r.key)).toEqual(["720p", "1080p"]);
    expect(VIDEO_MODELS.seedance_2_5.resolutions[0].params).toMatchObject({ draft: true, resolution: "480p" });
  });
  it("reference-mode video prompt asks for a single character", () => {
    const d = createProjectData("캐시");
    expect(buildVideoHandoff(d, "references").prompt).toContain("Only one character appears");
    expect(buildVideoHandoff(d, "start_frame").prompt).toContain("Use the start frame");
  });
});

describe("timeline coverage", () => {
  it("blocks unknown expressions and warns about missing ones", () => {
    const d = createProjectData();
    const ok = timelineIssues(d);
    expect(ok.filter((i) => i.level === "block")).toHaveLength(0);
    const bad = { ...d, acting: { ...d.acting, segments: d.acting.segments.map((s, i) => (i === 0 ? { ...s, expressionId: "gone" } : s)) } };
    const msgs = timelineIssues(bad).map((i) => i.message).join(" ");
    expect(msgs).toContain("지금 없는 표정");
    expect(msgs).toContain("빠진 표정이 1개");
  });
});

describe("no squeezing", async () => {
  const sharp = (await import("sharp")).default;
  const { padToAspect, paddedSize } = await import("@/lib/higgsfield/pad");
  it("pads square references to the video shape instead of stretching", async () => {
    expect(paddedSize(1024, 1024, "16:9")).toEqual({ width: 1820, height: 1024 });
    expect(paddedSize(1024, 1024, "9:16")).toEqual({ width: 1024, height: 1820 });
    expect(paddedSize(1920, 1080, "16:9")).toBeNull();
    const sq = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const out = (await padToAspect(sq, "16:9"))!;
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([178, 100]);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number) => Array.from(data.subarray((50 * 178 + x) * meta.channels!, (50 * 178 + x) * meta.channels! + 3));
    expect(px(2)).toEqual([255, 255, 255]);
    expect(px(89)).toEqual([255, 0, 0]);
  });
  it("video prompt forbids stretching", () => {
    expect(buildVideoHandoff(createProjectData("x")).prompt).toContain("Never stretch the character horizontally");
  });
});


describe("framing and gestures", () => {
  it("defaults to a bust shot and reads older data without the new fields", () => {
    const d = createProjectData();
    expect(d.expressionSetup.framing).toBe("bust");
    const raw = JSON.parse(JSON.stringify(d));
    delete raw.expressionSetup.framing;
    raw.expressions.forEach((e: Record<string, unknown>) => {
      delete e.gesture;
      delete e.imageFraming;
    });
    const p = parseProjectData(raw);
    expect(p.expressionSetup.framing).toBe("bust");
    expect(p.expressions[0].gesture).toBe("");
    expect(p.expressions[0].imageFraming).toBeNull();
  });

  it("image prompts follow the shot size and act with the hands only when they are in frame", () => {
    const d = readyCharacter();
    d.expressions[0].emotion = "당황";
    d.expressions[0].gesture = "왼손 손끝으로 입가를 가림";
    d.expressions[1].emotion = "삐침";
    const bust = buildExpressionHandoffs(d);
    expect(bust[0].prompt).toContain("Body language: 왼손 손끝으로 입가를 가림.");
    expect(bust[0].prompt).toContain("five fingers");
    expect(bust[1].prompt).toContain('choose a natural arm and hand gesture that expresses "삐침"');
    expect(bust[1].prompt).toContain("near the face, hair or chest");

    d.expressionSetup.framing = "medium";
    const medium = buildExpressionHandoffs(d);
    expect(medium[0].prompt).toContain("medium shot (MS, waist shot)");
    expect(medium[1].prompt).toContain("readable across the whole upper body");

    d.expressionSetup.framing = "close_up";
    const cu = buildExpressionHandoffs(d);
    expect(cu[0].prompt).toContain("close-up (CU)");
    expect(cu[0].prompt).not.toContain("Body language");
    expect(cu.every((x) => x.aspectRatio === "3:4")).toBe(true);
  });

  it("warns when an image was made at another shot size (or is an older square image)", () => {
    const d = readyCharacter();
    d.expressions[0].imageAssetId = "old-square";
    d.expressions[1].imageAssetId = "new";
    d.expressions[1].imageFraming = "bust";
    d.expressions[1].imageAspect = "3:4";
    const msg = stepIssues(d, 1).map((i) => i.message).join(" ");
    expect(msg).toContain("표정 그림 1장이 지금 구도·비율(바스트 샷 (BS), 세로 3:4)로 만든 그림이 아닙니다");
    d.expressionSetup.framing = "medium";
    expect(stepIssues(d, 1).map((i) => i.message).join(" ")).toContain("표정 그림 2장이");
  });

  it("video prompt uses the shot size and carries each expression's gesture", () => {
    const d = readyCharacter();
    d.expressions[0].gesture = "팔짱을 낌";
    const bust = buildVideoHandoff(d).prompt;
    expect(bust).toContain("bust shot framing (cut at the chest)");
    expect(bust).toContain("팔·손: 팔짱을 낌");
    expect(bust).toContain("Arms and hands act together with the face");
    d.expressionSetup.framing = "close_up";
    const cu = buildVideoHandoff(d).prompt;
    expect(cu).toContain("close-up framing");
    expect(cu).not.toContain("팔·손");
    expect(cu).not.toContain("Arms and hands act");
  });

  it("applies AI gestures, and keeps the current one for proposals made before gestures existed", () => {
    const d = readyCharacter();
    d.expressions[1].gesture = "기존 동작";
    const out = {
      summary: "",
      styleWarning: null,
      expressions: d.expressions.map((_, i) => ({
        character: 1, others: "", panel: null, emotion: `감정${i}`, intensity: "medium" as const, brows: "", eyes: "", mouth: "", notes: "",
        gesture: "손을 허리에", facing: "front" as const, pitch: "level" as const, tilt: "none" as const, gaze: "camera" as const,
        body: "front" as const, directionEvidence: "",
      })),
    };
    expect(applyExpressions(d, out).expressions[0].gesture).toBe("손을 허리에");
    const legacy = {
      ...out,
      expressions: out.expressions.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== "gesture"))),
    } as unknown as typeof out;
    expect(applyExpressions(d, legacy).expressions[1].gesture).toBe("기존 동작");
  });
});


describe("compact video prompt and image composition", () => {
  const long = (t: string, n: number) => Array.from({ length: n }, (_, i) => `${t} ${i + 1}번째 문장입니다.`).join(" ");
  const heavy = () => {
    const d = readyCharacter();
    d.cast[0].locks = "1. 불꽃·가시 형태 금관: 이마 중앙에 붉은 보석 2. 붉은 보석 귀걸이: 금 테두리 3. 호박색 눈동자 4. 금색 초커 5. 망토 6. 팔찌 7. 반지 8. 허리띠";
    d.style = long("선과 채색 설명", 20);
    d.cast[0].voice = long("목소리 설명", 20);
    d.dialogue.language = "영국 영어";
    d.expressions = d.expressions.slice(0, 3);
    d.expressions.forEach((e, i) => {
      e.imageAssetId = `img-${i}`;
      e.emotion = `감정${i + 1}`;
      e.brows = long("눈썹을 움직입니다", 6);
      e.eyes = long("눈을 움직입니다", 6);
      e.mouth = long("입을 움직입니다", 6);
      e.gesture = long("손을 움직입니다", 6);
    });
    d.dialogue.lines = d.expressions.map((e, i) => ({ expressionId: e.id, line: `Line ${i + 1}.`, meaning: "", delivery: long("천천히 말합니다", 8) }));
    d.acting.segments = d.expressions.map((e, i) => ({ expressionId: e.id, start: i * 2.5, end: (i + 1) * 2.5, transition: long("다음으로", 5) }));
    d.acting.duration = 7.5;
    return d;
  };

  it("keeps long designs under the target length, with the full text in the team summary", () => {
    const h = buildVideoHandoff(heavy());
    expect(h.prompt.length).toBeLessThanOrEqual(VIDEO_PROMPT_TARGET);
    expect(h.prompt).toContain('Say exactly (British English): "Line 1."');
    expect(h.prompt).toContain("Expression target: reference image 4.");
    expect(h.promptKo).toContain("눈썹을 움직입니다 6번째 문장입니다");
    expect(h.prompt).not.toContain("눈썹을 움직입니다 6번째 문장입니다");
  });

  it("lists key features instead of the whole character description", () => {
    expect(shortLocks("1. 불꽃·가시 형태 금관: 이마 중앙에 붉은 보석 2. 붉은 보석 귀걸이. 금 테두리 3. 호박색 눈동자")).toEqual([
      "불꽃·가시 형태 금관",
      "붉은 보석 귀걸이",
      "호박색 눈동자",
    ]);
    const p = buildVideoHandoff(heavy()).prompt;
    expect(p).toContain("Keep visible: 불꽃·가시 형태 금관, 붉은 보석 귀걸이");
    expect(p).not.toContain("Identity requirements");
    expect(p).toContain("character design — may show several views of the same character");
  });

  it("reads a list written one item per line, up to item 10 (no stray numbers like ‘10’)", () => {
    const locks = [
      "1. 머리색: 짙은 남색~인디고 블루(보라 기운). 허리 아래까지 오는 긴 생머리.",
      "2. 앞머리: 눈썹을 덮는 두꺼운 일자(뱅) 앞머리.",
      "3. 얼굴 양옆의 가는 땋은 머리 두 가닥. 쇄골~가슴 높이에서 묶음.",
      "4. 머리띠: 금테를 두른 파란 밴드.",
      "5. 얼굴 옆으로 늘어진 가는 금색 리본 끈.",
      "6. 눈: 파란~청보라 홍채.",
      "7. 양쪽 볼의 연보라색 원형 마크.",
      "8. 목의 짙은 갈색 초커.",
      "9. 흰색 크롭탑과 양팔 위팔의 금색 암밴드.",
      "10. 피부는 밝고 흰 편. 입술은 차분한 핑크~모브 톤.",
    ].join("\n");
    expect(shortLocks(locks, 10)).toEqual([
      "머리색",
      "앞머리",
      "얼굴 양옆의 가는 땋은 머리 두 가닥",
      "머리띠",
      "얼굴 옆으로 늘어진 가는 금색 리본 끈",
      "눈",
      "양쪽 볼의 연보라색 원형 마크",
      "목의 짙은 갈색 초커",
      "흰색 크롭탑과 양팔 위팔의 금색 암밴드",
      "피부는 밝고 흰 편",
    ]);
    const d = heavy();
    d.cast[0].locks = locks;
    expect(buildVideoHandoff(d).prompt).toMatch(/Keep visible: 머리색, 앞머리, 얼굴 양옆의 가는 땋은 머리 두 가닥/);
    expect(shortLocks("- 붉은 망토\n- 금색 왕관: 다섯 갈래")).toEqual(["붉은 망토", "금색 왕관"]);
    expect(shortLocks("키 1.5배 큰 모자")).toEqual(["키 1.5배 큰 모자"]);
  });

  it("uses one camera instruction: locked by default, the team's own direction when it mentions the camera", () => {
    const d = heavy();
    const still = buildVideoHandoff(d).prompt;
    expect(still).toContain("Camera move: none");
    expect(still).toContain("never lunge into the camera");
    d.video.extraDirection = "배경 흰색 단색, 카메라가 컷별로 무빙";
    const moving = buildVideoHandoff(d);
    expect(moving.cameraMove).toBe(true);
    expect(moving.prompt).toContain("Camera: exactly as in the DIRECTOR'S DIRECTION below");
    expect(moving.prompt).not.toContain("Camera move: none");
    expect(moving.prompt).toContain("DIRECTOR'S DIRECTION (the director's own words");
    expect(moving.prompt).toContain("\n배경 흰색 단색, 카메라가 구간별로 무빙\n");
  });

  it("asks for voice only and names the language in English", () => {
    const d = heavy();
    expect(buildVideoHandoff(d).prompt).toContain("NO MUSIC, only natural sound.");
    expect(languageEn("고대 영어")).toBe("Old English");
    expect(languageEn("불어")).toBe("French");
    expect(languageEn("Klingon")).toBe("Klingon");
    d.dialogue.language = "고대영어";
    const p = buildVideoHandoff(d).prompt;
    expect(p).toContain("Say exactly (Old English)");
    expect(p).toContain('þ and ð as "th"');
  });

  it("image prompts fix where the tall frame cuts and keep headwear inside", () => {
    const d = readyCharacter();
    const bust = buildExpressionHandoffs(d)[0].prompt;
    expect(bust).toContain("the waist, belt and hips are NOT visible");
    expect(bust).toContain("Headroom:");
    expect(bust).toContain("never show more of the body than the shot size allows");
    d.expressionSetup.framing = "medium";
    expect(buildExpressionHandoffs(d)[0].prompt).toContain("cuts at the waist around the navel");
    d.expressionSetup.framing = "close_up";
    const cu = buildExpressionHandoffs(d)[0].prompt;
    expect(cu).toContain("fills more than half of the image height");
    expect(cu).not.toContain("gesturing hands");
  });
});


describe("studio constraints and automatic reconciliation", () => {
  it("always ends the video prompt with the constraints, unchanged", () => {
    const d = readyCharacter();
    expect(buildVideoHandoff(d).prompt.endsWith(STUDIO_CONSTRAINTS)).toBe(true);
    expect(buildVideoHandoff(d, "start_frame").prompt.endsWith(STUDIO_CONSTRAINTS)).toBe(true);
    d.expressionSetup.framing = "close_up";
    d.video.extraDirection = "카메라가 천천히 다가감";
    expect(buildVideoHandoff(d).prompt.endsWith(STUDIO_CONSTRAINTS)).toBe(true);
    expect(STUDIO_CONSTRAINTS).toContain("NO smooth interpolation, NO motion blur, NO morphing. NO MUSIC, only natural sound.");
    expect(STUDIO_CONSTRAINTS).toContain("(If a camera move is specified) HANDHELD");
  });

  it("stresses ONE continuous shot with no cuts", () => {
    const p = buildVideoHandoff(readyCharacter()).prompt;
    expect(p.startsWith("ONE single continuous shot with no cuts")).toBe(true);
    expect(buildExpressionHandoffs(readyCharacter())[0].prompt).toContain("one moment of ONE continuous shot with no cuts");
  });

  it("detects camera moves, but not a held camera or unrelated words", () => {
    expect(hasCameraMove(["카메라가 천천히 다가감"])).toBe(true);
    expect(hasCameraMove(["줌인으로 강조"])).toBe(true);
    expect(hasCameraMove(["slow push-in on the face"])).toBe(true);
    expect(hasCameraMove(["카메라 고정, 배경 흰색"])).toBe(false);
    expect(hasCameraMove(["달리 말하면 화가 남"])).toBe(false);
    expect(hasCameraMove([""])).toBe(false);
  });

  it("rewrites what contradicts the constraints, field by field, and reports it", () => {
    const log: Adjustment[] = [];
    expect(reconcile("컷이 전환되며 고개를 돌림", "voice", "a", log)).toBe("표정이 전환되며 고개를 돌림");
    expect(reconcile("카메라가 컷별로 무빙", "direction", "b", log)).toBe("카메라가 구간별로 무빙");
    expect(reconcile("부드럽게 고개를 돌리며 모핑처럼 자연스럽게, 시선이 먼저 움직임", "motion", "c", log)).toBe("고개를 돌리며, 시선이 먼저 움직임");
    // the director's camera sentences are theirs: the gimbal and its "부드럽게" stay, the music goes
    expect(reconcile("잔잔한 배경음악, 카메라가 천천히 다가감, 짐벌로 부드럽게", "direction", "d", log)).toBe("카메라가 천천히 다가감, 짐벌로 부드럽게");
    expect(log.map((x) => x.where)).toEqual(["a", "b", "c", "d"]);
    expect(log[2].rule).toContain("모핑");
    expect(log[2].rule).toContain("부드럽게");
    expect(log.every((x) => x.rule && x.before !== x.after)).toBe(true);
  });

  it("keeps what does not contradict: soft voice, haircut names, a held camera without moves", () => {
    const log: Adjustment[] = [];
    expect(reconcile("느리고 부드럽게 말합니다. 음악적인 억양으로", "voice", "a", log)).toBe("느리고 부드럽게 말합니다. 음악적인 억양으로");
    expect(reconcile("숏컷 머리가 흔들림", "motion", "b", log)).toBe("숏컷 머리가 흔들림");
    expect(reconcile("카메라 고정, 배경 흰색", "direction", "c", log)).toBe("카메라 고정, 배경 흰색");
    expect(reconcile("부드러운 미소", "face", "d", log)).toBe("부드러운 미소");
    // line breaks alone are never a "change"
    expect(reconcile("CAMERA\nEye-level Steadicam.\n\nLIGHT\nWarm key.", "direction", "e", log)).toBe("CAMERA\nEye-level Steadicam.\n\nLIGHT\nWarm key.");
    expect(log).toEqual([]);
  });

  it("the prompt uses the adjusted texts while the team summary keeps the original wording", () => {
    const d = readyCharacter();
    d.expressions[0].imageAssetId = "img-0";
    d.dialogue.lines = [{ expressionId: d.expressions[0].id, line: "Hm.", meaning: "", delivery: "컷이 전환되며 낮게 말함" }];
    d.acting.segments[0].transition = "모핑처럼 부드럽게 넘어감";
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain("표정이 전환되며 낮게 말함");
    expect(h.prompt).not.toContain("컷이 전환되며");
    expect(h.prompt).not.toContain("모핑");
    expect(h.promptKo).toContain("컷이 전환되며 낮게 말함");
    expect(h.promptKo).toContain("모핑처럼 부드럽게 넘어감");
    expect(h.adjustments.map((a) => a.where)).toEqual(expect.arrayContaining(["1번 표정 대사 말투", "1번 구간 ‘다음 표정으로’"]));
  });
});

describe("continuity anchor (연결 기준 그림) and 3:4 images", () => {
  const withImages = () => {
    const d = readyCharacter();
    d.expressions.forEach((e, i) => {
      e.emotion = `감정${i + 1}`;
    });
    return d;
  };

  it("labels aspect ratios and spots images in another format", () => {
    expect(ratioLabel(768, 1024)).toBe("3:4");
    expect(ratioLabel(752, 1344)).toBe("9:16");
    expect(ratioLabel(1000, 1000)).toBe("1:1");
    const e = withImages().expressions[0];
    e.imageAssetId = "x";
    e.imageFraming = "bust";
    e.imageAspect = "9:16";
    expect(imageIsStale(e, "bust")).toBe(true);
    e.imageAspect = "3:4";
    expect(imageIsStale(e, "bust")).toBe(false);
    expect(imageIsStale(e, "medium")).toBe(true);
  });

  it("picks the first expression on the timeline whose image matches the current shot", () => {
    const d = withImages();
    expect(continuityAnchor(d)).toBeNull();
    const [a, b, c] = d.expressions;
    Object.assign(c, { imageAssetId: "img-c", imageFraming: "bust", imageAspect: "3:4" });
    Object.assign(a, { imageAssetId: "img-a-old", imageFraming: "bust", imageAspect: "9:16" }); // older format: not an anchor
    expect(continuityAnchor(d)?.id).toBe(c.id);
    // put b first on the timeline and give it a current image: it becomes the anchor
    d.acting.segments = [d.acting.segments[1], d.acting.segments[0], ...d.acting.segments.slice(2)];
    Object.assign(b, { imageAssetId: "img-b", imageFraming: "bust", imageAspect: "3:4" });
    expect(continuityAnchor(d)?.id).toBe(b.id);
  });

  it("draws every other expression to match the anchor, not the anchor itself", () => {
    const d = withImages();
    Object.assign(d.expressions[0], { imageAssetId: "img-anchor", imageFraming: "bust", imageAspect: "3:4" });
    const items = buildExpressionHandoffs(d);
    expect(items[0].references.map((r) => r.assetId)).toEqual(["base-1"]);
    expect(items[0].prompt).not.toContain("another moment of this SAME shot");
    for (const it of items.slice(1)) {
      expect(it.references.map((r) => r.assetId)).toEqual(["base-1", "img-anchor"]);
      expect(it.references[1].why).toContain("연결 기준: 1번 표정 그림");
      expect(it.prompt).toContain("Image reference 2 is another moment of this SAME shot (expression 1)");
    }
  });

  it("numbers references correctly when a reference sheet panel is used too", () => {
    const d = withImages();
    d.expressionSetup.refAssetId = "sheet";
    d.expressions[1].panel = 2;
    Object.assign(d.expressions[0], { imageAssetId: "img-anchor", imageFraming: "bust", imageAspect: "3:4" });
    const it = buildExpressionHandoffs(d)[1];
    expect(it.references.map((r) => r.assetId)).toEqual(["base-1", "sheet", "img-anchor"]);
    expect(it.prompt).toContain("Image reference 2 is a grid");
    expect(it.prompt).toContain("Image reference 3 is another moment of this SAME shot");
  });
});

describe("상황 설정·기초 대사 (scene)", () => {
  const SCENE =
    "반투명 베일 너머로 보이는 스와르다의 이목구비. 베일이 숨결에 미세하게 흔들린다. 천천히 트랙아웃(클로즈업에서 바스트쇼트로) / " +
    "스와르다 : “사람들은 나의 아름다움을 축복이라 불렀다.” / 스와르다 : “하지만 그것은, 제국의 탐욕을 부르는 불씨였을 뿐.”";

  it("is empty by default and older projects read fine", async () => {
    expect(createProjectData().expressionSetup.scene).toBe("");
    const raw = JSON.parse(JSON.stringify(createProjectData()));
    delete raw.expressionSetup.scene;
    expect(parseProjectData(raw).expressionSetup.scene).toBe("");
  });

  it("reaches every AI step through the shared project context", async () => {
    const { projectContext } = await import("@/lib/ai/prompts");
    const d = readyCharacter();
    d.expressionSetup.scene = SCENE;
    expect(projectContext(d, 1)).toContain("상황 설정·기초 대사:\n반투명 베일 너머로");
    expect(projectContext(d, 3)).toContain("제국의 탐욕을 부르는 불씨");
    expect(projectContext(d, 0)).not.toContain("상황 설정");
  });

  it("tells the expression design to act the scene in order, using the reference sheet when there is one", async () => {
    const { sceneDesignNote } = await import("@/lib/ai/prompts");
    const d = readyCharacter();
    expect(sceneDesignNote(d, false)).toBe("");
    d.expressionSetup.scene = SCENE;
    d.expressionSetup.count = 3;
    const withSheet = sceneDesignNote(d, true);
    expect(withSheet).toContain("표정 3개를 장면이 흘러가는 순서대로");
    expect(withSheet).toContain("대사마다 그 대사를 말하는 표정을 하나씩 배정");
    expect(withSheet).toContain("표정 참고 시트에서 각 순간에 가장 잘 맞는 칸을 골라");
    expect(withSheet).toContain(SCENE);
    expect(sceneDesignNote(d, false)).not.toContain("표정 참고 시트에서");
  });

  it("keeps the basic lines as the dialogue in step 3", async () => {
    const { sceneDialogueNote } = await import("@/lib/ai/prompts");
    const d = readyCharacter();
    expect(sceneDialogueNote(d)).toBe("");
    d.expressionSetup.scene = SCENE;
    d.dialogue.language = "영국 영어";
    const note = sceneDialogueNote(d);
    expect(note).toContain("고치거나 다듬지 말고 그대로");
    expect(note).toContain("대사 언어 설정(영국 영어)");
  });

  it("recognizes a track-out as a camera move", () => {
    expect(hasCameraMove(["천천히 트랙아웃(클로즈업에서 바스트쇼트로)"])).toBe(true);
    expect(hasCameraMove(["slow track-out to a bust shot"])).toBe(true);
  });

  it("recognizes a Korean camera sentence with words between the camera and its move", () => {
    expect(hasCameraMove(["카메라가 핸드핼드로 인물을 중심으로 180도 회전한다."])).toBe(true);
    expect(hasCameraMove(["촬영자가 들고 뛰면서 회전하고 있어서, 화면의 흔들림이 생생하게 드러난다."])).toBe(true);
    expect(hasCameraMove(["카메라는 그녀를 따라 천천히 물러난다"])).toBe(true);
    // the character moving toward the camera, or a held camera, is not a camera move
    expect(hasCameraMove(["카메라를 향해 몸을 돌린다"])).toBe(false);
    expect(hasCameraMove(["카메라는 고정된 채 인물이 돌아선다"])).toBe(false);
    expect(hasCameraMove(["카메라는 정면에서 그녀를 바라본다"])).toBe(false);
  });
});


describe("추가 연출 (the director's direction) wins and is never cut", () => {
  const DIRECTION =
    "CAMERA\nContinuous 8-second single take in the style of modern film and TV drama. Eye-level Steadicam on a gravity-balanced rig, physically traveling straight backward. The camera glides smoothly and never stops; the subject stays centered while the background slowly widens.\n\nLIGHT\nWarm key from screen-left, soft fill, golden rim light on the hair. Her hair moves smoothly in the breeze.";
  const withDirection = (text: string) => {
    const d = readyCharacter();
    d.video.extraDirection = text;
    return d;
  };

  it("goes in whole, with its line breaks, right before the constraints", () => {
    const h = buildVideoHandoff(withDirection(DIRECTION));
    expect(DIRECTION.length).toBeGreaterThan(300);
    const block = h.prompt.slice(h.prompt.indexOf("DIRECTOR'S DIRECTION"));
    expect(block).toContain("CAMERA\nContinuous 8-second single take");
    expect(block).toContain("\n\nLIGHT\nWarm key from screen-left, soft fill, golden rim light on the hair.");
    expect(block).not.toContain("…");
    expect(h.prompt.endsWith(h.constraints)).toBe(true);
    expect(h.prompt.indexOf("DIRECTOR'S DIRECTION")).toBeLessThan(h.prompt.indexOf("Constraints: stop-motion"));
  });

  it("recognizes the camera move and lets the director's rig replace the constraints' HANDHELD", () => {
    const h = buildVideoHandoff(withDirection(DIRECTION));
    expect(h.cameraMove).toBe(true);
    expect(h.prompt).toContain("Camera: exactly as in the DIRECTOR'S DIRECTION below");
    expect(h.prompt).not.toContain("Camera move: none");
    expect(h.constraints).toContain("(Camera move as directed above — Steadicam replaces HANDHELD) quiet and purposeful, alive, not chaotic.");
    expect(h.prompt).not.toContain("never gimbal-smooth");
    expect(h.overrides.join(" ")).toContain("‘Steadicam’");
  });

  it("keeps the director's camera wording, but steps character motion", () => {
    const h = buildVideoHandoff(withDirection(DIRECTION));
    expect(h.prompt).toContain("The camera glides smoothly and never stops");
    expect(h.prompt).toContain("Her hair moves in the breeze.");
    expect(h.adjustments).toHaveLength(1);
    expect(h.adjustments[0].where).toBe("추가 연출");
  });

  it("follows the director's angle and background instead of the app's eye-level and white background", () => {
    const low = buildVideoHandoff(withDirection("Low-angle shot, the camera slowly pushes in.")).prompt;
    expect(low).not.toMatch(/framing \(cut at the chest\), eye-level/);
    const bg = buildVideoHandoff(withDirection("BACKGROUND: a dark palace hall full of gold and jewels"));
    expect(bg.prompt).toContain("Background as in the DIRECTOR'S DIRECTION below");
    expect(bg.prompt).not.toContain("White background,");
    expect(bg.overrides.join(" ")).toContain("배경");
    const white = buildVideoHandoff(withDirection("배경: 흰색 단색"));
    expect(white.prompt).toContain("White background,");
    expect(white.overrides).toEqual([]);
  });

  it("keeps the verbatim constraints when there is no rig, and a still camera without any move", () => {
    const still = buildVideoHandoff(readyCharacter());
    expect(still.constraints).toBe(STUDIO_CONSTRAINTS);
    expect(still.prompt).toContain("Camera move: none");
    const handheld = buildVideoHandoff(withDirection("The camera follows her, handheld."));
    expect(handheld.constraints).toBe(STUDIO_CONSTRAINTS);
  });
});

describe("pre-render check (충돌 점검)", () => {
  it("lists what is fine, what was adjusted and what needs a look", async () => {
    const { preRenderCheck } = await import("@/lib/domain/check");
    const d = readyCharacter();
    d.video.extraDirection = "Eye-level Steadicam, traveling straight backward. 잔잔한 배경음악";
    d.expressionSetup.scene = "천천히 트랙아웃";
    const h = buildVideoHandoff(d);
    const items = preRenderCheck(d, h);
    const text = (level: string) => items.filter((i) => i.level === level).map((i) => `${i.area}: ${i.text}`).join(" | ");
    expect(text("ok")).toContain("추가 연출: 추가 연출이 줄이지 않고 그대로 들어갔습니다");
    expect(text("ok")).toContain("스튜디오 제약사항이 프롬프트 맨 끝에 있습니다");
    expect(text("fixed")).toContain("Steadicam");
    expect(text("fixed")).toContain("음악 지시를 뺌");
    expect(text("warn")).toContain("그림이 없는 표정");
    // the scene's track-out is not in the prompt unless the director writes a camera move — here they did
    expect(text("warn")).not.toContain("상황 설정");
    d.video.extraDirection = "";
    expect(preRenderCheck(d, buildVideoHandoff(d)).some((i) => i.area === "상황 설정" && i.level === "warn")).toBe(true);
  });
});
