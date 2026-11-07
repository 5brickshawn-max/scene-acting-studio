/**
 * Prompt builders for Higgsfield: the beat images (step 2), the start/end frames and the
 * video prompt (step 5). The same prompts are used for direct generation (lib/higgsfield/gen.ts,
 * plan credits through the official MCP server) and for the manual hand-off packs.
 *
 * Scenes have a cast of 1–4. With one character the images are portrait character shots;
 * with several, every beat image is a scene frame of the whole cast in fixed screen positions,
 * the actor of the beat performing and the others reacting.
 *
 * Only imported by server code (route handlers) so the templates are not
 * shipped to the browser bundle.
 */
import { constraintsFor, directorAngle, directorBackground, directorRig, hasCameraMove, reconcile, type Adjustment } from "./constraints";
import { freshEnglish } from "./english";
import {
  beatActor,
  castLabel,
  castName,
  imageAspectFor,
  isMultiCast,
  type CastMember,
  type Position,
  continuityAnchor,
  EXPRESSION_IMAGE_ASPECT,
  FACING_LABEL,
  GAZE_LABEL,
  showsHands,
  type Framing,
  INTENSITY_LABEL,
  PITCH_LABEL,
  TILT_LABEL,
  type Expression,
  type Facing,
  type Gaze,
  type ProjectData,
  effectiveText,
} from "./project";

const FACING_EN: Record<Facing, string> = {
  left_profile: "full profile facing screen-left",
  left_3q: "three-quarter view turned toward screen-left",
  front: "facing the viewer",
  right_3q: "three-quarter view turned toward screen-right",
  right_profile: "full profile facing screen-right",
};
const GAZE_EN: Record<Gaze, string> = {
  camera: "eyes looking at the viewer",
  left: "eyes looking screen-left",
  right: "eyes looking screen-right",
  up: "eyes looking up",
  down: "eyes looking down",
  up_left: "eyes looking up and screen-left",
  up_right: "eyes looking up and screen-right",
  down_left: "eyes looking down and screen-left",
  down_right: "eyes looking down and screen-right",
};
const PITCH_EN = { up: "chin raised", level: "head level", down: "chin lowered" } as const;
const TILT_EN = { left: "head tilted toward screen-left", none: "", right: "head tilted toward screen-right" } as const;
const INTENSITY_EN = { subtle: "subtle", medium: "moderate", strong: "strong, exaggerated" } as const;

/** Shot size for the expression images (vertical 9:16). */
const FRAMING_IMAGE_EN: Record<Framing, string> = {
  close_up: "close-up (CU): the face fills most of the frame, cut at the neck/shoulder line; arms and hands are not in frame",
  bust: "bust shot (BS): cut at the chest line; head, shoulders and upper chest with a little headroom; hands come into frame when they gesture near the face or chest",
  medium: "medium shot (MS, waist shot): cut at the waist; the whole upper body with both arms and hands in frame",
};
/** Same shot size, as framing for the video. */
const FRAMING_VIDEO_EN: Record<Framing, string> = {
  close_up: "close-up framing (face fills the frame)",
  bust: "bust shot framing (cut at the chest)",
  medium: "medium shot framing (cut at the waist, arms and hands visible)",
};

/**
 * Where the bottom edge cuts in the portrait 3:4 frame and how big the head is.
 * Without this, image models fill the frame with more body (bust → waist,
 * medium → thighs) and push the head and headwear against the top edge.
 */
const FRAMING_COMPOSITION_EN: Record<Framing, string> = {
  close_up: "the bottom edge cuts at the neck and collarbones; the head (chin to top of the skull) fills more than half of the image height",
  bust: "the bottom edge cuts across the chest just below the armpits, so the waist, belt and hips are NOT visible; the head (chin to top of the skull) is about 40% of the image height",
  medium: "the bottom edge cuts at the waist around the navel, so the hips, thighs and legs are NOT visible; the head (chin to top of the skull) is about 30% of the image height",
};
const HEADROOM_EN =
  "Headroom: the top of the hair and any headwear (crown, hat, hood, hair ornaments) is fully inside the image with a clear white margin above it, never cut off at the top edge.";
const portraitFrameEn = (hands: boolean) =>
  `Fill the portrait frame at this shot size and never show more of the body than the shot size allows. Wide hair, clothing or shoulders may run past the side edges${
    hands ? " (keep the gesturing hands inside the frame)" : ""
  }.`;
/** Expression images are moments of ONE shot: this is what makes them connect in the video. */
const ONE_SHOT_IMAGE_EN =
  "This image is one moment of ONE continuous shot with no cuts: every expression image of this character shares the same camera, shot size, character size and position, lighting and white background; only the acting changes.";

/** Arm/hand acting line for the image prompt (bust and medium shots only); `text` = English gesture when there is one. */
function bodyLanguageEn(e: Expression, framing: Framing, text = e.gesture): string {
  if (!showsHands(framing)) return "";
  const where = framing === "bust" ? "near the face, hair or chest so the hands are inside the frame" : "readable across the whole upper body";
  const gesture = text.trim()
    ? `Body language: ${clean(text).replace(/[.。]+$/, "")}.`
    : `Body language: choose a natural arm and hand gesture that expresses "${e.emotion || "the emotion"}", ${where}.`;
  return (
    `${gesture} Arms, hands and shoulders act the emotion together with the face — clearly different from a neutral arms-down pose. ` +
    `Hands drawn clearly with natural anatomy (five fingers, no fused or extra fingers); accessories on the arms and wrists stay as in the design.`
  );
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Head, gaze and body direction in English (from the checked direction values, never from free text). */
function directionEn(e: Expression): string {
  const d = e.direction;
  return `Head ${FACING_EN[d.facing]}, ${PITCH_EN[d.pitch]}${TILT_EN[d.tilt] ? `, ${TILT_EN[d.tilt]}` : ""}; ${GAZE_EN[d.gaze]}; body ${FACING_EN[d.body]}.`;
}

const FACING_SHORT: Record<Facing, string> = {
  left_profile: "profile to screen-left",
  left_3q: "3/4 to screen-left",
  front: "front",
  right_3q: "3/4 to screen-right",
  right_profile: "profile to screen-right",
};
const GAZE_SHORT: Record<Gaze, string> = {
  camera: "at the viewer",
  left: "screen-left",
  right: "screen-right",
  up: "up",
  down: "down",
  up_left: "up and screen-left",
  up_right: "up and screen-right",
  down_left: "down and screen-left",
  down_right: "down and screen-right",
};
/** The same direction in a few words, for the video beats (the reference image shows the pose). */
function poseShort(e: Expression): string {
  const d = e.direction;
  const head = [FACING_SHORT[d.facing], d.pitch === "up" ? "chin up" : d.pitch === "down" ? "chin down" : "", d.tilt === "none" ? "" : `tilted screen-${d.tilt}`];
  return `Pose: head ${head.filter(Boolean).join(", ")}; eyes ${GAZE_SHORT[d.gaze]}; body ${FACING_SHORT[d.body]}.`;
}

export type ReferenceSlot = { role: string; assetId: string; why: string; characterId?: string };

/* ───────────── Cast in prompts ───────────── */

const POSITION_EN: Record<Position, string> = {
  left: "screen-left",
  center_left: "left of center",
  center: "center",
  center_right: "right of center",
  right: "screen-right",
};

/** Cast members in screen order, left to right. */
function castLeftToRight(data: ProjectData): CastMember[] {
  const order: Position[] = ["left", "center_left", "center", "center_right", "right"];
  return [...data.cast].sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position));
}

