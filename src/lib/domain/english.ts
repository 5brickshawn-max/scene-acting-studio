/**
 * 영어 정리: English for the image and video prompts.
 *
 * The team designs in Korean. Video and image models follow short English far better than long
 * Korean cut to fit a length budget (which left sentences broken off mid-way). An AI job
 * (write_english) turns the design into short English pieces. Each piece keeps a key of the
 * Korean it was made from, and the prompts use it only while that Korean is unchanged: an edit
 * never leaves stale English in a prompt — that part falls back to the Korean until the English
 * is made again.
 */
import { effectiveText, type EnglishSheet, type ProjectData } from "./project";

/** FNV-1a: a short, stable fingerprint of a text. */
export function textKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The Korean each English piece is made from (render-check fixes included). */
export function englishSources(d: ProjectData) {
  return {
    language: d.dialogue.language.trim(),
    // a 2D project's English style is written for 2D (3D & 2.5D keeps the older key)
    style: d.dimension === "2d" && d.style.trim() ? `2d|${d.style.trim()}` : d.style.trim(),
    continuity: d.mode === "storyboard" ? d.expressionSetup.continuity.trim() : "",
    /** the arc follows the whole design: any panel, transition or line change makes it stale */
    arc: d.expressions.length ? `arc1|${d.expressionSetup.scene.trim()}|${beatSources(d).join("|")}` : "",
    cast: d.cast.map((c) => ({
      characterId: c.id,
      look: [c.name.trim(), c.locks.trim(), c.appearance.trim()].filter(Boolean).join("\n"),
      outfit: c.outfit.trim(),
      voice: effectiveText(d, "voice", c.id, c.voice).trim(),
    })),
    beats: d.expressions.map((e, i) => ({ expressionId: e.id, source: beatSources(d)[i] })),
    acting: actingSource(d, beatSources(d)),
  };
}

/**
 * Version of the acting instructions (character-by-character mode). act-v1 is Facial Acting Studio's acting sheet
 * as of 2026-11-25 (its acting-v22): states and triggers, ordered actions, each beat's face work, one of two
 * speeds for every change of expression, no there-and-back of eyes and head, the hand the design names, one
 * sizable body action per beat with a calm head. A new version makes the acting written before it due once.
 */
const ACTING_VERSION = "act-v1";

/**
 * What the acting English (states, triggers, ordered actions, first frame, end pose, eyeline, scene) is made
 * from: every beat's texts, plus what those keys leave out — the order on the timeline, every character's
 * direction (the team may set one by hand) and each picture. Empty in storyboard mode, which has no such part.
 */
function actingSource(d: ProjectData, beats: string[]): string {
  if (d.mode === "storyboard") return "";
  const scene = d.expressionSetup.scene.trim();
  if (!scene && !beats.length) return "";
  return JSON.stringify([
    ACTING_VERSION,
    scene,
    d.cast.map((c) => [c.id, c.locks.trim(), c.outfit.trim()]),
    ...beats,
    d.acting.segments.map((x) => x.expressionId),
    d.expressions.map((x) => [x.direction, x.directionStatus, x.imageAssetId ?? "", x.reactions.map((r) => [r.characterId, r.direction])]),
  ]);
}

function beatSources(d: ProjectData): string[] {
  return d.expressions.map((e) => {
      const seg = d.acting.segments.find((s) => s.expressionId === e.id);
      const line = d.dialogue.lines.find((l) => l.expressionId === e.id);
      return JSON.stringify([
          // v2: storyboard moments are kept whole (older sheets were cut at 200 characters) → written again once
          d.mode === "storyboard" ? "sb2" : "",
          d.expressionSetup.framing,
          e.characterId,
          // storyboard panels: the whole moment and the camera
          e.action,
          e.camera,
          e.continuity,
          e.sketchAssetId,
          e.link,
          e.reactions.map((r) => [r.characterId, r.emotion, r.intensity, r.brows, r.eyes, r.mouth, r.gesture]),
          e.emotion,
          e.intensity,
          e.brows,
          e.eyes,
          e.mouth,
          effectiveText(d, "notes", e.id, e.notes),
          effectiveText(d, "gesture", e.id, e.gesture),
          seg ? effectiveText(d, "transition", e.id, seg.transition) : "",
          line?.line ?? "",
          line?.meaning ?? "",
          line ? effectiveText(d, "delivery", e.id, line.delivery) : "",
        ]);
  });
}

