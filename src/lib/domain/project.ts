import { z } from "zod";
import { estimateSpeechSeconds } from "./speech";

/** The five workflow steps. Index = step number. */
export const STEPS = ["출연진", "표정", "대사", "액팅", "영상 프롬프트"] as const;
/** Step names as a scene shows them (storyboard mode calls step 2 콘티). */
export const stepName = (data: { mode?: string }, step: number) => (data.mode === "storyboard" && step === 1 ? "콘티" : STEPS[step]);
export type StepIndex = 0 | 1 | 2 | 3 | 4;

/* ───────────── Directions (always viewer-relative) ─────────────
 * "left" / "right" always mean the viewer's left/right on screen.
 * The same 5-step scale is used for the head and the body, so the two can be
 * compared and a mismatch can be flagged.
 */
export const FACING = ["left_profile", "left_3q", "front", "right_3q", "right_profile"] as const;
export type Facing = (typeof FACING)[number];
export const FACING_LABEL: Record<Facing, string> = {
  left_profile: "왼쪽 옆모습",
  left_3q: "왼쪽 3/4",
  front: "정면",
  right_3q: "오른쪽 3/4",
  right_profile: "오른쪽 옆모습",
};

export const PITCH = ["up", "level", "down"] as const;
export type Pitch = (typeof PITCH)[number];
export const PITCH_LABEL: Record<Pitch, string> = { up: "턱 들기", level: "수평", down: "턱 내리기" };

export const TILT = ["left", "none", "right"] as const;
export type Tilt = (typeof TILT)[number];
export const TILT_LABEL: Record<Tilt, string> = { left: "왼쪽으로 기울임", none: "기울임 없음", right: "오른쪽으로 기울임" };

export const GAZE = ["camera", "left", "right", "up", "down", "up_left", "up_right", "down_left", "down_right"] as const;
export type Gaze = (typeof GAZE)[number];
export const GAZE_LABEL: Record<Gaze, string> = {
  camera: "정면(관객)",
  left: "왼쪽",
  right: "오른쪽",
  up: "위",
  down: "아래",
  up_left: "왼쪽 위",
  up_right: "오른쪽 위",
  down_left: "왼쪽 아래",
  down_right: "오른쪽 아래",
};

export const INTENSITY = ["subtle", "medium", "strong"] as const;
export type Intensity = (typeof INTENSITY)[number];
export const INTENSITY_LABEL: Record<Intensity, string> = { subtle: "은은하게", medium: "중간", strong: "강하게" };

/** Shot size of each expression image (camera framing). */
export const FRAMINGS = ["close_up", "bust", "medium"] as const;
export type Framing = (typeof FRAMINGS)[number];
export const FRAMING_LABEL: Record<Framing, string> = { close_up: "클로즈업 (CU)", bust: "바스트 샷 (BS)", medium: "미디엄 샷 (MS)" };
export const FRAMING_CUT: Record<Framing, string> = {
  close_up: "목·어깨선 위, 얼굴이 화면 가득",
  bust: "가슴선에서 자름",
  medium: "허리선에서 자름 (웨이스트 샷)",
};
export const FRAMING_USE: Record<Framing, string> = {
  close_up: "미세한 표정 변화, 눈빛, 내면의 감정을 크게 보여줄 때",
  bust: "표정과 함께 어깨 움직임·손짓 일부까지. 대사 장면의 기본",
  medium: "상반신 전체의 움직임과 손짓, 공간의 분위기까지 보여줄 때",
};
/** Arms and hands are part of the acting only when the shot shows them. */
export const showsHands = (f: Framing) => f !== "close_up";
/** Single-character beat images are portrait 3:4; multi-character scene frames use the video's aspect ratio. */
export const EXPRESSION_IMAGE_ASPECT = "3:4";

/* ───────────── Cast (출연진) ───────────── */

export const MIN_CAST = 1;
/** Character-by-character mode: every character's acting is set per beat, so the cast stays small. */
export const MAX_CAST = 4;
/** Storyboard mode: named characters are kept by name and features only, so more of them fit. */
export const MAX_CAST_STORYBOARD = 8;
export const maxCastFor = (mode: string | undefined) => (mode === "storyboard" ? MAX_CAST_STORYBOARD : MAX_CAST);

/** Where a character stands on screen (viewer-relative). */
export const POSITIONS = ["left", "center_left", "center", "center_right", "right"] as const;
export type Position = (typeof POSITIONS)[number];
export const POSITION_LABEL: Record<Position, string> = {
  left: "화면 왼쪽",
  center_left: "왼쪽 가운데",
  center: "가운데",
  center_right: "오른쪽 가운데",
  right: "화면 오른쪽",
};
/** Default blocking for a cast of n (left to right). */
export function defaultPositions(n: number): Position[] {
  if (n <= 1) return ["center"];
  if (n === 2) return ["left", "right"];
  if (n === 3) return ["left", "center", "right"];
  if (n === 4) return ["left", "center_left", "center_right", "right"];
  // larger storyboard casts: spread over the five places (several share one; it only helps find them in the drawing)
  return Array.from({ length: n }, (_, i) => POSITIONS[Math.round((i * (POSITIONS.length - 1)) / (n - 1))]);
}
/**
 * How a scene is controlled:
 * - cast: every character's acting is set separately in each beat (one character, or a small group)
 * - storyboard: each beat is a storyboard panel (콘티) — one picture of the whole moment described as a whole
 *   (who does what, camera), with an optional rough sketch. Fast to set up, and works for crowd scenes.
 */
export const SCENE_MODES = ["cast", "storyboard"] as const;
export type SceneMode = (typeof SCENE_MODES)[number];
export const SCENE_MODE_LABEL: Record<SceneMode, string> = { cast: "인물별 연기", storyboard: "스토리보드 (컷 단위)" };
export const SCENE_MODE_HELP: Record<SceneMode, string> = {
  cast: "표정(비트)마다 인물 한 명 한 명의 감정·얼굴·팔손·방향을 따로 정합니다. 1~4명이 연기하는 장면을 정밀하게 다룰 때.",
  storyboard: "콘티처럼 컷마다 그 순간 전체를 한 장으로 정합니다(장면 묘사·카메라·러프 스케치). 군중 장면이나 빠르게 만들 때.",
};

