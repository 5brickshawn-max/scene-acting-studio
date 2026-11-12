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
import { comboId, MAX_COMBO_PARTS } from "@/lib/combo";
import { MAX_PRINCIPLES, principleOf } from "./principles";
import { constraintsFor, dropConstraintRepeats, negativePrompt, directorAngle, directorBackground, directorRig, hasCameraMove, reconcile, type Adjustment } from "./constraints";
import { freshEnglish } from "./english";
import {
  isVoiceOver,
  cutBefore,
  shotsOf,
  usesConti,
  isStoryboard,
  beatActor,
  performancesOf,
  type Performance,
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
function bodyLanguageEn(e: Pick<Performance, "emotion" | "gesture">, framing: Framing, text = e.gesture): string {
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

/** One character's acting in English from the team's fields (used where there is no fresh English). */
function performanceLineEn(p: Omit<Performance, "characterId">): string {
  return clean(
    [`${INTENSITY_EN[p.intensity]} ${p.emotion || "neutral listening"}.`, p.brows && `Brows: ${p.brows}.`, p.eyes && `Eyes: ${p.eyes}.`, p.mouth && `Mouth: ${p.mouth}.`]
      .filter(Boolean)
      .join(" "),
  );
}

/** Short body-language clause for a group frame (bust and medium shots only). */
function bodyLanguageShortEn(p: Pick<Performance, "emotion">, framing: Framing, text: string): string {
  if (!showsHands(framing)) return "";
  return text.trim() ? `Body: ${clean(text).replace(/[.。]+$/, "")}.` : `Body: a natural arm and hand pose that fits "${p.emotion || "the moment"}".`;
}

/** Head, gaze and body direction in English (from the checked direction values, never from free text). */
function directionEn(e: Pick<Performance, "direction">): string {
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
function poseShort(e: Pick<Performance, "direction">): string {
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

/** How to find a character in the scene drawing: screen position and the first must-keep feature. */
function spotEn(data: ProjectData, c: CastMember, en: ReturnType<typeof freshEnglish>): string {
  const mark = en.cast.get(c.id)?.look?.[0] ?? shortLocks(c.locks, 1)[0];
  return `${castName(data, c.id)} is the one ${c.position === "center" ? "in the center" : `on the ${POSITION_EN[c.position]} side`}${mark ? ` (${mark})` : ""}`;
}

/**
 * Identity lines. One character: image reference 1 is that character. Several: image reference 1 is the
 * scene drawing with the whole cast together — every character, their relative sizes and the style come
 * from that one image.
 */
function castIdentityEn(data: ProjectData, refs: ReferenceSlot[], en: ReturnType<typeof freshEnglish>): string[] {
  if (!refs.length || refs[0].assetId !== data.baseAssetId) return [];
  if (!isMultiCast(data))
    return [`The character must match image reference 1 exactly: same identity, face proportions, hairstyle, colors, costume, accessories and art style.`, ...extraRefsEn(data, refs)];
  return [
    `Image reference 1 is the scene reference drawing of the whole cast together: ${data.cast.map((c) => spotEn(data, c, en)).join("; ")}.`,
    `Every character must match their own look in image reference 1 exactly: same identity, face proportions, hairstyle, colors, costume, accessories, and the same relative heights and body sizes between the characters. Never mix features between characters.`,
    ...extraRefsEn(data, refs),
  ];
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

/**
 * What the references after the scene picture are: each character's own material (a design sheet) and the
 * scene's extra references. Without these lines a model gets images it is never told how to use.
 */
function extraRefsEn(data: ProjectData, refs: ReferenceSlot[]): string[] {
  const lines: string[] = [];
  refs.forEach((r, i) => {
    if (r.why.startsWith("인물 자료") && r.characterId)
      lines.push(
        `Image reference ${i + 1} is the design sheet of ${castName(data, r.characterId)}: copy their face, hair colour and hairstyle, body proportions and the design details of their clothes exactly from it — for the face, hair and body the design sheet wins over any text. What they WEAR in this scene follows the scene's costume text and this panel's continuity (a disguise, robe, hood or face cover worn over the sheet's clothes, or taken off later); the text also adds passing details (dirt, tears, wind, what they hold).`,
      );
  });
  const extra = refs.flatMap((r, i) => (r.why.startsWith("추가 참고") ? [i + 1] : []));
  if (extra.length)
    lines.push(
      `Image reference${extra.length > 1 ? "s" : ""} ${extra.join(", ")} ${extra.length > 1 ? "are" : "is"} extra design reference for this scene (characters, props, places): use ${extra.length > 1 ? "them" : "it"} for design details only, never for composition.`,
    );
  return lines;
}

/** Each character's own material, in cast order (after the scene picture). */
/** Reference images one image request carries at most (scene picture, character material, extras, sketch, anchor). */
export const MAX_IMAGE_REFERENCES = 12;

/** The extra reference pictures that still fit after `used`, keeping `reserve` places (sketch, anchor). */
function extraRefsFitting(data: ProjectData, used: { assetId: string }[], reserve: number): string[] {
  const room = Math.max(0, MAX_IMAGE_REFERENCES - used.length - reserve);
  return data.designRefAssetIds.filter((x) => !used.some((r) => r.assetId === x)).slice(0, room);
}

function castMaterialRefs(data: ProjectData, start: number): ReferenceSlot[] {
  return data.cast.flatMap((c, k) =>
    c.refAssetId && c.refAssetId !== data.baseAssetId
      ? [{ role: `image reference ${start + k + 1}`, assetId: c.refAssetId, why: `인물 자료: ${castLabel(data, c.id)}`, characterId: c.id }]
      : [],
  );
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

/** References shared by every beat image, in prompt order: the scene drawing, then the extra references. */
function identityRefs(data: ProjectData): ReferenceSlot[] {
  const refs: ReferenceSlot[] = [];
  const multi = isMultiCast(data);
  if (data.baseAssetId)
    refs.push({ role: "image reference 1", assetId: data.baseAssetId, why: multi ? "장면 기준 그림 — 출연진 전원의 정체성·크기·그림체" : "캐릭터 정체성·그림체의 기준" });
  for (const r of castMaterialRefs(data, refs.length)) refs.push({ ...r, role: `image reference ${refs.length + 1}` });
  for (const id of extraRefsFitting(data, refs, 2))
    refs.push({ role: `image reference ${refs.length + 1}`, assetId: id, why: "추가 참고 그림" });
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
export function buildExpressionHandoffs(data: ProjectData, fixes: Record<string, string> = {}): ExpressionHandoff[] {
  if (isStoryboard(data)) return buildStoryboardHandoffs(data, fixes);
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
  const style = studioStyle(en.style ?? clean(data.style));
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
    const styleLine = style && `Art style: ${style.replace(/[.。]+$/, "")}. Keep this 3D & 2.5D animation style${multi ? " for every character" : ""}; never photorealistic.`;

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
        ...castIdentityEn(data, references, en),
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
        fixes[e.id]?.trim() && `Corrections from the review of the previous version of this image (fix all of these; keep everything else): ${sentence(clean(fixes[e.id]).slice(0, 900))}`,
      ]
        .filter(Boolean)
        .join("\n");
      return { expressionId: e.id, index: i, emotion: e.emotion, aspectRatio: aspect, references, prompt };
    }

    const n = data.cast.length;
    // every character's acting in this moment, in screen order (the lead first)
    const others = new Map((eb?.others ?? []).map((o) => [o.characterId, o]));
    const lines = performancesOf(data, e)
      .sort((x, y) => Number(y.lead) - Number(x.lead))
      .map((p) => {
        const name = castName(data, p.characterId);
        const role = p.lead ? (data.dialogue.lines.find((l) => l.expressionId === e.id)?.line.trim() ? " — speaking" : " — the focus of the moment") : "";
        const o = p.lead ? (eb ? { emotion: eb.emotion, face: eb.face, body: eb.body } : null) : others.get(p.characterId) ?? null;
        const face = o ? `${INTENSITY_EN[p.intensity]} ${o.emotion}. ${o.face ? sentence(o.face) : ""}` : performanceLineEn(p);
        const body = bodyLanguageShortEn(p, framing, o ? o.body : p.gesture);
        return `- ${name}${role}: ${clean(`${face} ${directionEn(p)} ${body}`)}`;
      });
    const prompt = [
      `Scene frame of ${n} characters together in ONE ${aspect} image, ${FRAMING_SCENE_EN[framing]}. Eye-level camera, plain white background. Not a sheet, not multiple panels or split screens; exactly these ${n} characters and nobody else.`,
      `Blocking (screen positions, identical in every frame of this scene): ${blockingEn(data)}.`,
      `This image is one moment of ONE continuous shot with no cuts: every frame of this scene shares the same camera, shot size, character sizes and positions, lighting and white background; only the acting changes.`,
      `Composition: every character fully readable at this shot size with their whole head and any headwear inside the frame and a clear white margin above; characters do not overlap each other's faces; nobody is cut in half by the side edges.`,
      usesAnchor &&
        `Image reference ${references.length} is another moment of this SAME shot (frame ${anchorNo}): match its camera distance, framing, every character's size, position and stance, lighting and line quality exactly; change only the acting described below. Do not copy its expressions or gestures.`,
      ...castIdentityEn(data, references, en),
      ...castLookEn(data, en, { appearance: true, outfit: true }),
      styleLine,
      refSheet,
      `Acting in this moment — every character at once (the listeners keep their mouths closed unless their line says otherwise):`,
      ...lines,
      hands && `Arms, hands and shoulders act together with each face; hands drawn clearly with natural anatomy (five fingers, no fused or extra fingers).`,
      s.instruction && `Additional direction: ${clean(s.instruction)}`,
      `Keep exactly the same camera, character positions and sizes, and white background as the other frames of this scene so they work as a matching set; only the faces, head directions${
        hands ? ", arms and hands" : ""
      } change.`,
      `No text, no labels, no name tags, no borders.`,
      fixes[e.id]?.trim() && `Corrections from the review of the previous version of this image (fix all of these; keep everything else): ${sentence(clean(fixes[e.id]).slice(0, 900))}`,
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
  if (isStoryboard(data)) return buildStoryboardFrame(data, expressionId, shot);
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
  const style = studioStyle(en.style ?? clean(data.style));
  const actorName = castName(data, beatActor(data, e).id);
  const prompt = [
    multi
      ? `One frame of a ${data.video.aspectRatio} ${vertical ? "vertical" : "horizontal"} video: ${data.cast.length} characters together, ${FRAMING_SCENE_EN[shot]}. Eye-level camera. Not a sheet, no panels or split screens, nobody else, no text.`
      : `One frame of a ${data.video.aspectRatio} ${vertical ? "vertical" : "horizontal"} video: ONE character, ${FRAMING_FRAME_EN[shot]}. Eye-level camera. Not a sheet, no panels, no other characters, no text.`,
    multi && `Blocking (screen positions): ${blockingEn(data)}.`,
    ...castIdentityEn(data, references, en),
    momentRef
      ? `Image reference ${momentRef} is the exact moment to draw: the same facial expressions, head directions, arms and hands${multi ? " of every character" : ""}. Only the camera framing changes to this shot size; never change the acting.`
      : `${multi ? `${actorName} acts this moment. ` : ""}Expression: ${INTENSITY_EN[e.intensity]} ${eb?.emotion ?? e.emotion}. ${eb ? sentence(eb.face) : ""} ${directionEn(e)}`,
    ...castLookEn(data, en, { appearance: false, outfit: false, max: multi ? 5 : 8 }),
    style && `Art style: ${style.replace(/[.。]+$/, "")}. Keep ${multi ? "every character" : "the character"} in this 3D & 2.5D animation style; never photorealistic.`,
    directorBackground(director) ? `Background as in this direction: ${clip(director, 400) || director.slice(0, 400)}` : "Plain white background.",
    multi
      ? `Composition: the characters in their screen positions; every head and any headwear inside the frame with a little headroom; fill the ${data.video.aspectRatio} frame at this shot size (no white bars or padding).`
      : `Composition: the character centered; the whole head and any headwear inside the frame with a little headroom; fill the ${data.video.aspectRatio} frame at this shot size (no white bars or padding).`,
  ]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join("\n");
  return { prompt, aspectRatio: data.video.aspectRatio, references };
}

export type VideoReference = {
  assetId: string;
  label: string;
  /** identity = who (scene picture or a character sheet), world = place/assets/style, expression = a beat's picture (a sketch in 콘티 방식) */
  role: "identity" | "expression" | "world";
  /** 콘티 방식: this beat picture is a rough sketch */
  sketch?: boolean;
  expressionId?: string;
  characterId?: string;
  /** a combined image: consecutive beats side by side, left to right (assetId is the combo id) */
  parts?: { assetId: string; expressionId: string }[];
};

/**
 * More beat images than the model takes: keep the most useful ones. First and last always; then the panel that
 * opens each shot (a cut needs its own picture; inside a shot the camera carries on) and panels with dialogue;
 * the rest spread evenly over the timeline.
 */
function pickReferences(data: ProjectData, ids: string[], max: number): Set<string> {
  const cuts = cutBefore(data);
  const spoken = new Set(data.dialogue.lines.filter((l) => l.line.trim()).map((l) => l.expressionId));
  const score = (id: string, k: number) => (k === 0 || k === ids.length - 1 ? 100 : 0) + (cuts.get(id) ? 10 : 0) + (spoken.has(id) ? 5 : 0);
  const ranked = ids
    .map((id, k) => ({ id, k, s: score(id, k) }))
    // equal scores: prefer panels far from those already kept (even spread) by position order of an even sample
    .sort((a, b) => b.s - a.s || Math.abs((a.k * (max - 1)) / (ids.length - 1) - Math.round((a.k * (max - 1)) / (ids.length - 1))) - Math.abs((b.k * (max - 1)) / (ids.length - 1) - Math.round((b.k * (max - 1)) / (ids.length - 1))) || a.k - b.k);
  return new Set(ranked.slice(0, max).map((r) => r.id));
}

/**
 * Fit consecutive beats into `max` images by joining neighbours (at most MAX_COMBO_PARTS per image).
 * Joins panels of the same shot first (one continuous camera move), keeps the first and last beats alone
 * when it can, and only then joins across a cut.
 */
export function groupBeats(ids: string[], max: number, cuts: Map<string, boolean>): string[][] {
  const groups = ids.map((id) => [id]);
  while (groups.length > max) {
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < groups.length - 1; i++) {
      const size = groups[i].length + groups[i + 1].length;
      if (size > MAX_COMBO_PARTS) continue;
      const edge = i === 0 || i + 1 === groups.length - 1 ? 3 : 0;
      const cost = size * 10 + (cuts.get(groups[i + 1][0]) ? 5 : 0) + edge;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    if (best < 0) break;
    groups.splice(best, 2, [...groups[best], ...groups[best + 1]]);
  }
  if (groups.length <= max) return groups;
  // pairs left that cannot join (more than twice the slots): even runs over the timeline
  const even: string[][] = [];
  for (let g = 0, at = 0; g < max; g++) {
    const size = Math.round(((g + 1) * ids.length) / max) - Math.round((g * ids.length) / max);
    even.push(ids.slice(at, at + size));
    at += size;
  }
  return even;
}

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
  /** for models with a negative-prompt field (the app's own requests do not carry it) */
  negativePrompt: string;
};

/**
 * Reference images for the video, in upload order:
 * the scene drawing (identity of the whole cast), then the beat images in timeline order.
 * Models accept a limited number of references: past the cap, consecutive beats share one image
 * (side by side, left to right), so every beat still has its picture; only past
 * MAX_COMBO_PARTS per image are the least useful beats left out.
 */
/**
 * 콘티 방식 references, in upload order: 1) each named character's design sheet, 2) the place — the scene
 * picture and the extra background/asset pictures, 3) the rough sketches in timeline order (joined side by side
 * past the cap). Sheets and places together keep at least three slots for the sketches.
 */
function contiReferences(data: ProjectData): VideoReference[] {
  const refs: VideoReference[] = [];
  const has = (id: string) => refs.some((r) => r.assetId === id);
  const sketchBeats: string[] = [];
  for (const seg of data.acting.segments) {
    const e = data.expressions.find((x) => x.id === seg.expressionId);
    if (e?.sketchAssetId && !sketchBeats.some((id) => data.expressions.find((x) => x.id === id)?.sketchAssetId === e.sketchAssetId)) sketchBeats.push(e.id);
  }
  // the rough sketches are line art: joined three to an image they stay a layout guide and do not outweigh
  // the coloured references (four separate sketches made a Seedance test come out as flat line art)
  const forSketches = Math.ceil(sketchBeats.length / MAX_COMBO_PARTS);
  const room = MAX_VIDEO_REFERENCES - forSketches;
  for (const c of data.cast)
    if (c.refAssetId && !has(c.refAssetId) && refs.length < room)
      refs.push({ assetId: c.refAssetId, label: `${castName(data, c.id)} 캐릭터 시트 — character design sheet`, role: "identity", characterId: c.id });
  if (!refs.length && data.baseAssetId) refs.push({ assetId: data.baseAssetId, label: "장면 기준 그림 — characters, world and style", role: "identity" });
  const places = [data.baseAssetId, ...data.designRefAssetIds].filter((x): x is string => Boolean(x) && !has(x!));
  for (const id of places) {
    if (refs.length >= room) break;
    refs.push({
      assetId: id,
      label: id === data.baseAssetId ? "장면 기준 그림 — world, light and art style" : "배경·에셋 참고 — place, props, architecture",
      role: "world",
    });
  }
  const max = Math.max(1, Math.min(MAX_VIDEO_REFERENCES - refs.length, forSketches));
  let beats = sketchBeats;
  if (beats.length > max * MAX_COMBO_PARTS) {
    const keep = pickReferences(data, beats, max * MAX_COMBO_PARTS);
    beats = beats.filter((id) => keep.has(id));
  }
  const groups = beats.length > max ? groupBeats(beats, max, cutBefore(data)) : beats.map((id) => [id]);
  const numOf = (id: string) => data.expressions.findIndex((e) => e.id === id) + 1;
  const sketchOf = (id: string) => data.expressions.find((e) => e.id === id)!.sketchAssetId!;
  for (const g of groups) {
    if (g.length === 1) {
      refs.push({ assetId: sketchOf(g[0]), label: `${numOf(g[0])}번 컷 러프 콘티 — storyboard sketch`, role: "expression", expressionId: g[0], sketch: true });
      continue;
    }
    const parts = g.map((id) => ({ assetId: sketchOf(id), expressionId: id }));
    refs.push({
      assetId: comboId(parts.map((p) => p.assetId)),
      label: `${g.map(numOf).join("·")}번 컷 러프 콘티 (나란히 ${g.length}장) — layout guide, left to right`,
      role: "expression",
      expressionId: g[0],
      parts,
      sketch: true,
    });
  }
  return refs;
}

export function videoReferences(data: ProjectData, maxExpressions = MAX_VIDEO_REFERENCES - 1): VideoReference[] {
  if (usesConti(data)) return contiReferences(data);
  const refs: VideoReference[] = [];
  const multi = isMultiCast(data);
  const story = isStoryboard(data);
  if (data.baseAssetId)
    refs.push({
      assetId: data.baseAssetId,
      label: story ? "장면 기준 그림 — scene reference" : multi ? "장면 기준 그림 — the whole cast together (identity)" : "캐릭터 기본 그림 — original character identity",
      role: "identity",
    });
  // one image per beat in timeline order (the same image used twice is attached once)
  const seen = new Set<string>();
  let beats: string[] = [];
  for (const seg of data.acting.segments) {
    const e = data.expressions.find((x) => x.id === seg.expressionId);
    if (!e?.imageAssetId || seen.has(e.imageAssetId)) continue;
    seen.add(e.imageAssetId);
    beats.push(e.id);
  }
  const max = Math.max(1, maxExpressions);
  if (beats.length > max * MAX_COMBO_PARTS) {
    const keep = pickReferences(data, beats, max * MAX_COMBO_PARTS);
    beats = beats.filter((id) => keep.has(id));
  }
  const groups = beats.length > max ? groupBeats(beats, max, cutBefore(data)) : beats.map((id) => [id]);
  const numOf = (id: string) => data.expressions.findIndex((e) => e.id === id) + 1;
  const imageOf = (id: string) => data.expressions.find((e) => e.id === id)!.imageAssetId!;
  for (const g of groups) {
    if (g.length === 1) {
      const e = data.expressions[numOf(g[0]) - 1];
      refs.push({
        assetId: e.imageAssetId!,
        label: story ? `${numOf(e.id)}번 컷 ${e.emotion || ""} — storyboard frame target` : `${numOf(e.id)}번 ${e.emotion || "표정"} — approved expression target`,
        role: "expression",
        expressionId: e.id,
      });
      continue;
    }
    const parts = g.map((id) => ({ assetId: imageOf(id), expressionId: id }));
    refs.push({
      assetId: comboId(parts.map((p) => p.assetId)),
      label: `${g.map(numOf).join("·")}번 ${story ? "컷" : "표정"} (나란히 ${g.length}장) — consecutive ${story ? "storyboard frames" : "expression targets"}, left to right`,
      role: "expression",
      expressionId: g[0],
      parts,
    });
  }
  if (!seen.size && data.expressionSetup.sheetAssetId)
    refs.push({ assetId: data.expressionSetup.sheetAssetId, label: "표정 시트 (이전 방식) — expression targets, panels left to right", role: "expression" });
  return refs;
}

const POSITION = [["left", "right"], ["left", "middle", "right"]];

/** "reference image 3" or "reference image 3 (left frame)" for a beat; null when the beat has no image attached. */
export function referenceTarget(refs: VideoReference[], expressionId: string): string | null {
  for (const [k, r] of refs.entries()) {
    if (r.parts) {
      const at = r.parts.findIndex((p) => p.expressionId === expressionId);
      if (at >= 0) return `reference image ${k + 1} (${POSITION[r.parts.length - 2]?.[at] ?? `frame ${at + 1}`} frame)`;
    } else if (r.role === "expression" && r.expressionId === expressionId) return `reference image ${k + 1}`;
  }
  return null;
}

/** Beats whose image is attached (alone or inside a combined image). */
export const shownBeats = (refs: VideoReference[]) =>
  new Set(refs.flatMap((r) => (r.parts ? r.parts.map((p) => p.expressionId) : r.role === "expression" && r.expressionId ? [r.expressionId] : [])));

/** A beat's priority animation principles for the video model (the movement each asks for, or just the names). */
export function principleLine(e: Pick<Expression, "principles"> | undefined, level: 0 | 1 | 2): string {
  const list = (e?.principles ?? []).map(principleOf).filter((p): p is NonNullable<ReturnType<typeof principleOf>> => Boolean(p)).slice(0, MAX_PRINCIPLES);
  if (!list.length || !level) return "";
  const name = (k: string) => k.replace(/_/g, " ").replace("follow through", "follow-through").replace("slow in out", "slow in and out");
  return level === 2 ? `Motion: ${list.map((p) => p.en).join("; ")}.` : `Motion priorities: ${list.map((p) => name(p.key)).join(", ")}.`;
}

/** Text length caps for each beat field in the video prompt (Infinity = full text, for the team's summary). */
type Limits = { face: number; gesture: number; note: number; transition: number; delivery: number };
const FULL: Limits = { face: Infinity, gesture: Infinity, note: Infinity, transition: Infinity, delivery: Infinity };
/**
 * Header caps too; tried in order until the prompt fits its target (the last one is used regardless).
 * English beats (영어 정리) are short already: they only drop the pose line, then the body line;
 * the transition always stays.
 */
/** principles: 2 = the movement each priority principle asks for, 1 = names only, 0 = left out */
type Budget = Limits & { style: number; voice: number; features: number; enPose: boolean; enBody: boolean; principles: 0 | 1 | 2 };
const BUDGETS: Budget[] = [
  { face: 60, gesture: 110, note: 60, transition: 100, delivery: 100, style: 160, voice: 160, features: 6, enPose: true, enBody: true, principles: 2 },
  { face: 30, gesture: 80, note: 0, transition: 80, delivery: 70, style: 140, voice: 140, features: 6, enPose: true, enBody: true, principles: 1 },
  // the expression images show the face, then the gesture: drop that text first and keep the
  // transition (how one expression moves into the next — what keeps it from morphing)
  { face: 0, gesture: 60, note: 0, transition: 70, delivery: 50, style: 80, voice: 80, features: 4, enPose: false, enBody: true, principles: 1 },
  { face: 0, gesture: 0, note: 0, transition: 60, delivery: 40, style: 50, voice: 50, features: 3, enPose: false, enBody: false, principles: 0 },
];
/** Room the studio block takes beyond its earlier ~700 characters (added to the length target). */
const constraintsExtra = (constraints: string) => Math.max(0, constraints.length - 700) + 150;

/** Video models follow prompts up to roughly this length well (constraints included); longer ones get diluted. */
export const VIDEO_PROMPT_TARGET = 3500;
/** With 영어 정리 the beats carry real acting in short English, worth a little more room. */
export const VIDEO_PROMPT_TARGET_EN = 5000;
/** Extra room for each character after the first (cast line, voice, their acting in every beat). */
export const VIDEO_PROMPT_EXTRA_PER_CHARACTER = 900;

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
  // a stray closer ("1) …", "2) …" list numbers) is not a bracket that was opened
  const closed = (s: string) => {
    let depth = 0;
    for (const ch of s) {
      if ("(（[".includes(ch)) depth++;
      else if (")）]".includes(ch) && depth > 0) depth--;
    }
    return depth === 0;
  };
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
function actingKo(e: Omit<Performance, "characterId"> & { notes?: string }, framing: Framing, L: Limits = FULL): string {
  const d = e.direction;
  const face = (t: string) => (L.face ? noEndDot(clip(L.face === Infinity ? t : firstSentence(t), L.face)) : "");
  const gesture = showsHands(framing) && L.gesture ? noEndDot(clip(e.gesture, L.gesture)) : "";
  const note = L.note ? noEndDot(clip(e.notes ?? "", L.note)) : "";
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
  if (isStoryboard(data)) return buildStoryboardVideo(data, source, opts);
  const endFrame = source === "start_frame" && (opts.endFrame ?? Boolean(data.video.endFrameAssetId));
  const multi = isMultiCast(data);
  const nameOf = (expressionId: string) => {
    const e = data.expressions.find((x) => x.id === expressionId);
    return e ? castName(data, beatActor(data, e).id) : "";
  };
  const byId = new Map(data.expressions.map((e, i) => [e.id, { e, i }]));
  const lineFor = (id: string) => data.dialogue.lines.find((l) => l.expressionId === id);
  const refs = source === "references" ? videoReferences(data) : [];
  const refNo = (expressionId: string) => referenceTarget(refs, expressionId);
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
  // group scenes: every other character's acting per beat (English where fresh), reconciled once
  const reactionsOf = new Map(
    multi
      ? data.expressions.map((e, i) => {
          const b = en.beats.get(e.id);
          return [
            e.id,
            performancesOf(data, e)
              .filter((p) => !p.lead)
              .map((p) => {
                const who = `${i + 1}번 표정 ${castLabel(data, p.characterId)}`;
                const o = b?.others.find((x) => x.characterId === p.characterId);
                return {
                  p,
                  en: o
                    ? {
                        emotion: o.emotion,
                        face: reconcile(o.face, "face", `${who} 얼굴 연기 (영어)`, adjustments),
                        body: hands ? reconcile(o.body, "motion", `${who} 팔·손 동작 (영어)`, adjustments) : "",
                      }
                    : null,
                  ko: {
                    ...p,
                    brows: reconcile(p.brows, "face", `${who} 눈썹`, adjustments),
                    eyes: reconcile(p.eyes, "face", `${who} 눈`, adjustments),
                    mouth: reconcile(p.mouth, "face", `${who} 입`, adjustments),
                    gesture: hands ? reconcile(p.gesture, "motion", `${who} 팔·손 동작`, adjustments) : p.gesture,
                  },
                };
              }),
          ] as const;
        })
      : [],
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
  const director = dropConstraintRepeats(reconcile(data.video.extraDirection, "direction", "추가 연출", adjustments), "추가 연출", adjustments);

  // ── What the director's direction decides (it wins over the app's general lines) ──
  const rig = directorRig(director);
  const angle = directorAngle(director);
  const background = directorBackground(director);
  // a real-world background asked for in an animated character shot: the animation rule then holds for the character only
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
    realBackground && "그림체: 인물은 3D & 2.5D 애니메이션 그대로, 배경만 추가 연출의 실사 스타일을 따름 (앱의 ‘never photorealistic’은 인물에만 적용)",
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
      const target = n ? `${multi ? "Frame" : "Expression"} target: ${n}.` : "";
      const eb = fixed ? enBeats.get(seg.expressionId) : undefined;
      const who = multi ? nameOf(seg.expressionId) : "";
      // the other characters at the same moment: English where fresh, else the team's Korean (`fixed` = for the model)
      const reactionLines = (L2: Budget | Limits) =>
        (reactionsOf.get(seg.expressionId) ?? []).map(({ p, en: o, ko }) => {
          const name = castName(data, p.characterId);
          const B = "enPose" in L2 ? L2 : BUDGETS[0];
          if (fixed && o)
            return `${name} (${INTENSITY_EN[p.intensity]} ${o.emotion}): ${[o.face && sentence(o.face), B.enBody && o.body && sentence(o.body), B.enPose && poseShort(p)]
              .filter(Boolean)
              .join(" ")}`;
          const src = fixed ? ko : p;
          return `${name} (${p.emotion || "듣는 반응"}): ${actingKo(src, framing, L2)}`;
        });
      const vo = l ? isVoiceOver(l) : false;
      const says = (text: string) =>
        vo
          ? `${multi ? who : "The character"} is heard in voice-over (${lang}; heard over the picture, lips closed): "${text}"`
          : multi
            ? `${who} says exactly (${lang}): "${text}"`
            : `Say exactly (${lang}): "${text}"`;
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
          principleLine(original, "principles" in L ? L.principles : 2),
          ...reactionLines(L),
          l?.line ? `${says(l.line)}${eb.delivery ? ` — ${eb.delivery}` : ""}` : "Silent beat.",
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
      return [
        `${time}: ${who ? `${who} — ` : ""}${e?.emotion || "expression"}`,
        target,
        `${who ? `${who} acts` : "Acting"}: ${acting}${move ? ` 다음 표정으로: ${move}.` : ""}`,
        principleLine(original, "principles" in L ? L.principles : 2),
        ...reactionLines(L),
        l?.line ? `${says(l.line)}${how ? ` — ${how}` : ""}` : "Silent beat.",
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
        ? "Camera move: none — the framing stays on the group for the whole shot with only the faint sway of a hand-held camera; every character stays at the same distance, size and position in the frame, and gestures toward the viewer stay within the frame."
        : "Camera move: none — the framing stays on the character for the whole shot with only the faint sway of a hand-held camera; the character stays at the same distance, size and position in the frame, and gestures toward the viewer stay within the frame.";
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
  const styleText = studioStyle(en.style ?? data.style);
  const headerWith = (B: Budget) =>
    [
      `ONE single continuous shot with no cuts: a ${data.acting.duration}-second ${multi ? `${data.cast.length}-character scene` : "character acting shot"}, ${data.video.aspectRatio}. Every beat below is a moment of this same shot; never cut away or change the shot.`,
      multi && `Cast (exactly these ${data.cast.length} characters, always in these screen positions; nobody else): ${blockingEn(data)}.`,
      lookFor(B).length && `Keep visible${multi ? " — " : ": "}${lookFor(B).join(multi ? " | " : "; ")}.`,
      styleText.trim() &&
        `Art style: ${((s) => (s ? `${sentence(s)} ` : ""))(en.style ? clip(studioStyle(en.style), Math.max(B.style, 160)) : clip(studioStyle(data.style), B.style))}${
          realBackground
            ? "Keep the character in this 3D & 2.5D animation style (never photorealistic); only the background follows the DIRECTOR'S DIRECTION."
            : "Stay in this 3D & 2.5D animation style; never photorealistic."
        }${keepPainted(styleText)}`,
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
        `Dialogue: only the character named for a line speaks it, with their own voice and lip movement; while one character speaks the others keep their mouths closed and listen (reacting with eyes, brows, breath and small head moves). Lines never overlap unless a beat says so.${
          data.dialogue.lines.some((l) => l.line.trim() && isVoiceOver(l)) ? " Lines marked voice-over are heard over the picture; nobody lip-syncs them." : ""
        } A character a beat describes as silently mouthing words moves their lips without sound.`,
      hands &&
        `Arms and hands act together with the face, stepping through in-between poses from one expression reference's gesture to the next (never jumping straight to the next pose); hands always correctly drawn.`,
      refs.length
        ? [
            `Reference images (upload in this order):`,
            ...refs.map((r, i) => {
              if (r.role === "identity")
                return multi
                  ? `${i + 1}. scene reference drawing of the whole cast — ${data.cast.map((c) => spotEn(data, c, en)).join("; ")}; use it for identity and relative sizes only`
                  : `${i + 1}. character design — may show several views of the same character; use it for identity only`;
              if (r.parts)
                return `${i + 1}. ${multi ? "frames" : "expressions"} ${r.parts.map((p) => numberOf(p.expressionId)).join(", ")} side by side, left to right — consecutive ${multi ? "approved scene frames" : "approved expression targets"}`;
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
          ? `Frame references are successive moments of this same shot of the whole cast.${refs.some((r) => r.parts) ? " A reference with frames side by side holds consecutive moments, played one after another in full frame." : ""} Do not render a grid or split screen; never duplicate a character.`
          : refs.length > 1 && `Expression references are successive moments of this same shot for the same character.${refs.some((r) => r.parts) ? " A reference with frames side by side holds consecutive moments, played one after another in full frame." : ""} Do not render a grid, split screen or multiple faces.`),
      voices.length &&
        (multi
          ? `Voices (each character keeps their own voice): ${voices
              .map((v) => `${castName(data, v.id)} — ${noEndDot(clip(v.text, v.fresh ? Math.max(B.voice, 160) : B.voice) || clean(v.text).slice(0, 60))}`)
              .join("; ")}. Speak only the exact dialogue below; never read direction text aloud.`
          : `Voice: ${((s) => (s ? `${sentence(s)} ` : ""))(clip(voices[0].text, voices[0].fresh ? Math.max(B.voice, 160) : B.voice))}Speak only the exact dialogue below; never read direction text aloud.`),
      lang === "Old English" && OLD_ENGLISH_HINT,
      arcLine(en.arc),
      ACTING_EN,
      `Stay alive between and during the lines (breathing, blinks, small head and shoulder accents). Each expression change is acted, not morphed: it rides on a physical action (a blink, a breath, a small head turn or a hand passing the face) and steps through in-between poses.`,
    ]
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n");

  // Order: general lines → beats → the director's own words (never trimmed) → studio constraints (always last).
  const directorBlock = director
    ? `DIRECTOR'S DIRECTION (the director's own words: follow exactly; where it differs from the general camera, framing or background lines above, this wins):\n${director}`
    : "";
  const constraints = constraintsFor(rig, data.video.weight, data.video.cadence);
  const assemble = (B: Budget) => [headerWith(B), beatsWith(B).join("\n\n"), directorBlock, constraints].filter(Boolean).join("\n\n");
  // a group scene needs room for the cast, the voices and every character's acting per beat
  // the studio block grew (weight, camera, sound): its extra length is not taken from the beats
  const lengthTarget =
    (enBeats.size ? VIDEO_PROMPT_TARGET_EN : VIDEO_PROMPT_TARGET) + (multi ? VIDEO_PROMPT_EXTRA_PER_CHARACTER * (data.cast.length - 1) : 0) + constraintsExtra(constraints) + keepPainted(styleText).length +
    ACTING_EN.length + arcLine(en.arc).length;
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
    negativePrompt: negativePrompt(data.video.weight, data.video.cadence),
  };
}

/* ───────────── Storyboard mode (스토리보드 · 컷 단위) ───────────── */

/**
 * In a panel's camera field the camera is the subject, so a motion verb is a camera move ("칼리엘라 쪽으로
 * 다가감", "slow push-in"); a framing alone ("locked close-up", "고정 샷") is not.
 */
export function cameraTextMoves(t: string): boolean {
  return (
    hasCameraMove([t]) ||
    /다가|물러|따라(?:가|붙|간|감)|틸트|패닝|선회|돌아(?:가|감|들)|올라가|내려가|내려와|이동|트래킹|트랙|줌|당겨|밀고\s*들|빠진다|빠지며|\b(?:push(?:es)?[- ]?in|pull(?:s)?[- ]?(?:back|out)|dolly|tracking|tilt(?:s|ing)?\s+(?:up|down)|pans?\s+(?:left|right|across|to)|zoom(?:s|ing)?\s+(?:in|out)|crane|orbit(?:s|ing)?)\b|\bcamera\s+(?:slowly\s+)?(?:moves?|follows?|rises|descends|circles|drifts?|travels?|tracks?)\b/i.test(t)
  );
}
/*
 * Each beat is a storyboard panel: one finished picture of the whole moment, described as a whole
 * (action, camera, an optional rough sketch). Named characters are kept by identity, not by fixed
 * screen positions — they may move between panels — and the crowd is described once for the scene.
 * The panels are still moments of ONE continuous shot: the camera travels between them, never cuts.
 */

/** Named characters by name and their key features (no fixed positions), then the crowd. */
function storyboardCastEn(data: ProjectData, en: ReturnType<typeof freshEnglish>, wanted = 4, outfitMax = 320): string[] {
  // a big named cast keeps each line short: the two most telling features per character
  const features = data.cast.length > 4 ? Math.min(wanted, 2) : wanted;
  const named = data.cast
    .map((c) => {
      const look = en.cast.get(c.id)?.look ?? shortLocks(c.locks, features);
      return `${castName(data, c.id)}${look.length ? ` — ${look.slice(0, features).join(", ")}` : ""}`;
    })
    .join("; ");
  // what each one wears in THIS scene (disguises, time-of-day changes): look features alone can cut it off
  const costumes = data.cast
    .map((c) => {
      const o = en.cast.get(c.id)?.outfit ?? clean(c.outfit);
      const t = clip(o, outfitMax) || o.slice(0, outfitMax);
      return t ? `${castName(data, c.id)}: ${noEndDot(t)}` : "";
    })
    .filter(Boolean)
    .join(". ");
  return [
    named && `Named characters (each keeps their identity exactly as in the scene reference; never mix features between them): ${named}.`,
    costumes &&
      `Costumes in this scene (follow them, including disguises and changes between parts of the scene; pick the one this panel's moment and continuity call for): ${costumes}.`,
    data.extras.trim() &&
      `Crowd and background people (unnamed): ${noEndDot(clean(data.extras))}. Keep them consistent across panels and never let them cover the named characters' faces.`,
  ].filter((x): x is string => Boolean(x));
}

/** The panel's acting: English where fresh (face = the action, body = the camera), else the team's words. */
function panelTexts(data: ProjectData, e: Expression, en: ReturnType<typeof freshEnglish>) {
  const b = en.beats.get(e.id);
  return {
    title: b?.emotion || e.emotion,
    action: b?.face || clean(e.action),
    camera: b?.body || clean(e.camera),
    // 연결 상태: screen positions, facing, movement, costume/prop state, light (English where fresh)
    state: (b ? b.state : "") || clean(e.continuity),
    transition: b?.transition,
    delivery: b?.delivery,
  };
}

/** The "끝 / End" part of a hook-up state ("시작: … / 끝: …"), or the whole text when it has no such parts. */
export function endState(state: string): string {
  const m = state.split(/(?:끝|End|end)\s*[:：]/);
  return clean(m.length > 1 ? m[m.length - 1] : state);
}

/** The studio works in 3D & 2.5D: a style text that says "2D" (an older AI guess, or typed by hand) is read that way. */
/** A painted style (brushwork, lines, cel shading) on 3D forms: video models tend to render it as glossy CG instead. */
const PAINTED = /painterly|watercolou?r|gouache|brush|\bink\b|cel[- ]?shad|outline|line art|\blines?\b|hand[- ]painted|회화|수채|과슈|붓|선화|셀/i;
export const keepPainted = (style: string) =>
  PAINTED.test(style)
    ? " Every frame keeps the hand-painted surface — visible brushwork, the drawn outlines and the flat cel-shading steps — on the 3D forms, like a painted feature film rather than a glossy CG render with plastic skin."
    : "";
/**
 * The acting doctrine from the team's Seedance 2.5 tests (SH04_3 SHOT 1, Nov 2026): emotion is the protagonist,
 * every change has a trigger, eyes lead the head and the body, the peak is a moving hold, the face never goes
 * dead. Written once per prompt; the beats do not repeat it.
 */
export const ACTING_EN =
  "FACE AND BODY: feature-film character acting, broad enough to read at a glance and grounded. Natural blinking; forehead and brows always active and matched to each state, no mask-face, no dead eyes. Eyes stay a natural, moderate size. ORDER RULE: in every change the eyes move first, then the head, then the body, one after another. Eyelines are held steady, never darting. At the emotional peak, a moving hold: the pose stops and only the breath, shoulders, eyes and tears move.";

/** The scene's emotional arc as the prompt's main subject (empty when the English arc is missing or stale). */
export const arcLine = (arc: string | null) =>
  arc ? `THE EMOTIONAL ARC: THIS IS THE WHOLE POINT. A live, changing performance, and every change has a trigger: ${noEndDot(arc)}. Play the transitions.` : "";

/** The "시작 / Start" part of a hook-up state ("시작: … / 끝: …"), or "" when it has no such part. */
export function startState(state: string): string {
  const m = state.match(/(?:시작|Start|start)\s*[:：]\s*([\s\S]*?)(?:\s*[/|]\s*)?(?:(?:끝|End|end)\s*[:：]|$)/);
  return m ? clean(m[1]) : "";
}

export function studioStyle(style: string): string {
  return style.replace(/(^|[^\d.])2D(?!\w)/g, "$13D & 2.5D").replace(/(^|[^\w.])2[- ]?D animation/gi, "$13D & 2.5D animation");
}

/** The scene's continuity rules (연결 규칙), English where fresh. */
/**
 * With the studio's HANDHELD camera, a panel camera written as "locked" (or 고정) would contradict it (and the
 * negative prompt's "locked-off shot"): it becomes a camera held steady by hand, which is what was meant.
 */
export const heldSteady = (t: string) =>
  t
    .replace(/\b(?:locked(?:[- ]off)?|static)\s+shot\b/gi, "steady handheld shot")
    .replace(/\blocked[- ]off\b|\blocked\b|\bstatic\b(?=\s+(?:shot|camera|frame|framing))|\bstatic\b(?=,|\.|$)/gi, "held steady by hand")
    .replace(/(?<!핸드헬드로 거의 )고정/g, "핸드헬드로 거의 고정");
const continuityRules = (data: ProjectData, en: ReturnType<typeof freshEnglish>) => en.continuity ?? clean(data.expressionSetup.continuity);

function storyboardRefs(data: ProjectData): ReferenceSlot[] {
  const refs: ReferenceSlot[] = [];
  if (data.baseAssetId) refs.push({ role: "image reference 1", assetId: data.baseAssetId, why: "장면 기준 그림 — 주요 인물·그림체·세계" });
  for (const r of castMaterialRefs(data, refs.length)) refs.push({ ...r, role: `image reference ${refs.length + 1}` });
  for (const id of extraRefsFitting(data, refs, 2))
    refs.push({ role: `image reference ${refs.length + 1}`, assetId: id, why: "추가 참고 그림" });
  return refs;
}

function buildStoryboardHandoffs(data: ProjectData, fixes: Record<string, string> = {}): ExpressionHandoff[] {
  const aspect = data.video.aspectRatio;
  const en = freshEnglish(data);
  const style = studioStyle(en.style ?? clean(data.style));
  const anchor = continuityAnchor(data);
  const n = data.expressions.length;
  const shots = shotsOf(data);
  const cuts = cutBefore(data);
  const multiShot = shots.length > 1;
  return data.expressions.map((e, i) => {
    const t = panelTexts(data, e, en);
    const shotNo = shots.findIndex((sh) => sh.includes(e.id)) + 1;
    const references = storyboardRefs(data);
    const sketchNo = e.sketchAssetId ? references.length + 1 : 0;
    if (e.sketchAssetId) references.push({ role: `image reference ${sketchNo}`, assetId: e.sketchAssetId, why: `${i + 1}번 컷 러프 스케치 — 구도·자세·카메라만` });
    // the panel just before this one in the timeline (when drawn): costumes, props, positions and light carry on from it
    const order = data.acting.segments.map((sg) => sg.expressionId);
    const prevId = order[order.indexOf(e.id) - 1];
    const prev = prevId ? data.expressions.find((x) => x.id === prevId) : undefined;
    const prevNo = prev ? data.expressions.indexOf(prev) + 1 : 0;
    // an earlier drawn panel of the SAME shot (its world and light still hold); a panel from another shot
    // (another place or time of day) would drag its states in, so it is only used for designs when nothing else is drawn
    const shot = shots.find((sh) => sh.includes(e.id)) ?? [];
    const before = shot.slice(0, shot.indexOf(e.id)).map((id) => data.expressions.find((x) => x.id === id));
    const shotAnchor = before.find((x) => x?.imageAssetId && x.id !== prev?.id);
    const usesPrev = Boolean(prev?.imageAssetId);
    const idAnchor = !shotAnchor && !usesPrev && anchor?.imageAssetId && anchor.id !== e.id ? anchor : undefined;
    const anchorPanel = shotAnchor ?? idAnchor;
    const anchorNoHere = anchorPanel ? data.expressions.indexOf(anchorPanel) + 1 : 0;
    const usesAnchor = Boolean(anchorPanel);
    if (anchorPanel)
      references.push({
        role: `image reference ${references.length + 1}`,
        assetId: anchorPanel.imageAssetId!,
        why: shotAnchor ? `연결 기준: ${anchorNoHere}번 컷 그림 (같은 쇼트의 앞 순간)` : `연결 기준: ${anchorNoHere}번 컷 그림 (다른 쇼트 — 인물 디자인·그림체만)`,
      });
    if (usesPrev) references.push({ role: `image reference ${references.length + 1}`, assetId: prev!.imageAssetId!, why: `바로 앞: ${prevNo}번 컷 그림 (연결성)` });
    const prevRef = usesPrev ? references.length : 0;
    // the hook-up in words: where the previous panel left everyone (this panel starts from it)
    const prevEnd = prev ? endState(panelTexts(data, prev, en).state) : "";
    const fix = clean(fixes[e.id] ?? "");
    const rules = continuityRules(data, en);
    const line = data.dialogue.lines.find((l) => l.expressionId === e.id)?.line.trim();
    const prompt = [
      `One finished ${aspect} frame of the animation (moment ${i + 1} of ${n} in this scene): ONE single image of ONE moment that fills the whole frame — never a storyboard sheet, a grid, a contact sheet, a comic page or a sequence of small frames; exactly one camera view. Not a rough sketch; no borders, no text, no speech bubbles.`,
      `The description below may list several steps of an action (look → prepare → act → contact → settle) and a camera move from a start to an end framing: draw only the single moment the action arrives at (its end pose), in one framing — do not draw each step or each framing as a separate picture, and do not draw anything that happens after the description ends.`,
      // the framing first: reference pictures pull toward their own composition (the scene picture is often this same moment)
      t.camera && `FRAMING OF THIS PANEL (follow it over every reference picture): ${sentence(t.camera)}`,
      multiShot
        ? `All panels belong to ONE scene of ${shots.length} shots: the same world, lighting, characters and art style. This panel is in shot ${shotNo}${
            cuts.get(e.id) ? " and opens it with a hard cut — its own camera position and framing" : ""
          }.`
        : `All panels are successive moments of ONE continuous shot: the same world, lighting, characters and art style; only the moment and the camera framing change.`,
      data.baseAssetId &&
        `Image reference 1 is the scene reference drawing: use it for the look of the named characters, their relative sizes, the art style, the colors and the world of this scene — NOT for its composition, camera angle, framing or poses. This panel must not be a copy of that picture: frame it as described for this panel.`,
      ...storyboardCastEn(data, en),
      ...extraRefsEn(data, references),
      style && `Art style: ${style.replace(/[.。]+$/, "")}. Keep this 3D & 2.5D animation style for everyone in the frame; never photorealistic.`,
      usesAnchor &&
        (shotAnchor
          ? `Image reference ${references.findIndex((r) => r.why.startsWith("연결 기준")) + 1} is panel ${anchorNoHere}, earlier in this same shot: keep its world, lighting, line quality and character designs; follow this panel's own composition, camera and the states below.`
          : `Image reference ${references.findIndex((r) => r.why.startsWith("연결 기준")) + 1} is panel ${anchorNoHere} from another part of this scene: use it ONLY for the characters' designs and the drawing style — not its place, light, time of day, composition, costume state or props.`),
      prevRef &&
        `Image reference ${prevRef} is the panel just before this one (panel ${prevNo}). Continue from it: the same costumes and props, everyone on the same side of the screen and facing the same way (180° rule), positions carried on, the same light direction — except what this moment changes (a hood taken off, hands let go, a prop handed over, further along the path), which follows the continuity below, not that picture${
          cuts.get(e.id)
            ? ". This panel opens a new shot after a hard cut: a NEW camera position and framing — do not repeat that picture's composition, framing or background view"
            : ". This panel is in the same shot: the camera has moved on to this panel's own framing, so the picture must look clearly different from that one (closer, wider or from another angle as described) — not the same composition again"
        }.`,
      prevEnd && `The previous panel (panel ${prevNo}) ended like this — start this moment from it: ${sentence(prevEnd)}`,
      fix && `Corrections from the review of the previous version of this panel (fix all of these; keep everything else): ${sentence(fix.slice(0, 900))}`,
      (usesAnchor || usesPrev) &&
        "When a reference picture disagrees with this moment's description or continuity (an earlier costume or prop state, another place or time of day), the description and continuity win; faces, hair and body always come from the design sheets, and what each character wears follows this scene's costume and this panel's continuity.",
      rules && `Continuity rules of this scene (every panel keeps them): ${clip(rules, 600) || rules.slice(0, 600)}`,
      t.state && `Continuity (the states this moment sits between — positions, props and light to keep; still one single frame): ${sentence(t.state)}`,
      sketchNo &&
        `Image reference ${sketchNo} is a rough storyboard sketch of this panel: follow its composition, character placement, poses and camera angle; do NOT copy its rough lines or missing details — render it fully in the art style above.`,
      t.action ? `This moment: ${sentence(t.action)}` : sketchNo ? "This moment: exactly as in the sketch." : "",
      t.camera && `Camera (again, this panel's own framing): ${sentence(t.camera)}`,
      line && `${castName(data, beatActor(data, e).id)} is speaking in this moment (mouth open mid-word); everyone else keeps their mouth closed.`,
      data.expressionSetup.instruction && `Additional direction: ${clean(data.expressionSetup.instruction)}`,
      `Background: the world of the scene as in the references and the description (not an empty white background) unless the description says otherwise.`,
      `Staging: the faces, the hands and what they act on are clearly readable and not hidden behind bodies or props; hands drawn clearly with natural anatomy.`,
    ]
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n");
    return { expressionId: e.id, index: i, emotion: t.title || `컷 ${i + 1}`, aspectRatio: aspect, references, prompt };
  });
}

/**
 * 러프 콘티: a quick rough storyboard sketch per panel — simple black lines on white, no colour or shading —
 * drawn from the panel's moment and camera. The scene picture only tells who is who and where things stand.
 * The team can redo any panel or replace it with their own drawing; the finished panel art then follows it.
 */
export function buildSketchHandoffs(data: ProjectData): ExpressionHandoff[] {
  const aspect = data.video.aspectRatio;
  const en = freshEnglish(data);
  const who = data.cast
    .filter((c) => c.name.trim())
    .map((c) => {
      const look = en.cast.get(c.id)?.look?.[0] ?? clean(c.locks).split(/[.\n]/)[0];
      return look ? `${castName(data, c.id)} (${clip(look, 70) || look.slice(0, 70)})` : castName(data, c.id);
    })
    .join("; ");
  return data.expressions.map((e, i) => {
    const t = panelTexts(data, e, en);
    const references: ReferenceSlot[] = data.baseAssetId
      ? [{ role: "image reference 1", assetId: data.baseAssetId, why: "장면 기준 그림 — 누가 누구인지·배경 배치만 (색·그림체는 따르지 않음)" }]
      : [];
    const prompt = [
      `A rough sketch of one ${aspect} film frame: ONE single image of ONE moment that fills the whole frame — never a storyboard sheet, a grid, a contact sheet, a comic page or a sequence of small frames; exactly one camera view. Quick loose black pencil lines on a plain white background. Simple lines only — no colour, no shading, no grey fills, no texture, no rendering; simple gesture figures with readable poses, faces only as simple shapes and eye lines, like a director's thumbnail. No borders, no text, no arrows, no numbers.`,
      `The description below may list several steps of an action (look → prepare → act → contact → settle) and a camera move from a start to an end framing: draw only the single key moment of the main action, in one framing — do not draw each step or each framing as a separate picture.`,
      data.baseAssetId &&
        "Image reference 1 is the finished scene picture: use it ONLY to know who is who (silhouettes, hair shapes, sizes) and how the set is laid out. Do NOT copy its colours, shading, detail or art style — this must stay a rough line sketch.",
      who && `Characters who may appear: ${who}. Draw only those this moment needs.`,
      t.action ? `This moment: ${sentence(t.action)}` : "",
      endState(t.state) &&
        `The pose to draw (where this moment ends — hands, body position and props exactly like this, e.g. an open hand stays open, a fist stays a fist, kneeling stays kneeling): ${sentence(endState(t.state))}`,
      t.camera && `Camera: ${sentence(t.camera)} Draw one framing only (the framing at the key moment): where the camera stands and how big the figures are.`,
      `Keep the composition clear: main figures large enough to read, background as a few simple lines (horizon, walls, door, big props). Again: one single frame, not several panels.`,
    ]
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n");
    return { expressionId: e.id, index: i, emotion: t.title || `컷 ${i + 1}`, aspectRatio: aspect, references, prompt };
  });
}

function buildStoryboardFrame(data: ProjectData, expressionId: string, shot: Framing): FrameHandoff {
  const e = data.expressions.find((x) => x.id === expressionId);
  if (!e) throw new Error("컷을 찾을 수 없습니다.");
  const en = freshEnglish(data);
  const t = panelTexts(data, e, en);
  const references = storyboardRefs(data);
  const momentRef = e.imageAssetId ? references.length + 1 : 0;
  if (e.imageAssetId) references.push({ role: `image reference ${momentRef}`, assetId: e.imageAssetId, why: "이 컷의 순간" });
  const style = studioStyle(en.style ?? clean(data.style));
  const prompt = [
    `One frame of a ${data.video.aspectRatio} ${data.video.aspectRatio === "9:16" ? "vertical" : "horizontal"} video, ${FRAMING_FRAME_EN[shot].split(":")[0]} framing of the moment below. No panels, no text.`,
    data.baseAssetId && `Image reference 1 is the scene reference drawing (named characters, style, world).`,
    ...storyboardCastEn(data, en, 3),
    momentRef
      ? `Image reference ${momentRef} is the exact moment to draw: the same poses and acting of everyone in it; only the camera framing changes to this shot size.`
      : t.action && `This moment: ${sentence(t.action)}`,
    style && `Art style: ${style.replace(/[.。]+$/, "")}. 3D & 2.5D animation; never photorealistic.`,
    `Fill the ${data.video.aspectRatio} frame (no white bars or padding).`,
  ]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join("\n");
  return { prompt, aspectRatio: data.video.aspectRatio, references };
}

/** Caps per panel field, tried in order until the prompt fits (the last is used regardless). */
const STORY_BUDGETS = [
  { action: Infinity, camera: Infinity, state: Infinity, rules: 600, transition: 140, delivery: 100, features: 4, principles: 2 as const },
  { action: 400, camera: 200, state: 200, rules: 450, transition: 100, delivery: 80, features: 4, principles: 2 as const },
  { action: 250, camera: 140, state: 140, rules: 300, transition: 70, delivery: 50, features: 3, principles: 1 as const },
  { action: 150, camera: 80, state: 90, rules: 200, transition: 0, delivery: 40, features: 2, principles: 0 as const },
];

function buildStoryboardVideo(data: ProjectData, source: "start_frame" | "references", opts: { endFrame?: boolean }): VideoHandoff {
  const endFrame = source === "start_frame" && (opts.endFrame ?? Boolean(data.video.endFrameAssetId));
  const refs = source === "references" ? videoReferences(data) : [];
  const refNo = (id: string) => referenceTarget(refs, id);
  // 콘티 방식: character sheets + places + rough sketches (the sketches give composition only)
  const conti = refs.some((r) => r.sketch);
  const en = freshEnglish(data);
  const lang = en.language ?? languageEn(data.dialogue.language || "");
  const adjustments: Adjustment[] = [];
  const fixOf = (target: "transition" | "delivery" | "voice", id: string | null, text: string) => effectiveText(data, target, id, text);
  const panelNo = (id: string) => data.expressions.findIndex((e) => e.id === id) + 1;
  // 컷 분할: where the team cut the panels into separate shots
  const shots = shotsOf(data);
  const cuts = cutBefore(data);
  const multiShot = shots.length > 1;
  const allowCuts = { allowCuts: multiShot };
  const rangeOf = (ids: string[]) => {
    const a = panelNo(ids[0]);
    const b = panelNo(ids[ids.length - 1]);
    return a === b ? `panel ${a}` : `panels ${a}–${b}`;
  };
  // the team's texts, reconciled once with the studio rules (camera wording is kept as written)
  const panels = new Map(
    data.expressions.map((e, i) => {
      const t = panelTexts(data, e, en);
      const seg = data.acting.segments.find((x) => x.expressionId === e.id);
      const line = data.dialogue.lines.find((l) => l.expressionId === e.id);
      return [
        e.id,
        {
          title: t.title,
          action: reconcile(t.action, "motion", `${i + 1}번 컷 장면 묘사`, adjustments, allowCuts),
          camera: reconcile(t.camera, "direction", `${i + 1}번 컷 카메라`, adjustments, allowCuts),
          state: t.state,
          transition: reconcile(t.transition ?? fixOf("transition", e.id, seg?.transition ?? ""), "motion", `${i + 1}번 컷 다음 컷으로`, adjustments, allowCuts),
          delivery: reconcile(t.delivery ?? fixOf("delivery", e.id, line?.delivery ?? ""), "voice", `${i + 1}번 컷 대사 말투`, adjustments, allowCuts),
        },
      ] as const;
    }),
  );
  const voices = data.cast
    .map((c) => ({ id: c.id, text: reconcile(en.cast.get(c.id)?.voice ?? fixOf("voice", c.id, c.voice), "voice", `${castLabel(data, c.id)} 목소리`, adjustments) }))
    .filter((v) => v.text.trim());
  const director = dropConstraintRepeats(reconcile(data.video.extraDirection, "direction", "추가 연출", adjustments, allowCuts), "추가 연출", adjustments);
  const rig = directorRig(director);
  const angle = directorAngle(director);
  const background = directorBackground(director);
  const directorCamera = Boolean(rig) || angle || hasCameraMove([director]);
  // a camera text alone is not a move ("locked close-up"): only words that move the camera count
  const cameraMove =
    directorCamera ||
    hasCameraMove(data.expressions.map((e) => e.action)) ||
    [...data.expressions.map((e) => e.camera), ...[...panels.values()].map((p) => p.camera)].some(cameraTextMoves);
  const overrides = [
    rig && `카메라 장비: 추가 연출의 ‘${rig}’을(를) 따름 — 제약사항의 HANDHELD 문장 대신 적용`,
    directorCamera && !rig && "카메라: 추가 연출을 따름",
    background && "배경: 추가 연출을 따름",
  ].filter((x): x is string => Boolean(x));
  const spoken = data.dialogue.lines.filter((l) => l.line.trim());
  const speaking = spoken.length > 0;
  const anyVo = spoken.some((l) => isVoiceOver(l));
  const voOnly = speaking && spoken.every((l) => isVoiceOver(l));

  const beatsWith = (B: (typeof STORY_BUDGETS)[number], fixed = true) =>
    data.acting.segments.map((seg, k) => {
      const e = data.expressions.find((x) => x.id === seg.expressionId);
      const p = panels.get(seg.expressionId);
      const l = data.dialogue.lines.find((x) => x.expressionId === seg.expressionId);
      const last = k === data.acting.segments.length - 1;
      const n = refNo(seg.expressionId);
      const action = fixed ? p?.action ?? "" : e?.action ?? "";
      const camera = fixed ? p?.camera ?? "" : e?.camera ?? "";
      const transition = fixed ? p?.transition ?? "" : seg.transition;
      const delivery = fixed ? p?.delivery ?? "" : l?.delivery ?? "";
      const cut = (t: string, max: number) => (max === Infinity ? clean(t) : clip(t, max));
      const shotNo = shots.findIndex((sh) => sh.includes(seg.expressionId)) + 1;
      return [
        `${k + 1}. ${fmtSec(seg.start)}–${fmtSec(seg.end)} seconds: panel ${panelNo(seg.expressionId)}${p?.title ? ` — ${p.title}` : ""}${multiShot ? ` (shot ${shotNo})` : ""}`,
        multiShot && k > 0 && (cuts.get(seg.expressionId) ? "HARD CUT to a new shot here." : "Same shot: the camera moves on continuously from the previous panel, no cut."),
        n && (conti ? `Composition, blocking and camera: as in ${n} (rough sketch).` : `Frame target: ${n}.`),
        cut(action, B.action) && `Action: ${sentence(cut(action, B.action))}`,
        cut(camera, B.camera) && `Camera: ${sentence(rig ? cut(camera, B.camera) : heldSteady(cut(camera, B.camera)))}`,
        cut(fixed ? p?.state ?? "" : e?.continuity ?? "", B.state) && `Continuity: ${sentence(cut(fixed ? p?.state ?? "" : e?.continuity ?? "", B.state))}`,
        principleLine(e, B.principles),
        last && endState(fixed ? p?.state ?? "" : e?.continuity ?? "") && /(?:끝|End|end)\s*[:：]/.test(fixed ? p?.state ?? "" : e?.continuity ?? "") &&
          `Result pose: ${sentence(clip(endState(fixed ? p?.state ?? "" : e?.continuity ?? ""), 200) || endState(fixed ? p?.state ?? "" : e?.continuity ?? "").slice(0, 200))}`,
        !last && B.transition && cut(transition, B.transition) && `Into the next panel: ${sentence(cut(transition, B.transition))}`,
        l?.line.trim()
          ? `${e ? castName(data, beatActor(data, e).id) : "The speaker"} ${isVoiceOver(l) ? "is heard in voice-over (heard over the picture, lips closed)" : "says exactly"} (${lang}): "${l.line}"${
              B.delivery && cut(delivery, B.delivery) ? ` — ${cut(delivery, B.delivery)}` : ""
            }`
          : "Silent beat.",
      ]
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .join("\n");
    });

  const headerWith = (B: (typeof STORY_BUDGETS)[number]) =>
    [
      multiShot
        ? `A ${data.acting.duration}-second animated scene, ${data.video.aspectRatio}, edited in ${shots.length} shots: ${shots.map((sh, i) => `shot ${i + 1} = ${rangeOf(sh)}`).join("; ")}. Cut ONLY where a beat says HARD CUT; inside a shot the camera travels continuously from one panel's framing to the next.`
        : `ONE single continuous shot with no cuts: a ${data.acting.duration}-second animated scene, ${data.video.aspectRatio}. The beats below follow storyboard panels — successive moments of this same shot; the camera travels continuously from one panel's framing to the next and never cuts.`,
      ...storyboardCastEn(data, en, B.features, B.features * 50),
      (en.style || data.style.trim()) && `Art style: ${sentence(clip(studioStyle(en.style ?? data.style), 200) || clean(studioStyle(en.style ?? data.style)).slice(0, 200))} Stay in this 3D & 2.5D animation style; never photorealistic.${keepPainted(en.style ?? data.style)}`,
      conti
        ? `LOOK (most important): every frame is a finished, fully coloured picture with the colour grading, light, atmosphere and brushwork of the scene picture and the art style below. The storyboard sketches are black-and-white layout guides only; every frame of the video is fully painted. The character design sheets give identity only (face, hair shape, body, costume design) — where this scene changes how a character looks (e.g. hair bleached by the sun, dust, a washed-out palette), follow the scene's description and the scene picture over the sheet's colours. The background references give the world; everyone keeps their proportions and appears once.`
        : `Match the reference images exactly: the named characters' faces, hair, colors and costumes, the world, the lighting and the drawing style; nobody's proportions change and no character is duplicated.`,
      continuityRules(data, en) &&
        `Continuity rules (keep them in every shot): ${clip(continuityRules(data, en), B.rules) || continuityRules(data, en).slice(0, B.rules)}${multiShot ? " Across each HARD CUT the screen sides, eyelines, costumes, props and light carry on." : ""}`,
      background ? "Background as in the DIRECTOR'S DIRECTION below." : "Background and world as in the panel references.",
      directorCamera
        ? `Camera: exactly as in the DIRECTOR'S DIRECTION below${multiShot ? "" : "; one continuous take with no cuts"}.`
        : cameraMove
          ? `Camera: follows the panel cameras below${multiShot ? ", moving continuously inside each shot" : ", moving continuously between them"} (HANDHELD as in the Constraints at the end)${multiShot ? "" : "; one continuous take with no cuts"}.`
          : multiShot
            ? "Camera: each panel's framing as described; inside a shot the camera stays on that framing with only a faint hand-held sway."
            : "Camera move: none — the framing stays put for the whole shot with only the faint sway of a hand-held camera.",
      refs.length
        ? [
            "Reference images (upload in this order):",
            ...refs.map((r, i) =>
              r.role === "identity" && r.characterId
                ? `${i + 1}. character design sheet of ${castName(data, r.characterId)} — face, hair, body and costume design only`
                : r.role === "identity"
                ? `${i + 1}. scene reference drawing — named characters, style and world; identity only`
                : r.role === "world"
                  ? `${i + 1}. ${r.assetId === data.baseAssetId ? "scene picture — the world, its light and the finished art style" : "background / asset reference — the place, props and architecture"} only`
                : r.sketch && r.parts
                  ? `${i + 1}. panels ${r.parts.map((p) => panelNo(p.expressionId)).join(", ")} side by side, left to right — rough storyboard sketches`
                : r.sketch
                  ? `${i + 1}. panel ${r.expressionId ? panelNo(r.expressionId) : "?"}${r.expressionId && panels.get(r.expressionId)?.title ? ` (${panels.get(r.expressionId)!.title})` : ""} — rough storyboard sketch`
                : r.parts
                  ? `${i + 1}. panels ${r.parts.map((p) => panelNo(p.expressionId)).join(", ")} side by side, left to right — consecutive storyboard frames`
                  : `${i + 1}. panel ${r.expressionId ? panelNo(r.expressionId) : "?"}${r.expressionId && panels.get(r.expressionId)?.title ? ` (${panels.get(r.expressionId)!.title})` : ""} — storyboard frame target`,
            ),
          ].join("\n")
        : `Use the start frame as the exact first panel.${endFrame ? " The shot ends exactly on the end frame." : ""}`,
      conti &&
        "The storyboard sketches are rough black-and-white line drawings made for planning: take from them only each panel's composition, where everyone stands, their poses and the camera framing. Render every frame fully in the art style of the design sheets and the scene picture — colour, light and finished lines — fully painted, as finished animation.",
      refs.some((r) => r.parts) &&
        "Panels shown side by side in one reference are separate moments: each plays in full frame in turn; never show a split screen, grid or side-by-side frames.",
      speaking &&
        (voOnly
          ? `Dialogue: every line is voice-over — heard over the picture only; nobody lip-syncs it (a beat that says someone silently mouths words still shows that).`
          : `Dialogue: only the character named for a line speaks it, with their own voice and lip movement; everyone else keeps their mouth closed unless a beat says they silently mouth words.${
              anyVo ? " Lines marked voice-over are heard over the picture; nobody lip-syncs them." : ""
            }`),
      speaking && data.extras.trim() && "Crowd sound only as quiet natural ambience, never words.",
      voices.length &&
        `Voices: ${voices.map((v) => `${castName(data, v.id)} — ${noEndDot(clip(v.text, 160) || clean(v.text).slice(0, 80))}`).join("; ")}. Speak only the exact dialogue below; never read direction text aloud.`,
      arcLine(en.arc),
      ACTING_EN,
      `Everyone stays alive between the panels (breathing, blinks, small weight shifts); every change ${multiShot ? "inside a shot " : ""}is acted through a physical action and in-between poses. Each action reads in order: look, prepare, act, contact, settle; the result pose holds long enough to read.${
        multiShot ? " Across a cut, the characters, costumes, world and light stay the same." : ""
      }`,
    ]
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .join("\n");

  const directorBlock = director
    ? `DIRECTOR'S DIRECTION (the director's own words: follow exactly; where it differs from the general camera, framing or background lines above, this wins):\n${director}`
    : "";
  // the very first frame's state, so the action runs from 0 seconds (the first panel's "시작")
  const firstExp = data.expressions.find((x) => x.id === data.acting.segments[0]?.expressionId);
  const zero = firstExp ? startState(panelTexts(data, firstExp, en).state) : "";
  const frameZero = zero ? `Frame zero: ${sentence(clip(zero, 220) || zero.slice(0, 220))}` : "";
  const constraints = constraintsFor(rig, data.video.weight, data.video.cadence);
  // room for the named characters beyond four (their names, features and voices)
  // each panel past six carries its own action, camera and line
  const lengthTarget =
    (en.beats.size ? VIDEO_PROMPT_TARGET_EN : VIDEO_PROMPT_TARGET) +
    Math.max(0, data.cast.length - 4) * 200 +
    Math.max(0, data.acting.segments.length - 6) * 250 +
    constraintsExtra(constraints) +
    keepPainted(en.style ?? data.style).length +
    // the acting doctrine, the arc and frame zero are written once and never cut
    ACTING_EN.length + arcLine(en.arc).length + frameZero.length;
  let prompt = "";
  for (const B of STORY_BUDGETS) {
    prompt = [headerWith(B), frameZero, beatsWith(B).join("\n\n"), directorBlock, constraints].filter(Boolean).join("\n\n");
    if (prompt.length <= lengthTarget) break;
  }
  return {
    recommendedModel: conti ? "Kling 4.0 (캐릭터 시트 → 배경·에셋 → 러프 콘티를 참고 그림으로 순서대로 첨부)" : "Kling 4.0 (컷 그림을 참고 그림으로 순서대로 첨부)",
    startFrame: refs.length
      ? conti
        ? "시작 프레임 없이, 아래 참고 그림을 순서대로 첨부하세요: ① 캐릭터 시트 ② 장면 그림·배경·에셋 ③ 러프 콘티."
        : "시작 프레임 없이, 아래 참고 그림을 순서대로 첨부하세요."
      : "첫 컷 그림을 시작 프레임으로 첨부하세요.",
    references: refs,
    prompt,
    promptKo: beatsWith(STORY_BUDGETS[0], false).join("\n\n"),
    cameraMove,
    adjustments,
    constraints,
    overrides,
    directorBlock,
    lengthTarget,
    negativePrompt: negativePrompt(data.video.weight, data.video.cadence),
  };
}

/* ───────────── 첫 장면: the scene picture drawn from the scenario ───────────── */

export type SceneImageHandoff = { prompt: string; aspectRatio: string; references: ReferenceSlot[] };

/**
 * The opening moment drawn from the scenario and the character material, used as the scene reference
 * picture when the team has none: every named character clearly visible, in the scene's style.
 * One character in character-by-character mode: a portrait 3:4 character picture on a plain background.
 */
export function buildSceneImageHandoff(data: ProjectData): SceneImageHandoff {
  const en = freshEnglish(data);
  const story = isStoryboard(data);
  const multi = isMultiCast(data);
  const aspect = story || multi ? data.video.aspectRatio : EXPRESSION_IMAGE_ASPECT;
  const references: ReferenceSlot[] = [];
  for (const c of data.cast)
    if (c.refAssetId)
      references.push({ role: `image reference ${references.length + 1}`, assetId: c.refAssetId, why: `${castLabel(data, c.id)} 참고 자료`, characterId: c.id });
  for (const id of extraRefsFitting(data, references, 0))
    references.push({ role: `image reference ${references.length + 1}`, assetId: id, why: "추가 참고 그림" });
  const refOf = (id: string) => references.findIndex((r) => r.characterId === id) + 1;
  const style = studioStyle(en.style ?? clean(data.style));
  const scene = clean(data.opening) || clip(data.expressionSetup.scene, 600) || clean(data.expressionSetup.scene).slice(0, 600);
  const people = data.cast.map((c) => {
    const f = en.cast.get(c.id);
    const n = refOf(c.id);
    const look = f?.look ? f.look.join("; ") : [clean(c.locks), clean(c.appearance)].filter(Boolean).join(" ");
    const outfit = f?.outfit ?? clean(c.outfit);
    return `- ${castName(data, c.id)}${multi && !story ? ` (${POSITION_EN[c.position]})` : ""}: ${[look, outfit && `Outfit: ${outfit}`].filter(Boolean).join(". ")}${
      n ? ` Image reference ${n} is their design sheet: copy face, hair colour and hairstyle, body proportions and the design details of their clothes exactly from it — for the face, hair and body the design sheet wins over the text. What they wear in this scene follows the costume text above (a disguise, robe, hood or face cover over the sheet's clothes); the text also adds passing details (dirt, tears, wind, props held).` : ""
    }`;
  });
  const prompt = [
    story || multi
      ? `Opening frame of an animated scene, ${aspect}, a finished illustration — not a sketch, not a character sheet, no panels.`
      : `Single character illustration of ONE character, portrait ${aspect}, bust shot, eye-level camera, plain white background — not a sheet, no panels.`,
    `This picture becomes the reference for every later frame: draw ${multi ? "every named character" : "the character"} clearly — whole head and upper body visible, face readable, nobody hidden, cut off or covering another's face.`,
    multi ? `Named characters (exactly these, each one distinct; never mix features between them):` : `The character:`,
    ...people,
    ...extraRefsEn(data, references).filter((l) => !l.includes("design sheet")),
    story && data.extras.trim() && `Crowd and background people (unnamed): ${noEndDot(clean(data.extras))}.`,
    style && `Art style: ${style.replace(/[.。]+$/, "")}. 3D & 2.5D animation style; never photorealistic.`,
    scene && (story || multi) && `The moment: ${sentence(scene)}`,
    !story && multi && `Background: plain and light so every character reads clearly.`,
    `No text, no labels, no name tags, no borders.`,
  ]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .join("\n");
  return { prompt, aspectRatio: aspect, references };
}