export type EnglishBeat = EnglishSheet["beats"][number];
export type FreshCast = { look: string[] | null; outfit: string | null; voice: string | null };
export type FreshActing = { scene: string; eyeline: string; frameZero: string; weight: string; heavy: string; light: string };
export type FreshEnglish = {
  language: string | null;
  style: string | null;
  /** storyboard continuity rules in English, null when missing or out of date */
  continuity: string | null;
  /** the scene's emotional arc (states → triggers), null when missing or out of date */
  arc: string | null;
  /** fresh per-character pieces by cast member id (every member has an entry) */
  cast: Map<string, FreshCast>;
  /** fresh beats by expression id */
  beats: Map<string, EnglishBeat>;
  /** the performance as a whole (character-by-character mode), null when missing or out of date */
  acting: FreshActing | null;
};

const NO_CAST: FreshCast = { look: null, outfit: null, voice: null };

/** The English pieces that still match the design (null / missing where the Korean changed). */
export function freshEnglish(d: ProjectData): FreshEnglish {
  const en = d.english;
  const blank = new Map(d.cast.map((c) => [c.id, NO_CAST]));
  const none: FreshEnglish = { language: null, style: null, continuity: null, arc: null, cast: blank, beats: new Map(), acting: null };
  if (!en) return none;
  const src = englishSources(d);
  const ok = (key: string, source: string, text: string) => Boolean(source && text.trim() && key === textKey(source));
  const beats = new Map<string, EnglishBeat>();
  for (const b of src.beats) {
    const eb = en.beats.find((x) => x.expressionId === b.expressionId);
    if (eb && eb.key === textKey(b.source)) beats.set(b.expressionId, eb);
  }
  const cast = new Map<string, FreshCast>();
  for (const c of src.cast) {
    const ec = en.cast.find((x) => x.characterId === c.characterId);
    cast.set(
      c.characterId,
      ec
        ? {
            look: c.look && ec.look.key === textKey(c.look) && ec.look.items.length ? ec.look.items : null,
            outfit: ok(ec.outfit.key, c.outfit, ec.outfit.text) ? ec.outfit.text.trim() : null,
            voice: ok(ec.voice.key, c.voice, ec.voice.text) ? ec.voice.text.trim() : null,
          }
        : NO_CAST,
    );
  }
  return {
    language: ok(en.language.key, src.language, en.language.text) ? en.language.text.trim() : null,
    style: ok(en.style.key, src.style, en.style.text) ? en.style.text.trim() : null,
    continuity: ok(en.continuity.key, src.continuity, en.continuity.text) ? en.continuity.text.trim() : null,
    arc: ok(en.arc.key, src.arc, en.arc.text) ? en.arc.text.trim() : null,
    cast,
    beats,
    acting:
      // (a sheet made before this part existed has none: a job result is applied as it arrives, unparsed)
      src.acting && en.acting && en.acting.key === textKey(src.acting)
        ? { scene: en.acting.scene, eyeline: en.acting.eyeline, frameZero: en.acting.frameZero, weight: en.acting.weight, heavy: en.acting.heavy, light: en.acting.light }
        : null,
  };
}

/**
 * What is missing or out of date, in the team's words ("2번 표정", "A 목소리"). Empty when all is fresh.
 * Only a key that no longer matches the Korean (or a piece the AI never wrote) counts: a piece the AI left
 * empty for the current Korean is "no English" (the prompt uses the Korean) — not stale, so asking again
 * cannot loop on it.
 */
export function englishStale(d: ProjectData): string[] {
  const src = englishSources(d);
  const en = d.english;
  const out: string[] = [];
  const multi = d.cast.length > 1;
  const current = (key: string | undefined, source: string) => !source || key === textKey(source);
  src.cast.forEach((c, i) => {
    const ec = en?.cast.find((x) => x.characterId === c.characterId);
    const who = multi ? `${String.fromCharCode(65 + i)} ` : "";
    if (!current(ec?.look.key, c.look)) out.push(`${who}유지할 특징`);
    if (!current(ec?.outfit.key, c.outfit)) out.push(`${who}의상`);
    if (!current(ec?.voice.key, c.voice)) out.push(`${who}목소리`);
  });
  if (!current(en?.style.key, src.style)) out.push("그림체");
  if (!current(en?.continuity.key, src.continuity)) out.push("연결 규칙");
  if (!current(en?.arc.key, src.arc)) out.push("감정 흐름");
  if (!current(en?.acting?.key, src.acting)) out.push("연기 흐름");
  if (!current(en?.language.key, src.language)) out.push("대사 언어");
  src.beats.forEach((b, i) => {
    const eb = en?.beats.find((x) => x.expressionId === b.expressionId);
    if (!eb || eb.key !== textKey(b.source)) out.push(d.mode === "storyboard" ? `${i + 1}번 컷` : `${i + 1}번 표정`);
  });
  return out;
}