/** "A", "B", "C" … — short cast labels used in prompts and the UI. */
export const castLetter = (i: number) => String.fromCharCode(65 + i);

/** "3:4" for a 3×4 image, nearest common label for others (used to spot images made in an older format). */
export function ratioLabel(width: number, height: number): string {
  const r = width / height;
  const known: [string, number][] = [["3:4", 3 / 4], ["9:16", 9 / 16], ["1:1", 1], ["2:3", 2 / 3], ["4:5", 4 / 5], ["16:9", 16 / 9], ["4:3", 4 / 3]];
  const hit = known.find(([, v]) => Math.abs(r - v) / v < 0.03);
  return hit ? hit[0] : `${width}:${height}`;
}

export const DirectionSchema = z.object({
  facing: z.enum(FACING),
  pitch: z.enum(PITCH),
  tilt: z.enum(TILT),
  gaze: z.enum(GAZE),
  body: z.enum(FACING),
});
export type Direction = z.infer<typeof DirectionSchema>;

const DEFAULT_DIRECTION_VALUE: Direction = { facing: "front", pitch: "level", tilt: "none", gaze: "camera", body: "front" };

/**
 * One character's acting in a beat. In a group scene every cast member has one per beat:
 * the beat's lead (who speaks, if anyone) in the beat's own fields, everyone else in `reactions`.
 */
export const PerformanceSchema = z.object({
  characterId: z.string(),
  emotion: z.string().default(""),
  intensity: z.enum(INTENSITY).default("medium"),
  brows: z.string().default(""),
  eyes: z.string().default(""),
  mouth: z.string().default(""),
  gesture: z.string().default(""),
  direction: DirectionSchema.default(DEFAULT_DIRECTION_VALUE),
  directionStatus: z.enum(["ai", "confirmed", "manual"]).default("manual"),
});
export type Performance = z.infer<typeof PerformanceSchema>;

export const ExpressionSchema = z.object({
  id: z.string(),
  /** the beat's lead: the cast member who speaks in this beat (or carries it) ("" = the first cast member) */
  characterId: z.string().default(""),
  /* storyboard mode: the panel as a whole */
  /** what happens in the whole frame at this moment (who does what, crowd, props) */
  action: z.string().default(""),
  /** the camera for this panel (shot size, angle, move toward the next panel) */
  camera: z.string().default(""),
  /** a rough storyboard sketch for this panel: composition, poses and camera are taken from it, not its drawing style */
  sketchAssetId: z.string().nullable().default(null),
  /**
   * storyboard: how this panel follows the previous one — "continuous" (the camera moves on in the same shot)
   * or "cut" (컷 분할: a hard cut, a new shot). Ignored for the first panel.
   */
  link: z.enum(["continuous", "cut"]).default("continuous"),
  /** group scenes: the acting of every other cast member in this same moment (one per member, cast order) */
  reactions: z.array(PerformanceSchema).default([]),
  /** 1-based panel number in the expression reference sheet, or null */
  panel: z.number().int().nullable(),
  /* the lead's acting (same fields as a Performance) */
  emotion: z.string(),
  intensity: z.enum(INTENSITY),
  brows: z.string(),
  eyes: z.string(),
  mouth: z.string(),
  notes: z.string(),
  direction: DirectionSchema,
  /** AI-filled directions stay "ai" until a person confirms them. */
  directionStatus: z.enum(["ai", "confirmed", "manual"]),
  /** arm / hand / shoulder acting for bust and medium shots (empty = the image model picks one that fits the emotion) */
  gesture: z.string().default(""),
  /** this beat's own image (portrait 3:4 for one character, a scene frame at the video aspect for several), attached to the video */
  imageAssetId: z.string().nullable().default(null),
  /** framing the current image was made with (null = unknown, e.g. an older square image) */
  imageFraming: z.enum(FRAMINGS).nullable().default(null),
  /** aspect ratio the current image was made at, e.g. "3:4" (null = unknown / older image) */
  imageAspect: z.string().nullable().default(null),
});
export type Expression = z.infer<typeof ExpressionSchema>;

export const QuestionSchema = z.object({ question: z.string(), answer: z.string() });

export const CastMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  locks: z.string(),
  appearance: z.string(),
  outfit: z.string(),
  /** this character's voice (age, timbre, pace, accent) */
  voice: z.string().default(""),
  /** optional material for this character (a design sheet or close-up), used to compose the scene and draw the opening */
  refAssetId: z.string().nullable().default(null),
  position: z.enum(POSITIONS).default("center"),
  questions: z.array(QuestionSchema),
});
export type CastMember = z.infer<typeof CastMemberSchema>;

/** Team texts a render-check fix may replace in the video prompt (per expression, or the voice). */
export const PROMPT_FIX_TARGETS = ["transition", "gesture", "notes", "delivery", "voice"] as const;
export type PromptFixTarget = (typeof PROMPT_FIX_TARGETS)[number];
export const PromptFixSchema = z.object({
  target: z.enum(PROMPT_FIX_TARGETS),
  /** the expression the text belongs to (for "voice": the cast member's id) */
  expressionId: z.string().nullable(),
  before: z.string(),
  after: z.string(),
  /** why (the conflict it solves), shown to the team */
  note: z.string().default(""),
});
export type PromptFix = z.infer<typeof PromptFixSchema>;

/** The team's text as the video prompt uses it: a render-check fix replaces it while the text is still `before`. */
export function effectiveText(data: { video: { promptFixes: PromptFix[] } }, target: PromptFixTarget, expressionId: string | null, text: string): string {
  return data.video.promptFixes.find((f) => f.target === target && f.expressionId === expressionId && f.before === text)?.after ?? text;
}

/**
 * 영어 정리: short English versions of the design for the image and video prompts, written by AI
 * (write_english). Each piece keeps a key of the Korean it was made from and is used only while
 * that Korean is unchanged (see english.ts).
 */