/** "Kaliela (screen-left), Bram (screen-right)" */
function blockingEn(data: ProjectData): string {
  return castLeftToRight(data)
    .map((c) => `${castName(data, c.id)} (${POSITION_EN[c.position]})`)
    .join(", ");
}

/** Which image references show each character (numbers as the prompt counts them). */
function refNumbers(refs: ReferenceSlot[], characterId: string): string {
  const nums = refs.flatMap((r, i) => (r.characterId === characterId ? [String(i + 1)] : []));
  return nums.length > 1 ? `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}` : nums[0] ?? "";
}

/** Identity lines: every character must match their own design references. */
function castIdentityEn(data: ProjectData, refs: ReferenceSlot[]): string[] {
  if (!isMultiCast(data))
    return [`The character must match image reference 1 exactly: same identity, face proportions, hairstyle, colors, costume, accessories and art style.`];
  return data.cast.map((c) => {
    const nums = refNumbers(refs, c.id);
    return nums
      ? `${castName(data, c.id)} (${POSITION_EN[c.position]}) must match image reference ${nums} exactly: same identity, face proportions, hairstyle, colors, costume and accessories. Never mix features between characters.`
      : `${castName(data, c.id)} (${POSITION_EN[c.position]}): drawn from the description below.`;
  });
}

/** Must-keep features (and outfit) per character; short English where fresh. */
function castLookEn(data: ProjectData, en: ReturnType<typeof freshEnglish>, opts: { appearance: boolean; outfit: boolean; max?: number }): string[] {
  const multi = isMultiCast(data);
  return data.cast.flatMap((c) => {
    const f = en.cast.get(c.id);
    const who = multi ? ` (${castName(data, c.id)})` : "";
    const look = f?.look
      ? `Must keep${who}: ${f.look.slice(0, opts.max ?? 8).join("; ")}.`
      : c.locks.trim()
        ? opts.max
          ? shortLocks(c.locks, opts.max).length
            ? `Must keep${who}: ${shortLocks(c.locks, opts.max).join(", ")}.`
            : ""
          : `Must keep${who}: ${clean(c.locks)}`
        : "";
    return [
      look,
      opts.appearance && !f?.look && c.appearance.trim() ? `Appearance${who}: ${clean(c.appearance)}` : "",
      opts.outfit && (f?.outfit || c.outfit.trim()) ? `Outfit visible in frame${who}: ${f?.outfit ?? clean(c.outfit)}` : "",
    ].filter(Boolean);
  });
}

/** Scene-frame sizes: every character at this shot size. */
const FRAMING_SCENE_EN: Record<Framing, string> = {
  close_up: "tight group shot",
  bust: "group bust shot: every character cut across the chest, heads and shoulders with a little headroom; hands come into frame when they gesture near the face or chest",
  medium: "group medium shot (waist shot): every character cut at the waist, whole upper bodies with arms and hands in frame",
};

export type SheetHandoff = {
  recommendedModel: string;
  aspectRatio: string;
  references: ReferenceSlot[];
  prompt: string;
  checklist: string[];
};

export function expressionLine(e: Expression, i: number, lang: "en" | "ko"): string {
  const d = e.direction;
  if (lang === "ko") {
    return clean(
      `${i + 1}번 칸: ${e.emotion} (${INTENSITY_LABEL[e.intensity]}). 눈썹: ${e.brows} 눈: ${e.eyes} 입: ${e.mouth} ` +
        `얼굴 ${FACING_LABEL[d.facing]}, ${PITCH_LABEL[d.pitch]}, ${TILT_LABEL[d.tilt]}, 시선 ${GAZE_LABEL[d.gaze]}, 몸 ${FACING_LABEL[d.body]}. ${e.notes}`,
    );
  }
  const parts = [
    `Panel ${i + 1}: ${INTENSITY_EN[e.intensity]} ${e.emotion}.`,
    e.brows && `Brows: ${e.brows}.`,
    e.eyes && `Eyes: ${e.eyes}.`,
    e.mouth && `Mouth: ${e.mouth}.`,
    `Head ${FACING_EN[d.facing]}, ${PITCH_EN[d.pitch]}${TILT_EN[d.tilt] ? `, ${TILT_EN[d.tilt]}` : ""}; ${GAZE_EN[d.gaze]}; shoulders/body ${FACING_EN[d.body]}.`,
    e.notes && e.notes,
  ];
  return clean(parts.filter(Boolean).join(" "));
}

/** References shared by every beat image, in prompt order: each cast member's base drawing, then their extra designs. */
function identityRefs(data: ProjectData): ReferenceSlot[] {
  const refs: ReferenceSlot[] = [];
  const multi = isMultiCast(data);
  for (const c of data.cast) {
    const who = multi ? castLabel(data, c.id) : "캐릭터";
    if (c.baseAssetId) refs.push({ role: `image reference ${refs.length + 1}`, assetId: c.baseAssetId, why: `${who} 정체성·그림체의 기준`, characterId: c.id });
    for (const id of c.designRefAssetIds)
      refs.push({ role: `image reference ${refs.length + 1}`, assetId: id, why: `${who} 추가 디자인 참고`, characterId: c.id });
  }
  return refs;
}

export { EXPRESSION_IMAGE_ASPECT };

export type ExpressionHandoff = {
  expressionId: string;
  index: number;
  emotion: string;
  aspectRatio: string;
  references: ReferenceSlot[];
  prompt: string;
};

