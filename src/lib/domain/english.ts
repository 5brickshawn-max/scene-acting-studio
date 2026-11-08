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
    style: d.style.trim(),
    cast: d.cast.map((c) => ({
      characterId: c.id,
      look: [c.name.trim(), c.locks.trim(), c.appearance.trim()].filter(Boolean).join("\n"),
      outfit: c.outfit.trim(),
      voice: effectiveText(d, "voice", c.id, c.voice).trim(),
    })),
    beats: d.expressions.map((e) => {
      const seg = d.acting.segments.find((s) => s.expressionId === e.id);
      const line = d.dialogue.lines.find((l) => l.expressionId === e.id);
      return {
        expressionId: e.id,
        source: JSON.stringify([
          // v2: storyboard moments are kept whole (older sheets were cut at 200 characters) → written again once
          d.mode === "storyboard" ? "sb2" : "",
          d.expressionSetup.framing,
          e.characterId,
          // storyboard panels: the whole moment and the camera
          e.action,
          e.camera,
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
        ]),
      };
    }),
  };
}

export type EnglishBeat = EnglishSheet["beats"][number];
export type FreshCast = { look: string[] | null; outfit: string | null; voice: string | null };
export type FreshEnglish = {
  language: string | null;
  style: string | null;
  /** fresh per-character pieces by cast member id (every member has an entry) */
  cast: Map<string, FreshCast>;
  /** fresh beats by expression id */
  beats: Map<string, EnglishBeat>;
};

const NO_CAST: FreshCast = { look: null, outfit: null, voice: null };

/** The English pieces that still match the design (null / missing where the Korean changed). */
export function freshEnglish(d: ProjectData): FreshEnglish {
  const en = d.english;
  const blank = new Map(d.cast.map((c) => [c.id, NO_CAST]));
  const none: FreshEnglish = { language: null, style: null, cast: blank, beats: new Map() };
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
    cast,
    beats,
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
  cast: { character: number; look: string[]; outfit: string; voice: string }[];
  beats: {
    panel: number;
    emotion: string;
    face: string;
    body: string;
    transition: string;
    delivery: string;
    others?: { character: number; emotion: string; face: string; body: string }[];
  }[];
};

/** The AI's English, tied to the Korean it was made from (built on the server from the checked version). */
export function buildEnglishSheet(d: ProjectData, out: EnglishOut): EnglishSheet {
  const src = englishSources(d);
  const piece = (text: string, source: string, max: number) => ({ text: fitText(text, max), key: textKey(source) });
  return {
    language: piece(out.language, src.language, 60),
    style: piece(out.style, src.style, 200),
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
          delivery: fitText(b.delivery, 80),
          others: (b.others ?? []).flatMap((o) => {
            const id = d.cast[o.character - 1]?.id;
            return id && id !== e.characterId
              ? [{ characterId: id, emotion: fitText(o.emotion, 60), face: fitText(o.face, 160), body: fitText(o.body, 120) }]
              : [];
          }),
        },
      ];
    }),
  };
}