const EnText = z.object({ text: z.string(), key: z.string() });
export const EnglishSheetSchema = z.object({
  language: EnText,
  style: EnText,
  cast: z.array(
    z.object({
      characterId: z.string(),
      look: z.object({ items: z.array(z.string()), key: z.string() }),
      outfit: EnText,
      voice: EnText,
    }),
  ),
  beats: z.array(
    z.object({
      expressionId: z.string(),
      key: z.string(),
      emotion: z.string(),
      face: z.string(),
      body: z.string(),
      transition: z.string(),
      delivery: z.string(),
      /** group scenes: every other character's acting in this beat */
      others: z.array(z.object({ characterId: z.string(), emotion: z.string(), face: z.string(), body: z.string() })).default([]),
    }),
  ),
});
export type EnglishSheet = z.infer<typeof EnglishSheetSchema>;

/**
 * The separate camera field (카메라 연출, Nov 2026) was folded back into 추가 연출:
 * text written there moves to the front of 추가 연출 when a project is read, so nothing is lost
 * and the next save stores it there.
 */
function mergeLegacyCamera(video: unknown): unknown {
  if (!video || typeof video !== "object") return video;
  const { camera, ...rest } = video as { camera?: unknown; extraDirection?: unknown };
  const cam = typeof camera === "string" ? camera.trim() : "";
  if (!cam) return rest;
  const extra = typeof rest.extraDirection === "string" ? rest.extraDirection.trim() : "";
  if (extra.includes(cam)) return rest;
  return { ...rest, extraDirection: extra ? `${cam}\n\n${extra}` : cam };
}

export const ProjectDataSchema = z.object({
  schemaVersion: z.literal(1),
  currentStep: z.number().int(),
  approvedThrough: z.number().int(),
  /** scene (project) name */
  title: z.string(),
  mode: z.enum(SCENE_MODES).default("cast"),
  /** storyboard mode: the crowd and background people (unnamed), described once for the whole scene */
  extras: z.string().default(""),
  /** 첫 장면: the opening moment, drawn as the scene reference picture when the team has no picture of its own */
  opening: z.string().default(""),
  /** one art style for the whole scene (every character is drawn in it) */
  style: z.string(),
  /**
   * 장면 기준 그림: ONE drawing with the whole cast together (for one character, that character's drawing).
   * Identity, relative sizes and art style of every character come from it.
   */
  baseAssetId: z.string().nullable().default(null),
  /** extra references for the whole scene (other views, close-ups of a character, props) */
  designRefAssetIds: z.array(z.string()).default([]),
  /** 출연진: 1–4 characters in one shot; each is found in the scene drawing by name, position and features */
  cast: z.array(CastMemberSchema).min(MIN_CAST).max(MAX_CAST_STORYBOARD),
  expressionSetup: z.object({
    count: z.number().int(),
    refAssetId: z.string().nullable(),
    refColumns: z.number().int(),
    refRows: z.number().int(),
    /** expression_only = take only the acting from the reference, never its drawing style */
    transfer: z.enum(["expression_only", "expression_and_pose"]),
    instruction: z.string(),
    styleWarning: z.string().nullable(),
    sheetAssetId: z.string().nullable(),
    /** shot size for every expression image */
    framing: z.enum(FRAMINGS).default("bust"),
    /**
     * 상황 설정·기초 대사: the scene in the team's words (situation, mood, camera) and its basic lines.
     * The AI designs the expressions as this scene in order, and uses the lines as the dialogue (step 3).
     */
    scene: z.string().default(""),
  }),
  expressions: z.array(ExpressionSchema),
  dialogue: z.object({
    language: z.string(),
    lines: z.array(z.object({ expressionId: z.string(), line: z.string(), meaning: z.string(), delivery: z.string() })),
  }),
  acting: z.object({
    duration: z.number(),
    segments: z.array(
      z.object({ expressionId: z.string(), start: z.number(), end: z.number(), transition: z.string() }),
    ),
  }),
  video: z.preprocess(
    mergeLegacyCamera,
    z.object({
      aspectRatio: z.enum(["16:9", "9:16"]),
      /** the director's direction (추가 연출): camera, light, background … kept whole in the video prompt */
      extraDirection: z.string(),
      /**
       * Fixes from the render check that change a team text only in the video prompt; the approved
       * step keeps its own text. A fix is used only while that text is still `before`.
       */
      promptFixes: z.array(PromptFixSchema).default([]),
      /** optional last frame (with a start frame): the shot ends exactly on it */
      endFrameAssetId: z.string().nullable().default(null),
      /** optional single-character start frame (e.g. panel 1 cropped from the sheet) */
      startFrameAssetId: z.string().nullable().default(null),
      resultAssetIds: z.array(z.string()),
    }),
  ),
  /** 영어 정리 (derived from the design; belongs to no step, so applying it re-opens nothing) */
  english: EnglishSheetSchema.nullable().default(null),
});
export type ProjectData = z.infer<typeof ProjectDataSchema>;

export function uid(): string {
  return globalThis.crypto.randomUUID();
}

export const DEFAULT_DIRECTION: Direction = {
  facing: "front",
  pitch: "level",
  tilt: "none",
  gaze: "camera",
  body: "front",
};

export function blankCastMember(position: Position = "center", name = ""): CastMember {
  return { id: uid(), name, locks: "", appearance: "", outfit: "", voice: "", refAssetId: null, position, questions: [] };
}

export function blankPerformance(characterId: string): Performance {
  return { characterId, emotion: "", intensity: "medium", brows: "", eyes: "", mouth: "", gesture: "", direction: { ...DEFAULT_DIRECTION_VALUE }, directionStatus: "manual" };
}

export function blankExpression(panel: number | null = null, characterId = ""): Expression {
  return {
    id: uid(),
    characterId,
    action: "",
    camera: "",
    sketchAssetId: null,
    link: "continuous",
    reactions: [],
    panel,
    emotion: "",
    intensity: "medium",
    brows: "",
    eyes: "",
    mouth: "",
    notes: "",
    direction: { ...DEFAULT_DIRECTION },
    directionStatus: "manual",
    gesture: "",
    imageAssetId: null,
    imageFraming: null,
    imageAspect: null,
  };
}