/**
 * One image per beat at the chosen shot size. Video models (Kling, Seedance) follow separate
 * images far better than one multi-panel sheet. One character: a portrait 3:4 character shot.
 * Several: a scene frame of the whole cast at the video's aspect ratio, in fixed screen positions;
 * the beat's actor performs, the others react.
 */
export function buildExpressionHandoffs(data: ProjectData): ExpressionHandoff[] {
  const s = data.expressionSetup;
  const framing = s.framing;
  const hands = showsHands(framing);
  const multi = isMultiCast(data);
  const aspect = imageAspectFor(data);
  // Every other expression is drawn to match the continuity anchor (연결 기준 그림).
  const anchor = continuityAnchor(data);
  const anchorNo = anchor ? data.expressions.findIndex((x) => x.id === anchor.id) + 1 : 0;
  // 영어 정리: short English for the parts that still match the design (the Korean is used otherwise)
  const en = freshEnglish(data);
  const style = en.style ?? clean(data.style);
  return data.expressions.map((e, i) => {
    const eb = en.beats.get(e.id);
    const actor = beatActor(data, e);
    const actorName = castName(data, actor.id);
    const references = identityRefs(data);
    const usesRef = Boolean(s.refAssetId && e.panel);
    if (usesRef)
      references.push({
        role: `image reference ${references.length + 1}`,
        assetId: s.refAssetId!,
        why: `연기 참고: ${e.panel}번 칸만 (그림체는 가져오지 않음)`,
      });
    const refIndex = references.length;
    const usesAnchor = Boolean(anchor?.imageAssetId && anchor.id !== e.id);
    if (usesAnchor)
      references.push({
        role: `image reference ${references.length + 1}`,
        assetId: anchor!.imageAssetId!,
        why: `연결 기준: ${anchorNo}번 표정 그림 (같은 쇼트의 다른 순간)`,
      });
    const expression = eb
      ? `${INTENSITY_EN[e.intensity]} ${eb.emotion}. ${sentence(eb.face)} ${directionEn(e)}`
      : expressionLine(e, i, "en").replace(/^Panel \d+: /, "");
    const refSheet =
      usesRef &&
      `Image reference ${refIndex} is a grid of ${s.refColumns}x${s.refRows} expression panels drawn in another style. Use ONLY panel ${e.panel} (counting left to right, top to bottom) as a guide for ${
        multi ? `${actorName}'s` : "the"
      } facial acting${s.transfer === "expression_and_pose" ? " and head pose" : ""}. Do NOT copy its drawing style, line weight, colors, proportions or character design.`;
    const styleLine = style && `Art style: ${style.replace(/[.。]+$/, "")}. Keep this style${multi ? " for every character" : ""}; do not switch to photorealism or 3D.`;

    if (!multi) {
      const prompt = [
        `Single character illustration of ONE character, portrait ${aspect}, ${FRAMING_IMAGE_EN[framing]}. Eye-level camera, plain white background. Not a sheet, not multiple panels, no other characters.`,
        ONE_SHOT_IMAGE_EN,
        `Composition: ${FRAMING_COMPOSITION_EN[framing]}.`,
        HEADROOM_EN,
        portraitFrameEn(hands),
        usesAnchor &&
          `Image reference ${references.length} is another moment of this SAME shot (expression ${anchorNo}): match its camera distance, framing, head size and position, body placement and stance, lighting and line quality exactly; change only the facial acting, head direction${
            hands ? ", arms and hands" : ""
          } as described below. Do not copy its expression${hands ? " or gesture" : ""}.`,
        ...castIdentityEn(data, references),
        ...castLookEn(data, en, { appearance: true, outfit: true }),
        styleLine,
        refSheet,
        `Expression: ${expression}`,
        bodyLanguageEn(e, framing, eb ? eb.body : e.gesture),
        s.instruction && `Additional direction: ${clean(s.instruction)}`,
        `Keep exactly the same shot size, head size and position, and white background as the other expression images of this character so they work as a matching set; only the face, head direction${
          hands ? ", arms and hands" : ""
        } change.`,
        `No text, no labels, no borders.`,
      ]
        .filter(Boolean)
        .join("\n");
      return { expressionId: e.id, index: i, emotion: e.emotion, aspectRatio: aspect, references, prompt };
    }

    const n = data.cast.length;
    const others = data.cast.filter((c) => c.id !== actor.id).map((c) => castName(data, c.id));
    const othersText = clean(e.others)
      ? `The others: ${sentence(clean(e.others))}`
      : `The others (${others.join(", ")}): listening to ${actorName} with subtle, natural reactions and closed mouths, staying in their positions and looking toward ${actorName}.`;
    const prompt = [
      `Scene frame of ${n} characters together in ONE ${aspect} image, ${FRAMING_SCENE_EN[framing]}. Eye-level camera, plain white background. Not a sheet, not multiple panels or split screens; exactly these ${n} characters and nobody else.`,
      `Blocking (screen positions, identical in every frame of this scene): ${blockingEn(data)}.`,
      `This image is one moment of ONE continuous shot with no cuts: every frame of this scene shares the same camera, shot size, character sizes and positions, lighting and white background; only the acting changes.`,
      `Composition: every character fully readable at this shot size with their whole head and any headwear inside the frame and a clear white margin above; characters do not overlap each other's faces; nobody is cut in half by the side edges.`,
      usesAnchor &&
        `Image reference ${references.length} is another moment of this SAME shot (frame ${anchorNo}): match its camera distance, framing, every character's size, position and stance, lighting and line quality exactly; change only the acting described below. Do not copy its expressions or gestures.`,
      ...castIdentityEn(data, references),
      ...castLookEn(data, en, { appearance: true, outfit: true }),
      styleLine,
      refSheet,
      `${actorName} acts this moment (the focus of the frame). Expression: ${expression}`,
      bodyLanguageEn(e, framing, eb ? eb.body : e.gesture),
      othersText,
      s.instruction && `Additional direction: ${clean(s.instruction)}`,
      `Keep exactly the same camera, character positions and sizes, and white background as the other frames of this scene so they work as a matching set; only the faces, head directions${
        hands ? ", arms and hands" : ""
      } change.`,
      `No text, no labels, no name tags, no borders.`,
    ]
      .filter(Boolean)
      .join("\n");
    return { expressionId: e.id, index: i, emotion: e.emotion, aspectRatio: aspect, references, prompt };
  });
}