/** Shorten to `max` characters at a sentence or clause end (the AI is asked for short text; this is a guard). */
export function fitText(t: string, max: number): string {
  const c = t.replace(/\s+/g, " ").trim();
  if (c.length <= max) return c;
  const head = c.slice(0, max);
  const at = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "), head.lastIndexOf(", "));
  return (at > max / 3 ? head.slice(0, at) : head.slice(0, head.lastIndexOf(" ") > max / 2 ? head.lastIndexOf(" ") : max)).replace(/[,;]$/, "").trim();
}

type EnglishOut = {
  language: string;
  style: string;
  continuity?: string;
  arc?: string;
  cast: { character: number; look: string[]; outfit: string; voice: string }[];
  beats: {
    panel: number;
    emotion: string;
    face: string;
    body: string;
    transition: string;
    delivery: string;
    state?: string;
    others?: { character: number; emotion: string; face: string; body: string }[];
    mood?: string;
    signs?: string;
    facework?: string;
    change?: "" | "slow" | "snap";
    trigger?: string;
    action?: string;
    hold?: string;
    result?: string;
  }[];
  scene?: string;
  eyeline?: string;
  frameZero?: string;
  weight?: string;
  heavy?: string;
  light?: string;
};

/** The AI's English, tied to the Korean it was made from (built on the server from the checked version). */
export function buildEnglishSheet(d: ProjectData, out: EnglishOut): EnglishSheet {
  const src = englishSources(d);
  const piece = (text: string, source: string, max: number) => ({ text: fitText(text, max), key: textKey(source) });
  const cast1 = d.mode !== "storyboard";
  // the first beat of the video has nothing before it: no change into it
  const firstId = d.acting.segments[0]?.expressionId;
  return {
    language: piece(out.language, src.language, 60),
    style: piece(out.style, src.style, 200),
    continuity: piece(out.continuity ?? "", src.continuity, 600),
    arc: piece(out.arc ?? "", src.arc, 650),
    cast: src.cast.flatMap((c, i) => {
      const o = out.cast.find((x) => x.character === i + 1);
      if (!o) return [];
      return [
        {
          characterId: c.characterId,
          look: { items: o.look.map((x) => fitText(x, 70)).filter(Boolean).slice(0, 8), key: textKey(c.look) },
          outfit: piece(o.outfit, c.outfit, 200),
          voice: piece(o.voice, c.voice, 200),
        },
      ];
    }),
    beats: d.expressions.flatMap((e, i) => {
      const b = out.beats.find((x) => x.panel === i + 1);
      const s = src.beats[i];
      if (!b || !s) return [];
      return [
        {
          expressionId: e.id,
          key: textKey(s.source),
          emotion: fitText(b.emotion, 60),
          // storyboard: face = the whole moment (who does what), body = the camera — longer than one look
          face: fitText(b.face, d.mode === "storyboard" ? 380 : 200),
          body: fitText(b.body, d.mode === "storyboard" ? 240 : 200),
          transition: fitText(b.transition, 140),
          delivery: fitText(b.delivery, 180),
          state: fitText(b.state ?? "", 260),
          others: (b.others ?? []).flatMap((o) => {
            const id = d.cast[o.character - 1]?.id;
            return id && id !== e.characterId
              ? [{ characterId: id, emotion: fitText(o.emotion, 60), face: fitText(o.face, 160), body: fitText(o.body, 120) }]
              : [];
          }),
          mood: cast1 ? fitText(b.mood ?? "", 40).toUpperCase() : "",
          signs: cast1 ? fitText(b.signs ?? "", 200) : "",
          facework: cast1 ? fitText(b.facework ?? "", 260) : "",
          change: cast1 && e.id !== firstId && (b.change === "slow" || b.change === "snap") ? b.change : "",
          trigger: cast1 ? fitText(b.trigger ?? "", 140) : "",
          action: cast1 ? fitText(b.action ?? "", 300) : "",
          hold: cast1 ? fitText(b.hold ?? "", 180) : "",
          result: cast1 ? fitText(b.result ?? "", 180) : "",
        },
      ];
    }),
    acting: {
      key: src.acting ? textKey(src.acting) : "",
      scene: cast1 ? fitText(out.scene ?? "", 420) : "",
      eyeline: cast1 ? fitText(out.eyeline ?? "", 300) : "",
      frameZero: cast1 ? fitText(out.frameZero ?? "", 240) : "",
      weight: cast1 ? fitText(out.weight ?? "", 200) : "",
      heavy: cast1 ? fitText(out.heavy ?? "", 120) : "",
      light: cast1 ? fitText(out.light ?? "", 120) : "",
    },
  };
}