export function createProjectData(title = "새 장면", castCount = 1, mode: SceneMode = "cast"): ProjectData {
  const n = Math.min(maxCastFor(mode), Math.max(MIN_CAST, Math.round(castCount)));
  const positions = defaultPositions(n);
  const cast = positions.map((p) => blankCastMember(p));
  const count = mode === "storyboard" ? 6 : n === 1 ? 4 : Math.min(MAX_EXPRESSIONS, n * 2);
  const expressions = Array.from({ length: count }, (_, i) => withReactionsFor(cast, blankExpression(i + 1, cast[i % n].id)));
  return {
    schemaVersion: 1,
    currentStep: 0,
    approvedThrough: -1,
    title,
    mode,
    extras: "",
    opening: "",
    style: "",
    baseAssetId: null,
    designRefAssetIds: [],
    cast,
    expressionSetup: {
      count,
      refAssetId: null,
      refColumns: 4,
      refRows: 1,
      transfer: "expression_only",
      instruction: "",
      styleWarning: null,
      sheetAssetId: null,
      framing: n === 1 && mode === "cast" ? "bust" : "medium",
      scene: "",
    },
    expressions,
    dialogue: { language: "한국어", lines: [] },
    acting: { duration: 8, segments: evenSegments(expressions.map((e) => e.id), 8) },
    video: { aspectRatio: "16:9", extraDirection: "", promptFixes: [], startFrameAssetId: null, endFrameAssetId: null, resultAssetIds: [] },
    english: null,
  };
}