/** Shot size of a video keyframe (start or end frame), drawn at the video's own aspect ratio. */
const FRAMING_FRAME_EN: Record<Framing, string> = {
  close_up: "close-up: the face fills most of the frame, cut at the neck and collarbones",
  bust: "bust shot: cut across the chest just below the armpits, head and shoulders with a little headroom",
  medium: "medium shot: cut at the waist, the whole upper body with both arms and hands",
};

export type FrameHandoff = { prompt: string; aspectRatio: string; references: ReferenceSlot[] };

/**
 * A start or end frame for the video (시작·끝 프레임): one expression's moment, redrawn at the video's
 * aspect ratio and the chosen shot size, so a camera move (close-up → bust) can be set by the two frames
 * instead of by words. Same character, same acting; only the framing changes.
 */
export function buildFrameHandoff(data: ProjectData, expressionId: string, shot: Framing): FrameHandoff {
  const e = data.expressions.find((x) => x.id === expressionId);
  if (!e) throw new Error("표정을 찾을 수 없습니다.");
  const multi = isMultiCast(data);
  const en = freshEnglish(data);
  const eb = en.beats.get(e.id);
  const vertical = data.video.aspectRatio === "9:16";
  const director = data.video.extraDirection.trim();
  const references = identityRefs(data);
  const momentRef = e.imageAssetId ? references.length + 1 : 0;
  if (e.imageAssetId) references.push({ role: `image reference ${momentRef}`, assetId: e.imageAssetId, why: "이 순간의 표정·자세" });
  const style = en.style ?? clean(data.style);
  const actorName = castName(data, beatActor(data, e).id);
  const prompt = [
    multi
      ? `One frame of a ${data.video.aspectRatio} ${vertical ? "vertical" : "horizontal"} video: ${data.cast.length} characters together, ${FRAMING_SCENE_EN[shot]}. Eye-level camera. Not a sheet, no panels or split screens, nobody else, no text.`
      : `One frame of a ${data.video.aspectRatio} ${vertical ? "vertical" : "horizontal"} video: ONE character, ${FRAMING_FRAME_EN[shot]}. Eye-level camera. Not a sheet, no panels, no other characters, no text.`,
    multi && `Blocking (screen positions): ${blockingEn(data)}.`,
    ...castIdentityEn(data, references),
    momentRef
      ? `Image reference ${momentRef} is the exact moment to draw: the same facial expressions, head directions, arms and hands${multi ? " of every character" : ""}. Only the camera framing changes to this shot size; never change the acting.`
      : `${multi ? `${actorName} acts this moment. ` : ""}Expression: ${INTENSITY_EN[e.intensity]} ${eb?.emotion ?? e.emotion}. ${eb ? sentence(eb.face) : ""} ${directionEn(e)}`,
    ...castLookEn(data, en, { appearance: false, outfit: false, max: multi ? 5 : 8 }),
    style && `Art style: ${style.replace(/[.。]+$/, "")}. Keep ${multi ? "every character" : "the character"} in this 2D style; never photorealistic or 3D.`,
    directorBackground(director) ? `Background as in this direction: ${clip(director, 400) || director.slice(0, 400)}` : "Plain white background.",
    multi
      ? `Composition: the characters in their screen positions; every head and any headwear inside the frame with a little headroom; fill the ${data.video.aspectRatio} frame at this shot size (no white bars or padding).`
      : `Composition: the character centered; the whole head and any headwear inside the frame with a little headroom; fill the ${data.video.aspectRatio} frame at this shot size (no white bars or padding).`,
  ]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join("\n");
  return { prompt, aspectRatio: data.video.aspectRatio, references };
}

export type VideoReference = { assetId: string; label: string; role: "identity" | "expression"; expressionId?: string; characterId?: string };

/** Reference images a video model takes at most (identity + beat images). */
export const MAX_VIDEO_REFERENCES = 7;

export type VideoHandoff = {
  recommendedModel: string;
  startFrame: string;
  references: VideoReference[];
  /** what the video model gets; always ends with the studio constraints */
  prompt: string;
  promptKo: string;
  /** whether the team's texts ask for a camera move (decides the camera line) */
  cameraMove: boolean;
  /** what the automatic reconciliation changed in the team's texts so nothing contradicts the constraints */
  adjustments: Adjustment[];
  /** the constraints block actually used (its camera sentence follows the director's rig, if any) */
  constraints: string;
  /** app defaults the director's additional direction replaced (camera, angle, background) */
  overrides: string[];
  /** the director's direction as it appears in the prompt ("" when not written) */
  directorBlock: string;
  /** the length this prompt aims for (longer with 영어 정리) */
  lengthTarget: number;
};

/**
 * Reference images for the video, in upload order:
 * each cast member's base drawing (identity), then one image per beat in timeline order.
 * Capped (models accept a limited number of references): the cast always comes first.
 */
export function videoReferences(data: ProjectData, maxExpressions = MAX_VIDEO_REFERENCES - data.cast.length): VideoReference[] {
  const refs: VideoReference[] = [];
  const multi = isMultiCast(data);
  for (const c of data.cast)
    if (c.baseAssetId)
      refs.push({
        assetId: c.baseAssetId,
        label: multi ? `${castLabel(data, c.id)} 기본 그림 — character identity` : "캐릭터 기본 그림 — original character identity",
        role: "identity",
        characterId: c.id,
      });
  const seen = new Set<string>();
  for (const seg of data.acting.segments) {
    const i = data.expressions.findIndex((e) => e.id === seg.expressionId);
    const e = data.expressions[i];
    if (!e?.imageAssetId || seen.has(e.imageAssetId) || seen.size >= maxExpressions) continue;
    seen.add(e.imageAssetId);
    refs.push({ assetId: e.imageAssetId, label: `${i + 1}번 ${e.emotion || "표정"} — approved expression target`, role: "expression", expressionId: e.id });
  }
  if (!seen.size && data.expressionSetup.sheetAssetId)
    refs.push({ assetId: data.expressionSetup.sheetAssetId, label: "표정 시트 (이전 방식) — expression targets, panels left to right", role: "expression" });
  return refs;
}

/** Text length caps for each beat field in the video prompt (Infinity = full text, for the team's summary). */
type Limits = { face: number; gesture: number; note: number; transition: number; delivery: number };
const FULL: Limits = { face: Infinity, gesture: Infinity, note: Infinity, transition: Infinity, delivery: Infinity };
/**
 * Header caps too; tried in order until the prompt fits its target (the last one is used regardless).
 * English beats (영어 정리) are short already: they only drop the pose line, then the body line;
 * the transition always stays.
 */
