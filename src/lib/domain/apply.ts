/** Pure functions that merge an AI proposal into project data. Applying is
 * always an explicit user action; fields can be picked individually. */
import type { ActingOutT, CharacterOutT, DialogueOutT, ExpressionsOutT } from "@/lib/ai/schemas";
import {
  blankExpression,
  reopenFrom,
  weightedSegments,
  type Expression,
  type ProjectData,
} from "./project";

export type CharacterField = "locks" | "appearance" | "outfit" | "style" | "questions";

/**
 * Apply an analysis of one cast member's drawing. "style" is the scene's shared art style
 * (every character is drawn in it), the rest belongs to that character.
 */
export function applyCharacter(data: ProjectData, out: CharacterOutT, fields: CharacterField[], characterId?: string): ProjectData {
  const id = characterId && data.cast.some((c) => c.id === characterId) ? characterId : data.cast[0].id;
  let style = data.style;
  const cast = data.cast.map((member) => {
    if (member.id !== id) return member;
    const c = { ...member };
    for (const f of fields) {
      if (f === "questions") {
        const existing = new Set(c.questions.map((q) => q.question));
        c.questions = [...c.questions, ...out.questions.filter((q) => !existing.has(q)).map((q) => ({ question: q, answer: "" }))];
      } else if (f === "style") {
        style = out.style;
      } else {
        c[f] = out[f];
      }
    }
    return c;
  });
  return reopenFrom({ ...data, cast, style }, 0);
}

/** AI directions are marked "ai" so the step cannot be approved until a person confirms them. */
export function applyExpressions(data: ProjectData, out: ExpressionsOutT, indexes?: number[]): ProjectData {
  const count = data.expressionSetup.count;
  const pick = new Set(indexes ?? out.expressions.map((_, i) => i));
  const expressions: Expression[] = Array.from({ length: count }, (_, i) => {
    const prev = data.expressions[i] ?? blankExpression(i + 1, data.cast[i % data.cast.length].id);
    const o = out.expressions[i];
    if (!o || !pick.has(i)) return prev;
    // the AI names the actor by cast number (1-based); keep the current actor if it names none
    const actor = data.cast[(o.character ?? 0) - 1]?.id ?? prev.characterId;
    return {
      ...prev,
      characterId: actor,
      others: data.cast.length > 1 ? o.others ?? prev.others : "",
      panel: o.panel,
      emotion: o.emotion,
      intensity: o.intensity,
      brows: o.brows,
      eyes: o.eyes,
      mouth: o.mouth,
      notes: o.notes,
      // proposals made before gestures existed have no gesture: keep what is there
      gesture: o.gesture ?? prev.gesture,
      direction: { facing: o.facing, pitch: o.pitch, tilt: o.tilt, gaze: o.gaze, body: o.body },
      directionStatus: "ai",
    };
  });
  return reopenFrom(
    {
      ...data,
      expressions,
      expressionSetup: { ...data.expressionSetup, styleWarning: out.styleWarning },
    },
    1,
  );
}

export function applyDialogue(data: ProjectData, out: DialogueOutT): ProjectData {
  const lines = data.expressions.map((e, i) => {
    const o = out.lines.find((l) => l.panel === i + 1);
    const prev = data.dialogue.lines.find((l) => l.expressionId === e.id);
    return o
      ? { expressionId: e.id, line: o.line, meaning: o.meaning, delivery: o.delivery }
      : prev ?? { expressionId: e.id, line: "", meaning: "", delivery: "" };
  });
  // voices are per cast member (by cast number); an empty voice keeps what is there
  const cast = data.cast.map((c, i) => {
    const v = out.voices.find((x) => x.character === i + 1)?.voice.trim();
    return v ? { ...c, voice: v } : c;
  });
  return reopenFrom({ ...data, cast, dialogue: { ...data.dialogue, lines } }, 2);
}

/** The total length is fixed (set in step 2): the AI's order and proportions are scaled to fit it. */
export function applyActing(data: ProjectData, out: ActingOutT): ProjectData {
  const duration = data.acting.duration;
  const segs = out.segments
    .map((s) => ({ ...s, id: data.expressions[s.panel - 1]?.id }))
    .filter((s): s is typeof s & { id: string } => Boolean(s.id))
    .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
    .sort((a, b) => a.start - b.start);
  if (!segs.length) return data;
  const ids = segs.map((s) => s.id);
  const weights = segs.map((s) => Math.max(0.1, s.end - s.start));
  // Every expression must appear: append any the AI left out with an average share.
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  for (const e of data.expressions) {
    if (ids.includes(e.id)) continue;
    ids.push(e.id);
    weights.push(avg);
  }
  const transitions = Object.fromEntries(segs.map((s) => [s.id, s.transition]));
  const segments = weightedSegments(ids, weights, duration, transitions);
  return reopenFrom({ ...data, acting: { duration, segments } }, 3);
}