export function evenSegments(ids: string[], duration: number) {
  const n = ids.length || 1;
  return ids.map((expressionId, i) => ({
    expressionId,
    start: round3((duration * i) / n),
    end: i === n - 1 ? duration : round3((duration * (i + 1)) / n),
    transition: "",
  }));
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000;

export const MIN_EXPRESSIONS = 2;
/** beats per scene (one Higgsfield batch holds 12 images) */
export const MAX_EXPRESSIONS = 12;
export const MAX_VIDEO_SECONDS = 60;

/** Contiguous segments for `ids` (in order) sized by `weights`, snapped to 0.1s, ending exactly at `duration`. */
export function weightedSegments(ids: string[], weights: number[], duration: number, transitions: Record<string, string> = {}) {
  const w = weights.map((x) => Math.max(0.01, x));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  // Round each cumulative boundary (not each length) so rounding error is spread out.
  let ideal = 0;
  let prev = 0;
  return ids.map((expressionId, i) => {
    ideal += (duration * w[i]) / total;
    const end = i === ids.length - 1 ? duration : round3(Math.max(prev + 0.1, Math.round(ideal * 10) / 10));
    const seg = { expressionId, start: round3(prev), end, transition: transitions[expressionId] ?? "" };
    prev = end;
    return seg;
  });
}

/** Change the total length, keeping each segment's share of the timeline. */
export function setDuration(data: ProjectData, duration: number): ProjectData {
  const d = round3(Math.min(MAX_VIDEO_SECONDS, Math.max(0.5, duration)));
  const segs = data.acting.segments;
  const old = data.acting.duration || 1;
  const transitions = Object.fromEntries(segs.map((x) => [x.expressionId, x.transition]));
  const segments = segs.length
    ? weightedSegments(segs.map((x) => x.expressionId), segs.map((x) => (x.end - x.start) / old), d, transitions)
    : evenSegments(data.expressions.map((e) => e.id), d);
  return { ...data, acting: { duration: d, segments } };
}

export type Distribution = { key: string; label: string; description: string; segments: ProjectData["acting"]["segments"] };

/** Alternative ways to split the fixed total time, in the current expression order. */
export function distributionPlans(data: ProjectData): Distribution[] {
  const { duration, segments } = data.acting;
  const ids = segments.length ? segments.map((x) => x.expressionId) : data.expressions.map((e) => e.id);
  const n = ids.length;
  const transitions = Object.fromEntries(segments.map((x) => [x.expressionId, x.transition]));
  const speech = ids.map((id) => estimateSpeechSeconds(data.dialogue.lines.find((l) => l.expressionId === id)?.line ?? ""));
  const plans: Distribution[] = [
    { key: "even", label: "균등", description: "모든 표정에 같은 시간", segments: weightedSegments(ids, ids.map(() => 1), duration, transitions) },
  ];
  if (speech.some((x) => x > 0)) {
    // speaking time + a beat to land each expression
    plans.push({
      key: "speech",
      label: "대사 길이에 맞춤",
      description: "대사를 말하는 시간에 표정을 보여줄 여유를 더해 나눔",
      segments: weightedSegments(ids, speech.map((x) => x + 0.8), duration, transitions),
    });
  }
  if (n >= 2) {
    plans.push({
      key: "open",
      label: "도입 강조",
      description: "첫 표정을 길게 보여주고 나머지는 빠르게",
      segments: weightedSegments(ids, ids.map((_, i) => (i === 0 ? 2 : 1)), duration, transitions),
    });
    plans.push({
      key: "close",
      label: "마무리 강조",
      description: "마지막 표정에 여운을 길게",
      segments: weightedSegments(ids, ids.map((_, i) => (i === n - 1 ? 2 : 1)), duration, transitions),
    });
    plans.push({
      key: "build",
      label: "점점 길게",
      description: "짧게 시작해 감정이 쌓일수록 길게",
      segments: weightedSegments(ids, ids.map((_, i) => 1 + i * 0.5), duration, transitions),
    });
  }
  return plans;
}

export const sameTiming = (a: ProjectData["acting"]["segments"], b: ProjectData["acting"]["segments"]) =>
  a.length === b.length && a.every((x, i) => x.expressionId === b[i].expressionId && Math.abs(x.end - b[i].end) < 0.05);

/** Resize the expression list to `count`, keeping existing entries. */
export function setExpressionCount(data: ProjectData, count: number): ProjectData {
  const c = Math.min(MAX_EXPRESSIONS, Math.max(MIN_EXPRESSIONS, Math.round(count)));
  const expressions = Array.from(
    { length: c },
    (_, i) => data.expressions[i] ?? withReactionsFor(data.cast, blankExpression(i + 1, data.cast[i % data.cast.length]?.id ?? "")),
  );
  const ids = expressions.map((e) => e.id);
  return {
    ...data,
    expressionSetup: { ...data.expressionSetup, count: c },
    expressions,
    dialogue: { ...data.dialogue, lines: data.dialogue.lines.filter((l) => ids.includes(l.expressionId)) },
    acting: { ...data.acting, segments: evenSegments(ids, data.acting.duration) },
  };
}

/* ───────────── Direction consistency ───────────── */

/** Distance on the 5-step facing scale (0 = same, 4 = opposite profiles). */
export function facingDistance(a: Facing, b: Facing): number {
  return Math.abs(FACING.indexOf(a) - FACING.indexOf(b));
}

/** True when the head points to the opposite side of the body. */
export function facesOppositeSides(a: Facing, b: Facing): boolean {
  const ia = FACING.indexOf(a) - 2;
  const ib = FACING.indexOf(b) - 2;
  return ia * ib < 0;
}

export type Issue = { level: "block" | "warn"; message: string; expressionId?: string };

/** Direction checks for every performance in a beat (the lead, then each reaction, named in a group scene). */
export function directionIssues(e: Expression, index: number, data?: Pick<ProjectData, "cast">): Issue[] {
  const multi = Boolean(data && data.cast.length > 1);
  const who = (id: string) => (multi && data ? ` ${castLabel(data, id)}` : "");
  return [
    ...performanceDirectionIssues(e, `${index + 1}번 표정${who(e.characterId)}`, e.id),
    ...(multi ? e.reactions.flatMap((r) => performanceDirectionIssues(r, `${index + 1}번 표정${who(r.characterId)}`, e.id)) : []),
  ];
}

function performanceDirectionIssues(e: Pick<Performance, "direction" | "directionStatus">, label: string, expressionId: string): Issue[] {
  const out: Issue[] = [];
  if (e.directionStatus === "ai") {
    out.push({ level: "block", message: `${label}: AI가 추정한 방향을 아직 확인하지 않았습니다.`, expressionId });
  }
  const d = e.direction;
  if (facesOppositeSides(d.facing, d.body)) {
    out.push({
      level: "warn",
      message: `${label}: 얼굴(${FACING_LABEL[d.facing]})과 몸(${FACING_LABEL[d.body]})이 서로 반대쪽을 향합니다. 의도한 연기인지 확인하세요.`,
      expressionId,
    });
  } else if (facingDistance(d.facing, d.body) >= 3) {
    out.push({
      level: "warn",
      message: `${label}: 얼굴과 몸 방향 차이가 큽니다.`,
      expressionId,
    });
  }
  return out;
}

/* ───────────── Cast helpers ───────────── */

export const isMultiCast = (data: Pick<ProjectData, "cast">) => data.cast.length > 1;
export const isStoryboard = (data: Pick<ProjectData, "mode">) => data.mode === "storyboard";

/** Panel links in timeline order: false for the first panel, true where a panel starts with a hard cut. */
export function cutBefore(data: Pick<ProjectData, "mode" | "expressions" | "acting">): Map<string, boolean> {
  const order = data.acting.segments.map((s) => s.expressionId);
  const byId = new Map(data.expressions.map((e) => [e.id, e]));
  return new Map(order.map((id, k) => [id, data.mode === "storyboard" && k > 0 && byId.get(id)?.link === "cut"]));
}

/** Shots of a storyboard scene: runs of panels joined by continuous camera moves (one shot when nothing is cut). */
export function shotsOf(data: Pick<ProjectData, "mode" | "expressions" | "acting">): string[][] {
  const cuts = cutBefore(data);
  const shots: string[][] = [];
  for (const s of data.acting.segments) {
    if (!shots.length || cuts.get(s.expressionId)) shots.push([]);
    shots[shots.length - 1].push(s.expressionId);
  }
  return shots;
}

/**
 * Beat images: portrait 3:4 for one character acting; a scene frame at the video's aspect ratio when several
 * share the shot, and always for storyboard panels.
 */
export const imageAspectFor = (data: Pick<ProjectData, "cast" | "video"> & Partial<Pick<ProjectData, "mode">>) =>
  isMultiCast(data) || data.mode === "storyboard" ? data.video.aspectRatio : EXPRESSION_IMAGE_ASPECT;

export function castIndex(data: Pick<ProjectData, "cast">, id: string): number {
  return data.cast.findIndex((c) => c.id === id);
}

export function castMember(data: Pick<ProjectData, "cast">, id: string): CastMember | undefined {
  return data.cast.find((c) => c.id === id);
}

/** "A 칼리엘라" (or "A" before the name is written). */
export function castLabel(data: Pick<ProjectData, "cast">, id: string): string {
  const i = castIndex(data, id);
  if (i < 0) return "(인물 없음)";
  const name = data.cast[i].name.trim();
  return name ? `${castLetter(i)} ${name}` : `${castLetter(i)} 캐릭터`;
}

/** Name for prompts: the written name, else "Character A". */
export function castName(data: Pick<ProjectData, "cast">, id: string): string {
  const i = castIndex(data, id);
  if (i < 0) return "the character";
  return data.cast[i].name.trim() || `Character ${castLetter(i)}`;
}

/** The cast member acting in a beat (falls back to the first). */
export function beatActor(data: Pick<ProjectData, "cast">, e: Pick<Expression, "characterId">): CastMember {
  return castMember(data, e.characterId) ?? data.cast[0];
}

/** Add a cast member (up to the mode's limit); positions are re-spread left to right. */
export function addCastMember(data: ProjectData): ProjectData {
  if (data.cast.length >= maxCastFor(data.mode)) return data;
  const positions = defaultPositions(data.cast.length + 1);
  const cast = [...data.cast, blankCastMember()].map((c, i) => ({ ...c, position: positions[i] }));
  return reopenFrom(
    {
      ...data,
      cast,
      expressions: data.expressions.map((e) => withReactionsFor(cast, e)),
      // close-ups cannot hold two people
      expressionSetup: data.expressionSetup.framing === "close_up" ? { ...data.expressionSetup, framing: "medium" } : data.expressionSetup,
    },
    0,
  );
}

/** Remove a cast member; their beats move to the first remaining member. */
export function removeCastMember(data: ProjectData, id: string): ProjectData {
  if (data.cast.length <= MIN_CAST) return data;
  const rest = data.cast.filter((c) => c.id !== id);
  const positions = defaultPositions(rest.length);
  const cast = rest.map((c, i) => ({ ...c, position: positions[i] }));
  // a beat the removed member led goes to the first member, who keeps their own acting from that beat
  const expressions = data.expressions.map((e) => withReactionsFor(cast, e.characterId === id ? setLead(e, cast[0].id) : e));
  return reopenFrom({ ...data, cast, expressions, english: data.english ? { ...data.english, cast: data.english.cast.filter((x) => x.characterId !== id) } : null }, 0);
}

/* ───────────── Every character's acting in a beat ───────────── */

const PERFORMANCE_KEYS = ["emotion", "intensity", "brows", "eyes", "mouth", "gesture", "direction", "directionStatus"] as const;

/** The lead's acting, as a Performance. */
export function leadPerformance(e: Expression): Performance {
  const p = { characterId: e.characterId } as Performance;
  for (const k of PERFORMANCE_KEYS) (p as Record<string, unknown>)[k] = e[k];
  return p;
}

/** Every cast member's acting in a beat, in cast order (a missing one is blank). */
export function performancesOf(data: Pick<ProjectData, "cast">, e: Expression): (Performance & { lead: boolean })[] {
  return data.cast.map((c) =>
    c.id === e.characterId
      ? { ...leadPerformance(e), lead: true }
      : { ...(e.reactions.find((r) => r.characterId === c.id) ?? blankPerformance(c.id)), lead: false },
  );
}

/** Keep exactly one reaction per non-lead cast member, in cast order. */
export function withReactionsFor(cast: CastMember[], e: Expression): Expression {
  const reactions = cast.filter((c) => c.id !== e.characterId).map((c) => e.reactions.find((r) => r.characterId === c.id) ?? blankPerformance(c.id));
  const same = reactions.length === e.reactions.length && reactions.every((r, i) => r === e.reactions[i]);
  return same ? e : { ...e, reactions };
}

/** Change who leads a beat; each character keeps their own acting (the old lead's moves into the reactions). */
export function setLead(e: Expression, characterId: string): Expression {
  if (e.characterId === characterId) return e;
  const old = leadPerformance(e);
  const next = e.reactions.find((r) => r.characterId === characterId) ?? blankPerformance(characterId);
  const lead: Partial<Expression> = {};
  for (const k of PERFORMANCE_KEYS) (lead as Record<string, unknown>)[k] = next[k];
  return { ...e, ...lead, characterId, reactions: [...e.reactions.filter((r) => r.characterId !== characterId), old] };
}

/** Update one character's acting in a beat (the lead's fields or their reaction). */
export function updatePerformance(e: Expression, characterId: string, patch: Partial<Omit<Performance, "characterId">>): Expression {
  if (characterId === e.characterId) return { ...e, ...patch };
  const has = e.reactions.some((r) => r.characterId === characterId);
  const reactions = has
    ? e.reactions.map((r) => (r.characterId === characterId ? { ...r, ...patch } : r))
    : [...e.reactions, { ...blankPerformance(characterId), ...patch }];
  return { ...e, reactions };
}

/* ───────────── Step validation ───────────── */

const filled = (s: string) => s.trim().length > 0;

export function stepIssues(data: ProjectData, step: StepIndex): Issue[] {
  const issues: Issue[] = [];
  const block = (message: string) => issues.push({ level: "block", message });
  const warn = (message: string) => issues.push({ level: "warn", message });

  if (step === 0) {
    if (!filled(data.title)) block("장면 이름을 입력하세요.");
    const max = maxCastFor(data.mode);
    if (!(data.cast.length >= MIN_CAST && data.cast.length <= max))
      block(
        isStoryboard(data)
          ? `주요 인물은 ${MIN_CAST}~${max}명이어야 합니다.`
          : `인물별 연기 방식의 출연진은 ${MIN_CAST}~${max}명이어야 합니다. 인물이 더 많으면 스토리보드 방식을 쓰거나 인물을 줄이세요.`,
      );
    data.cast.forEach((c, i) => {
      const who = castLabel(data, c.id);
      if (!filled(c.name)) block(`${castLetter(i)} 캐릭터의 이름을 입력하세요.`);
      if (!filled(c.locks)) block(`${who}: 꼭 유지할 특징을 작성하세요.`);
      if (!filled(c.appearance)) block(`${who}: 외형과 얼굴 특징을 작성하세요.`);
      const open = c.questions.filter((q) => !filled(q.answer)).length;
      if (open) warn(`${who}: AI 확인 질문 ${open}개에 아직 답하지 않았습니다.`);
    });
    if (!data.baseAssetId)
      block(
        isStoryboard(data)
          ? "장면 기준 그림을 올리거나 시나리오로 첫 장면을 생성하세요."
          : data.cast.length > 1
            ? "출연진이 함께 있는 장면 기준 그림을 올리거나 시나리오로 첫 장면을 생성하세요."
            : "기본 그림을 올리거나 시나리오로 첫 장면을 생성하세요.",
      );
    if (!filled(data.style)) block("장면의 그림체와 색감을 작성하세요.");
    const names = data.cast.map((c) => c.name.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) block("출연진 이름이 겹칩니다. 프롬프트에서 인물을 구분할 수 있게 서로 다른 이름을 쓰세요.");
    const pos = data.cast.map((c) => c.position);
    if (!isStoryboard(data) && data.cast.length > 1 && new Set(pos).size !== pos.length) warn("두 인물의 화면 위치가 같습니다. 겹쳐 서는 연출이 아니라면 위치를 나누세요.");
  }

  if (step === 1 && isStoryboard(data)) {
    // storyboard: each panel is described as a whole; no per-character acting or direction checks
    if (data.expressions.length !== data.expressionSetup.count) block("컷 수가 설정과 다릅니다.");
    data.expressions.forEach((e, i) => {
      if (!filled(e.action) && !e.sketchAssetId) block(`${i + 1}번 컷: 장면 묘사를 쓰거나 러프 스케치를 올리세요.`);
    });
    if (!(data.acting.duration > 0 && data.acting.duration <= MAX_VIDEO_SECONDS))
      block(`영상 전체 길이는 0초 초과 ${MAX_VIDEO_SECONDS}초 이하로 정하세요.`);
    const missing = data.expressions.filter((e) => !e.imageAssetId).length;
    if (missing) warn(`그림이 없는 컷이 ${missing}개 있습니다. Higgsfield로 생성하거나 직접 올리세요.`);
    const aspect = imageAspectFor(data);
    const stale = data.expressions.filter((e) => e.imageAssetId && e.imageAspect !== aspect).length;
    if (stale) warn(`컷 그림 ${stale}장이 지금 화면 비율(${aspect})로 만든 그림이 아닙니다. 다시 생성하세요.`);
  } else if (step === 1) {
    if (data.expressions.length !== data.expressionSetup.count) block("표정 개수가 설정과 다릅니다.");
    data.expressions.forEach((e, i) => {
      if (!data.cast.some((c) => c.id === e.characterId)) block(`${i + 1}번 표정의 중심 인물을 고르세요.`);
      if (data.cast.length > 1) {
        for (const p of performancesOf(data, e)) if (!filled(p.emotion)) block(`${i + 1}번 표정: ${castLabel(data, p.characterId)}의 감정을 입력하세요.`);
      } else if (!filled(e.emotion)) block(`${i + 1}번 표정의 감정을 입력하세요.`);
      issues.push(...directionIssues(e, i, data));
    });
    if (data.cast.length > 1) {
      if (data.expressionSetup.framing === "close_up")
        block("여러 인물이 한 화면에 나오는 장면은 클로즈업으로 담을 수 없습니다. 바스트 샷이나 미디엄 샷을 고르세요.");
      const idle = data.cast.filter((c) => !data.expressions.some((e) => e.characterId === c.id));
      if (idle.length) warn(`${idle.map((c) => castLabel(data, c.id)).join(", ")}이(가) 중심 인물인 표정이 없습니다. 대사가 없는 인물이라면 괜찮습니다.`);
    }
    if (!(data.acting.duration > 0 && data.acting.duration <= MAX_VIDEO_SECONDS))
      block(`영상 전체 길이는 0초 초과 ${MAX_VIDEO_SECONDS}초 이하로 정하세요.`);
    if (data.expressionSetup.styleWarning) warn(data.expressionSetup.styleWarning);
    const missing = data.expressions.filter((e) => !e.imageAssetId).length;
    if (missing && !data.expressionSetup.sheetAssetId) warn(`표정 그림이 없는 표정이 ${missing}개 있습니다. Higgsfield로 생성하거나 직접 올리세요.`);
    const framing = data.expressionSetup.framing;
    const aspect = imageAspectFor(data);
    const stale = data.expressions.filter((e) => imageIsStale(e, framing, aspect)).length;
    if (stale)
      warn(
        `표정 그림 ${stale}장이 지금 구도·비율(${FRAMING_LABEL[framing]}, ${isMultiCast(data) ? `장면 그림 ${aspect}` : `세로 ${aspect}`})로 만든 그림이 아닙니다. 영상에서 구도가 섞이지 않도록 다시 생성하세요.`,
      );
  }

  if (step === 2) {
    const speakers = new Set(
      data.dialogue.lines.filter((l) => filled(l.line)).map((l) => data.expressions.find((e) => e.id === l.expressionId)?.characterId ?? ""),
    );
    data.cast.forEach((c) => {
      if (speakers.has(c.id) && !filled(c.voice)) block(`${castLabel(data, c.id)}의 목소리 설정을 입력하세요.`);
    });
    const withLine = data.dialogue.lines.filter((l) => filled(l.line)).length;
    if (withLine === 0) block("대사를 하나 이상 작성하세요.");
    const total = data.dialogue.lines.reduce((a, l) => a + estimateSpeechSeconds(l.line), 0);
    if (total > data.acting.duration)
      warn(`대사를 모두 말하는 데 약 ${Math.round(total * 10) / 10}초가 필요해 영상 길이(${data.acting.duration}초)를 넘습니다. 대사를 줄이거나 2단계에서 길이를 늘리세요.`);
  }

  if (step === 3) {
    issues.push(...timelineIssues(data));
  }

  if (step === 4) {
    if (!(data.acting.duration > 0 && data.acting.duration <= 60)) block("영상 길이는 0초 초과 60초 이하여야 합니다.");
  }
  return issues;
}

/** An expression image made at another shot size or aspect ratio (or an older image of unknown format). */
export function imageIsStale(e: Expression, framing: Framing, aspect: string = EXPRESSION_IMAGE_ASPECT): boolean {
  return Boolean(e.imageAssetId) && (e.imageFraming !== framing || e.imageAspect !== aspect);
}

/** Expressions in the order they appear on the timeline (any not on it go last). */
export function timelineOrder(data: ProjectData): Expression[] {
  const order = data.acting.segments.map((s) => s.expressionId);
  const at = (id: string) => (order.indexOf(id) === -1 ? order.length + data.expressions.findIndex((e) => e.id === id) : order.indexOf(id));
  return [...data.expressions].sort((a, b) => at(a.id) - at(b.id));
}

/**
 * The continuity anchor (연결 기준 그림): the first expression on the timeline
 * whose image matches the current shot. Every other expression image is drawn
 * to match it (same camera distance, framing, head size and position), so the
 * images read as moments of ONE continuous shot.
 */
export function continuityAnchor(data: ProjectData): Expression | null {
  const aspect = imageAspectFor(data);
  return timelineOrder(data).find((e) => e.imageAssetId && !imageIsStale(e, data.expressionSetup.framing, aspect)) ?? null;
}

export function timelineIssues(data: ProjectData): Issue[] {
  const out: Issue[] = [];
  const { duration, segments } = data.acting;
  if (!(duration > 0 && duration <= 60)) out.push({ level: "block", message: "영상 길이는 0초 초과 60초 이하로 입력하세요." });
  if (segments.length === 0) out.push({ level: "block", message: "타임라인 구간이 없습니다." });
  let cursor = 0;
  segments.forEach((s, i) => {
    if (!(s.end > s.start)) out.push({ level: "block", message: `${i + 1}번 구간의 끝이 시작보다 빠릅니다.` });
    if (Math.abs(s.start - cursor) > 0.001)
      out.push({ level: "block", message: `${i + 1}번 구간이 앞 구간과 이어지지 않습니다 (${cursor}초 → ${s.start}초).` });
    cursor = s.end;
  });
  if (segments.length && Math.abs(cursor - duration) > 0.001)
    out.push({ level: "block", message: `마지막 구간이 영상 길이(${duration}초)에서 끝나야 합니다.` });
  // Every expression appears exactly once (e.g. after changing the expression count).
  const ids = new Set(data.expressions.map((e) => e.id));
  if (segments.some((s) => !ids.has(s.expressionId)))
    out.push({ level: "block", message: "타임라인에 지금 없는 표정이 들어 있습니다. 분배 안을 다시 고르세요." });
  const missing = data.expressions.filter((e) => !segments.some((s) => s.expressionId === e.id)).length;
  if (missing) out.push({ level: "warn", message: `타임라인에 빠진 표정이 ${missing}개 있습니다.` });
  return out;
}

export const hasBlockers = (issues: Issue[]) => issues.some((i) => i.level === "block");

/* ───────────── Approval ───────────── */

export function canApprove(data: ProjectData, step: StepIndex) {
  return data.approvedThrough >= step - 1 && !hasBlockers(stepIssues(data, step));
}

export function approve(data: ProjectData, step: StepIndex): ProjectData {
  return { ...data, approvedThrough: Math.max(data.approvedThrough, step), currentStep: Math.min(4, step + 1) };
}

/**
 * Editing an approved step re-opens it and every later step.
 * Called by every editor mutation with the step being edited.
 */
export function reopenFrom(data: ProjectData, step: StepIndex): ProjectData {
  if (data.approvedThrough < step) return data;
  return { ...data, approvedThrough: step - 1 };
}

export function isUnlocked(data: ProjectData, step: StepIndex) {
  return step <= data.approvedThrough + 1;
}

/**
 * Older single-character data (Facial Acting Studio: `character` + `dialogue.voice`) → a cast of one.
 * Lets a project exported from the single-character app open here unchanged.
 */
function upgradeLegacy(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown> & { character?: Record<string, unknown>; dialogue?: Record<string, unknown>; expressions?: unknown[]; english?: Record<string, unknown> | null };
  // the first Scene Acting Studio version kept a drawing per character: the first one becomes the scene drawing
  if (Array.isArray(o.cast) && o.baseAssetId === undefined) {
    const first = (o.cast as { baseAssetId?: string | null; designRefAssetIds?: string[] }[]).find((c) => c.baseAssetId);
    if (first) return { ...o, baseAssetId: first.baseAssetId, designRefAssetIds: (o.cast as { designRefAssetIds?: string[] }[]).flatMap((c) => c.designRefAssetIds ?? []).slice(0, 3) };
  }
  if (Array.isArray(o.cast) || !o.character) return raw;
  const c = o.character;
  const id = uid();
  const member: CastMember = {
    id,
    name: String(c.name ?? ""),
    locks: String(c.locks ?? ""),
    appearance: String(c.appearance ?? ""),
    outfit: String(c.outfit ?? ""),
    voice: String(o.dialogue?.voice ?? ""),
    refAssetId: null,
    position: "center",
    questions: (c.questions as CastMember["questions"]) ?? [],
  };
  const { character: _c, ...rest } = o;
  void _c;
  const { voice: _v, ...dialogue } = (o.dialogue ?? {}) as Record<string, unknown>;
  void _v;
  return {
    ...rest,
    title: String(c.name ?? ""),
    style: String(c.style ?? ""),
    baseAssetId: (c.baseAssetId as string | null) ?? null,
    designRefAssetIds: (c.designRefAssetIds as string[]) ?? [],
    cast: [member],
    dialogue,
    ...(Array.isArray(o.expressions) ? { expressions: o.expressions.map((e) => ({ ...(e as object), characterId: id })) } : {}),
    // old English sheets have no per-character parts: drop them (made again on demand)
    english: null,
  };
}

/** Parse stored JSON defensively (old/partial versions fall back to defaults). */
export function parseProjectData(raw: unknown): ProjectData {
  return readProjectData(raw).data;
}

/**
 * Like parseProjectData, and says when the stored data could not be read at all (`recovered`: the result is
 * a blank scene). Callers must not save such a result over the real data.
 */
export function readProjectData(raw: unknown): { data: ProjectData; recovered: boolean } {
  const up = upgradeLegacy(raw);
  const r = ProjectDataSchema.safeParse(up);
  if (r.success) return { data: withActors(r.data), recovered: false };
  const base = createProjectData();
  const obj = (up ?? {}) as Partial<ProjectData>;
  const merged = {
    ...base,
    ...obj,
    cast: Array.isArray(obj.cast) && obj.cast.length ? obj.cast.slice(0, MAX_CAST_STORYBOARD).map((c) => ({ ...blankCastMember(), ...c })) : base.cast,
    expressionSetup: { ...base.expressionSetup, ...(obj.expressionSetup ?? {}) },
    dialogue: { ...base.dialogue, ...(obj.dialogue ?? {}) },
    acting: { ...base.acting, ...(obj.acting ?? {}) },
    video: { ...base.video, ...(obj.video ?? {}) },
  };
  const r2 = ProjectDataSchema.safeParse(merged);
  return r2.success ? { data: withActors(r2.data), recovered: false } : { data: base, recovered: true };
}

/** Every beat names a lead that exists (unknown or empty → the first) and has one reaction per other member. */
export function withActors(d: ProjectData): ProjectData {
  const ids = new Set(d.cast.map((c) => c.id));
  let changed = false;
  const expressions = d.expressions.map((e) => {
    const next = withReactionsFor(d.cast, ids.has(e.characterId) ? e : { ...e, characterId: d.cast[0].id });
    if (next !== e) changed = true;
    return next;
  });
  return changed ? { ...d, expressions } : d;
}