type Budget = Limits & { style: number; voice: number; features: number; enPose: boolean; enBody: boolean };
const BUDGETS: Budget[] = [
  { face: 60, gesture: 110, note: 60, transition: 100, delivery: 100, style: 160, voice: 160, features: 6, enPose: true, enBody: true },
  { face: 30, gesture: 80, note: 0, transition: 80, delivery: 70, style: 140, voice: 140, features: 6, enPose: true, enBody: true },
  // the expression images show the face, then the gesture: drop that text first and keep the
  // transition (how one expression moves into the next — what keeps it from morphing)
  { face: 0, gesture: 60, note: 0, transition: 70, delivery: 50, style: 80, voice: 80, features: 4, enPose: false, enBody: true },
  { face: 0, gesture: 0, note: 0, transition: 60, delivery: 40, style: 50, voice: 50, features: 3, enPose: false, enBody: false },
];
/** Video models follow prompts up to roughly this length well (constraints included); longer ones get diluted. */
export const VIDEO_PROMPT_TARGET = 3500;
/** With 영어 정리 the beats carry real acting in short English, worth a little more room. */
export const VIDEO_PROMPT_TARGET_EN = 5000;

/**
 * Shorten to at most `max` characters at a sentence end, else at a clause end, never inside brackets.
 * When not even one clause fits, returns "" and the field is left out: a broken-off instruction
 * ("0~0…", "after a 0.3-second silent") reads as noise to the video model.
 */
const clip = (t: string, max: number) => {
  const c = clean(t);
  if (max === Infinity || c.length <= max) return c;
  const head = c.slice(0, max + 1);
  // never end inside brackets ("화면 왼쪽 손(캐릭터 오른손." is noise)
  const closed = (s: string) => (s.match(/[(（[]/g)?.length ?? 0) === (s.match(/[)）\]]/g)?.length ?? 0);
  const lastEnd = (re: RegExp) => {
    let at = -1;
    for (const m of head.matchAll(re)) {
      const end = (m.index ?? 0) + m[0].length;
      if (end <= max && closed(c.slice(0, end))) at = end;
    }
    return at;
  };
  const minKeep = Math.min(12, max / 3);
  const sentenceEnd = lastEnd(/[.!?。](?=\s|$)/g);
  if (sentenceEnd >= minKeep) return c.slice(0, sentenceEnd).trim();
  const clauseEnd = lastEnd(/[,，;；](?=\s)/g);
  if (clauseEnd >= minKeep) return `${c.slice(0, clauseEnd - 1).trim()}.`;
  // not even one clause fits: leave the field out rather than send a fragment
  return "";
};
/** First sentence only (the rest of a detailed description is shown by the reference image). */
const firstSentence = (t: string) => clean(t).split(/(?<=[.!?。])\s/)[0] ?? "";
const noEndDot = (t: string) => t.replace(/[.。]+$/, "");
const sentence = (t: string) => (/[.!?。…]$/.test(t) ? t : `${t}.`);

/** Acting text for one beat, skipping empty fields. */
function actingKo(e: Expression, framing: Framing, L: Limits = FULL): string {
  const d = e.direction;
  const face = (t: string) => (L.face ? noEndDot(clip(L.face === Infinity ? t : firstSentence(t), L.face)) : "");
  const gesture = showsHands(framing) && L.gesture ? noEndDot(clip(e.gesture, L.gesture)) : "";
  const note = L.note ? noEndDot(clip(e.notes, L.note)) : "";
  const parts = [
    face(e.brows) && `눈썹: ${face(e.brows)}`,
    face(e.eyes) && `눈: ${face(e.eyes)}`,
    face(e.mouth) && `입: ${face(e.mouth)}`,
    gesture && `팔·손: ${gesture}`,
    note,
    `얼굴 ${FACING_LABEL[d.facing]}, ${PITCH_LABEL[d.pitch]}${d.tilt !== "none" ? `, ${TILT_LABEL[d.tilt]}` : ""}, 시선 ${GAZE_LABEL[d.gaze]}, 몸 ${FACING_LABEL[d.body]}`,
  ].filter((x): x is string => Boolean(x));
  return `${INTENSITY_LABEL[e.intensity]} 강도. ${parts.map((x) => `${noEndDot(x)}.`).join(" ")}`;
}

const fmtSec = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

/**
 * Short visible-feature names from the numbered "꼭 유지할 특징" list (the reference images show the details).
 * "1. 머리색: …\n2. 앞머리: …" or "1) A 2) B" → ["머리색", "앞머리"]: the list number of every item is dropped.
 */
export function shortLocks(locks: string, max = 6): string[] {
  return locks
    .split(/\n+|\s+(?=\d+[.)]\s)/)
    .map((x) => x.replace(/^\s*(?:[-•·*]\s*)?(?:\d+[.)]\s*)?/, ""))
    .map((x) => noEndDot(clean(x).split(/[:：]|(?<=[.。])\s/)[0] ?? "").trim())
    // a one-letter feature ("눈") counts; a stray number or mark does not
    .filter((x) => /\p{L}/u.test(x))
    .map(shortName)
    .slice(0, max);
}

/** A feature name of at most 30 characters: parenthetical details go first, then whole words. */
function shortName(x: string): string {
  const t = x.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim() || x;
  if (t.length <= 30) return t;
  const space = t.lastIndexOf(" ", 30);
  return (space > 10 ? t.slice(0, space) : t.slice(0, 30)).trim();
}

/** Language names as the team types them → names the video model understands. */
const LANG_EN: Record<string, string> = {
  영어: "English",
  영국영어: "British English",
  미국영어: "American English",
  고대영어: "Old English",
  중세영어: "Middle English",
  한국어: "Korean",
  일본어: "Japanese",
  중국어: "Mandarin Chinese",
  독일어: "German",
  불어: "French",
  프랑스어: "French",
  스페인어: "Spanish",
  이탈리아어: "Italian",
  포르투갈어: "Portuguese",
  러시아어: "Russian",
  라틴어: "Latin",
  아랍어: "Arabic",
  고대아랍어: "Classical Arabic",
  고전아랍어: "Classical Arabic",
  표준아랍어: "Modern Standard Arabic",
  페르시아어: "Persian",
  터키어: "Turkish",
  히브리어: "Hebrew",
  그리스어: "Greek",
  고대그리스어: "Ancient Greek",
  힌디어: "Hindi",
  산스크리트어: "Sanskrit",
  베트남어: "Vietnamese",
  태국어: "Thai",
  인도네시아어: "Indonesian",
  말레이어: "Malay",
  네덜란드어: "Dutch",
  스웨덴어: "Swedish",
  폴란드어: "Polish",
  몽골어: "Mongolian",
  광동어: "Cantonese",
  한문: "Classical Chinese",
  고대중국어: "Classical Chinese",
  고어일본어: "Classical Japanese",
  고대일본어: "Classical Japanese",
  중세국어: "Middle Korean",
};
export const languageEn = (l: string) => LANG_EN[l.replace(/\s+/g, "")] ?? l.trim();
const OLD_ENGLISH_HINT = `Pronounce the Old English lines authentically: þ and ð as "th", æ as in "cat", c before e or i as "ch", sc as "sh"; every written letter is spoken.`;

/**
 * `source` says how the character's look reaches the video model:
 * - references: character design + one image per expression (default; best for Kling/Seedance)
 * - start_frame: a single attached first frame
 *
 * The prompt stays compact: the reference images carry the look, so the
 * character text is reduced to key features, and long beat descriptions are
 * trimmed (the full text is kept in promptKo for the team). The studio
 * constraints always come last, and the team's texts are reconciled with them
 * first (자동 조율) so the prompt never contradicts itself.
 */
export function buildVideoHandoff(
  data: ProjectData,
  source: "start_frame" | "references" = "references",
  /** the last frame is attached too (start-frame mode, models that take one) */
  opts: { endFrame?: boolean } = {},
): VideoHandoff {
  const endFrame = source === "start_frame" && (opts.endFrame ?? Boolean(data.video.endFrameAssetId));
  const multi = isMultiCast(data);
  const nameOf = (expressionId: string) => {
    const e = data.expressions.find((x) => x.id === expressionId);
    return e ? castName(data, beatActor(data, e).id) : "";
  };
  const byId = new Map(data.expressions.map((e, i) => [e.id, { e, i }]));
  const lineFor = (id: string) => data.dialogue.lines.find((l) => l.expressionId === id);
  const refs = source === "references" ? videoReferences(data) : [];
  const refNo = (expressionId: string) => {
    const k = refs.findIndex((r) => r.expressionId === expressionId);
    return k >= 0 ? k + 1 : null;
  };
  const vertical = data.video.aspectRatio === "9:16";
  const framing = data.expressionSetup.framing;
  const hands = showsHands(framing);
  // 영어 정리: short English for every part that still matches the design; the rest is the Korean, shortened
  const en = freshEnglish(data);
  const lang = en.language ?? languageEn(data.dialogue.language || "");
  // render-check fixes the team accepted replace a text only in this prompt, while the step still holds it
  const fixOf = (target: "notes" | "gesture" | "transition" | "delivery" | "voice", expressionId: string | null, text: string) =>
    effectiveText(data, target, expressionId, text);

  // ── 자동 조율: the texts going into the prompt are adjusted to agree with the studio constraints ──
  const adjustments: Adjustment[] = [];
  const numberOf = (id: string) => (byId.get(id)?.i ?? 0) + 1;
  const enBeats = new Map(
    data.expressions.flatMap((e, i) => {
      const b = en.beats.get(e.id);
      if (!b) return [];
      return [
        [
          e.id,
          {
            emotion: b.emotion,
            face: reconcile(b.face, "face", `${i + 1}번 표정 얼굴 연기 (영어)`, adjustments),
            body: hands ? reconcile(b.body, "motion", `${i + 1}번 표정 팔·손 동작 (영어)`, adjustments) : "",
            transition: reconcile(b.transition, "motion", `${i + 1}번 표정 다음 표정으로 (영어)`, adjustments),
            delivery: reconcile(b.delivery, "voice", `${i + 1}번 표정 대사 말투 (영어)`, adjustments),
          },
        ] as const,
      ];
    }),
  );
  const fixedExpr = new Map(
    data.expressions
      .map((e, i) => [e, i] as const)
      .filter(([e]) => !enBeats.has(e.id))
      .map(([e, i]) => [
        e.id,
        {
          ...e,
          brows: reconcile(e.brows, "face", `${i + 1}번 표정 눈썹`, adjustments),
          eyes: reconcile(e.eyes, "face", `${i + 1}번 표정 눈`, adjustments),
          mouth: reconcile(e.mouth, "face", `${i + 1}번 표정 입`, adjustments),
          notes: reconcile(fixOf("notes", e.id, e.notes), "face", `${i + 1}번 표정 메모`, adjustments),
          gesture: hands ? reconcile(fixOf("gesture", e.id, e.gesture), "motion", `${i + 1}번 표정 팔·손 동작`, adjustments) : e.gesture,
        },
      ]),
  );
  const fixedTransition = new Map(
    data.acting.segments
      .map((x, k) => [x, k] as const)
      .filter(([x]) => !enBeats.has(x.expressionId))
      .map(([x, k]) => [
        x.expressionId,
        reconcile(fixOf("transition", x.expressionId, x.transition), "motion", `${k + 1}번 구간 ‘다음 표정으로’`, adjustments),
      ]),
  );
  const fixedDelivery = new Map(
    data.dialogue.lines
      .filter((l) => !enBeats.has(l.expressionId))
      .map((l) => [
        l.expressionId,
        reconcile(fixOf("delivery", l.expressionId, l.delivery), "voice", `${numberOf(l.expressionId)}번 표정 대사 말투`, adjustments),
      ]),
  );
  // one voice per cast member (English where fresh), reconciled like every other text
  const voices = data.cast
    .map((c) => ({
      id: c.id,
      fresh: Boolean(en.cast.get(c.id)?.voice),
      text: reconcile(en.cast.get(c.id)?.voice ?? fixOf("voice", c.id, c.voice), "voice", multi ? `${castLabel(data, c.id)} 목소리` : "목소리", adjustments),
    }))
    .filter((v) => v.text.trim());
  // The director's additional direction: kept whole (line breaks too), never trimmed.
  const director = reconcile(data.video.extraDirection, "direction", "추가 연출", adjustments);

  // ── What the director's direction decides (it wins over the app's general lines) ──
  const rig = directorRig(director);
  const angle = directorAngle(director);
  const background = directorBackground(director);
  // a real-world background asked for in a 2D character shot: the 2D rule then holds for the character only
  const realBackground = background && /실사|사실적|사진\s*같|photo-?real|realistic|live[- ]action/i.test(director);
  const directorCamera = Boolean(rig) || angle || hasCameraMove([director]);
  const cameraMove =
    directorCamera ||
    hasCameraMove([...data.acting.segments.map((x) => x.transition), ...data.expressions.map((e) => `${hands ? e.gesture : ""} ${e.notes}`)]);
  const overrides = [
    rig && `카메라 장비: 추가 연출의 ‘${rig}’을(를) 따름 — 제약사항의 HANDHELD 문장 대신 적용 (quiet and purposeful, alive, not chaotic는 유지)`,
    directorCamera && !rig && (hasCameraMove([director]) ? "카메라 움직임: 추가 연출을 따름 (제약사항대로 핸드헬드)" : "카메라: 추가 연출을 따름"),
    angle && "카메라 각도: 추가 연출을 따름 (앱의 ‘눈높이’ 문장 뺌)",
    background && "배경: 추가 연출을 따름 (앱의 ‘흰 배경’ 문장 뺌). 참고 그림이 흰 배경이라 영상도 흰 배경으로 나올 수 있습니다",
    realBackground && "그림체: 인물은 2D 그대로, 배경만 추가 연출의 실사 스타일을 따름 (앱의 ‘never photorealistic’은 인물에만 적용)",
  ].filter((x): x is string => Boolean(x));

  /** `fixed` = the texts for the model (English where fresh, reconciled); otherwise the team's original wording (for the summary). */
  const beatsWith = (L: Budget | Limits, fixed = true) =>
    data.acting.segments.map((seg, k) => {
      const original = byId.get(seg.expressionId)?.e;
      const l = lineFor(seg.expressionId);
      const n = refNo(seg.expressionId);
      const time = `${k + 1}. ${fmtSec(seg.start)}–${fmtSec(seg.end)} seconds`;
      // nothing follows the last beat: no move "into the next expression" there
      const last = k === data.acting.segments.length - 1;
      const target = n ? `${multi ? "Frame" : "Expression"} target: reference image ${n}.` : "";
      const eb = fixed ? enBeats.get(seg.expressionId) : undefined;
      const who = multi ? nameOf(seg.expressionId) : "";
      const others = multi && original ? clean(original.others) : "";
      const says = (text: string) => (multi ? `${who} says exactly (${lang}): "${text}"` : `Say exactly (${lang}): "${text}"`);
      if (eb && original) {
        // short English: face, hands, the checked direction, then the move into the next expression
        const B = "enPose" in L ? L : BUDGETS[0];
        const acting = [
          eb.face && sentence(eb.face),
          B.enBody && eb.body && sentence(eb.body),
          B.enPose && poseShort(original),
          !last && eb.transition && `Into the next expression: ${sentence(eb.transition)}`,
        ].filter(Boolean);
        return [
          `${time}: ${who ? `${who} — ` : ""}${eb.emotion || original.emotion || "expression"}`,
          target,
          `${who ? `${who} acts` : "Acting"} (${INTENSITY_EN[original.intensity]}): ${acting.join(" ")}`,
          // the English body line already carries the others' reactions; with no English the Korean is used
          l?.line ? `${says(l.line)}${eb.delivery ? ` — ${eb.delivery}` : ""}` : "No dialogue in this beat.",
        ]
          .filter(Boolean)
          .join("\n");
      }
      const e = fixed ? fixedExpr.get(seg.expressionId) : original;
      const transition = fixed ? fixedTransition.get(seg.expressionId) ?? "" : seg.transition;
      const delivery = fixed ? fixedDelivery.get(seg.expressionId) ?? "" : l?.delivery ?? "";
      const acting = e ? actingKo(e, framing, L) : "";
      const move = L.transition && !last ? noEndDot(clip(transition, L.transition)) : "";
      const how = L.delivery ? clip(delivery, L.delivery) : "";
      const othersLine = multi
        ? others
          ? `다른 인물: ${noEndDot(clip(others, L === FULL ? Infinity : 160))}.`
          : "The others listen and react with closed mouths."
        : "";
      return [
        `${time}: ${who ? `${who} — ` : ""}${e?.emotion || "expression"}`,
        target,
        `${who ? `${who} acts` : "Acting"}: ${acting}${move ? ` 다음 표정으로: ${move}.` : ""}`,
        othersLine,
        l?.line ? `${says(l.line)}${how ? ` — ${how}` : ""}` : "No dialogue in this beat.",
      ]
        .filter(Boolean)
        .join("\n");
    });

  const theChar = multi ? "the characters'" : "the character's";
  const camera = directorCamera
    ? `Camera: exactly as in the DIRECTOR'S DIRECTION below (rig, path, speed, height and angle); one continuous take with no cuts, and ${theChar} proportions never change.`
    : cameraMove
      ? `Camera move: as described in the beats, HANDHELD as in the Constraints at the end; one continuous take with no cuts, and ${theChar} proportions never change.`
      : multi
        ? "Camera move: none. The framing holds still on the group for the whole shot (no zoom, pan or push-in); every character stays at the same distance, size and position in the frame, and gestures toward the viewer never lunge into the camera."
        : "Camera move: none. The framing holds still on the character for the whole shot (no zoom, pan or push-in); the character stays at the same distance, size and position in the frame, and gestures toward the viewer never lunge into the camera.";
  // look lines: per character in a group (fewer features each so the header stays short)
  const lookFor = (B: Budget) => {
    const per = multi ? Math.max(2, B.features - data.cast.length + 1) : B.features;
    return data.cast.map((c) => {
      const f = en.cast.get(c.id);
      const who = multi ? `${castName(data, c.id)}: ` : "";
      if (f?.look) return `${who}${f.look.slice(0, per).join("; ")}`;
      const locks = shortLocks(c.locks, per);
      if (locks.length) return `${who}${locks.join(", ")}`;
      const look = clip(c.appearance, 200);
      return look ? `${who}${noEndDot(look)}` : "";
    }).filter(Boolean);
  };
  const styleText = en.style ?? data.style;
  const headerWith = (B: Budget) =>
    [
      `ONE single continuous shot with no cuts: a ${data.acting.duration}-second ${multi ? `${data.cast.length}-character scene` : "character acting shot"}, ${data.video.aspectRatio}. Every beat below is a moment of this same shot; never cut away or change the shot.`,
      multi && `Cast (exactly these ${data.cast.length} characters, always in these screen positions; nobody else): ${blockingEn(data)}.`,
      lookFor(B).length && `Keep visible${multi ? " — " : ": "}${lookFor(B).join(multi ? " | " : "; ")}.`,
      styleText.trim() &&
        `Art style: ${((s) => (s ? `${sentence(s)} ` : ""))(en.style ? clip(en.style, Math.max(B.style, 160)) : clip(data.style, B.style))}${
          realBackground
            ? "Keep the character in this 2D style (never photorealistic or 3D); only the background follows the DIRECTOR'S DIRECTION."
            : "Stay in this 2D style; never photorealistic or 3D."
        }`,
      multi
        ? `Match the reference images exactly: every character keeps their own face, hair, colors, costume and the shared drawing style; never swap or blend features between characters. Each character's face shape, eye shape and size, nose, hairline and body proportions stay identical in every beat; only the expression muscles (brows, eyelids, mouth) and the poses change.`
        : `Match the reference images exactly: same face, hair, colors, costume and drawing style. Only one character appears. The face shape, eye shape and size, nose, hairline and body proportions stay identical in every beat; only the expression muscles (brows, eyelids, mouth) and the pose change.`,
      background
        ? `Never stretch ${multi ? "the characters" : "the character"} horizontally or squash ${multi ? "them" : "it"} vertically: keep the reference proportions (face, neck, shoulders, head-to-body size). The white margins in the reference images are only padding, not part of the scene.`
        : multi
          ? `Never stretch the characters horizontally or squash them vertically: keep the reference proportions (face, neck, shoulders, head-to-body size) and their relative heights, on a white background.`
          : `Never stretch the character horizontally or squash it vertically: keep the reference proportions (face, neck, shoulders, head-to-body size), centered, with white background filling the ${
              vertical ? "top and bottom" : "left and right"
            }.`,
      `${background ? "Background as in the DIRECTOR'S DIRECTION below" : "White background"}, ${cameraMove ? `starting at ${FRAMING_VIDEO_EN[framing]}` : FRAMING_VIDEO_EN[framing]}${
        angle ? "" : ", eye-level"
      }${vertical ? ", composed for a vertical frame" : ""}. ${camera} No extra characters, text or subtitles.`,
      multi &&
        `Dialogue: only the character named for a line speaks it, with their own voice and lip movement; while one character speaks the others keep their mouths closed and listen (reacting with eyes, brows, breath and small head moves). Lines never overlap unless a beat says so.`,
      hands &&
        `Arms and hands act together with the face, stepping through in-between poses from one expression reference's gesture to the next (never jumping straight to the next pose); hands always correctly drawn.`,
      refs.length
        ? [
            `Reference images (upload in this order):`,
            ...refs.map((r, i) => {
              if (r.role === "identity")
                return multi && r.characterId
                  ? `${i + 1}. character design of ${castName(data, r.characterId)} (${POSITION_EN[data.cast.find((c) => c.id === r.characterId)?.position ?? "center"]}) — identity only`
                  : `${i + 1}. character design — may show several views of the same character; use it for identity only`;
              const eb = r.expressionId ? enBeats.get(r.expressionId) : undefined;
              const label = multi ? "approved scene frame" : "approved expression target";
              return `${i + 1}. ${eb ? `${multi ? "frame" : "expression"} ${numberOf(r.expressionId!)} (${multi ? `${nameOf(r.expressionId!)}: ` : ""}${eb.emotion}) — ${label}` : r.label}`;
            }),
          ].join("\n")
        : `Use the start frame as the exact ${multi ? "design of every character, their positions and the first poses" : "character design and the first pose"}.${
            endFrame
              ? " The shot ends exactly on the end frame (its framing, pose and expression): move the camera and the acting continuously from the start frame to the end frame."
              : ""
          }`,
      refs.some((r) => r.role === "expression") &&
        (multi
          ? `Frame references are successive moments of this same shot of the whole cast. Do not render a grid or split screen; never duplicate a character.`
          : refs.length > 1 && `Expression references are successive moments of this same shot for the same character. Do not render a grid, split screen or multiple faces.`),
      voices.length &&
        (multi
          ? `Voices (each character keeps their own voice): ${voices
              .map((v) => `${castName(data, v.id)} — ${noEndDot(clip(v.text, v.fresh ? Math.max(B.voice, 160) : B.voice) || clean(v.text).slice(0, 60))}`)
              .join("; ")}. Speak only the exact dialogue below; never read direction text aloud.`
          : `Voice: ${((s) => (s ? `${sentence(s)} ` : ""))(clip(voices[0].text, voices[0].fresh ? Math.max(B.voice, 160) : B.voice))}Speak only the exact dialogue below; never read direction text aloud.`),
      lang === "Old English" && OLD_ENGLISH_HINT,
      `Stay alive between and during the lines (breathing, blinks, small head and shoulder accents). Each expression change is acted, not morphed: it rides on a physical action (a blink, a breath, a small head turn or a hand passing the face) and steps through in-between poses; the face never melts, warps or blends from one expression into the next.`,
    ]
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n");

  // Order: general lines → beats → the director's own words (never trimmed) → studio constraints (always last).
  const directorBlock = director
    ? `DIRECTOR'S DIRECTION (the director's own words: follow exactly; where it differs from the general camera, framing or background lines above, this wins):\n${director}`
    : "";
  const constraints = constraintsFor(rig);
  const assemble = (B: Budget) => [headerWith(B), beatsWith(B).join("\n\n"), directorBlock, constraints].filter(Boolean).join("\n\n");
  const lengthTarget = enBeats.size ? VIDEO_PROMPT_TARGET_EN : VIDEO_PROMPT_TARGET;
  let prompt = "";
  for (const B of BUDGETS) {
    prompt = assemble(B);
    if (prompt.length <= lengthTarget) break;
  }

  return {
    recommendedModel: multi ? "Kling 4.0 (여러 인물·대사 분리에 가장 안정적) / Seedance 2.5" : "Kling 4.0 / Seedance 2.5 (참고 그림 여러 장 첨부)",
    startFrame: refs.length
      ? "시작 프레임 없이, 아래 참고 그림을 순서대로 첨부하세요."
      : multi
        ? "첫 장면 그림(모든 인물이 들어간 그림)을 시작 프레임으로 첨부하세요."
        : "기본 그림이나 첫 표정 그림을 시작 프레임으로 첨부하세요.",
    references: refs,
    prompt,
    // full beat text in the team's original wording ("한국어로 내용 확인")
    promptKo: beatsWith(FULL, false).join("\n\n"),
    cameraMove,
    adjustments,
    constraints,
    overrides,
    directorBlock,
    lengthTarget,
  };
}
