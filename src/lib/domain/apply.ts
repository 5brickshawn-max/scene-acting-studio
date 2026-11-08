/** Pure functions that merge an AI proposal into project data. Applying is
 * always an explicit user action; fields can be picked individually. */
import type { ActingOutT, CharacterOutT, DialogueOutT, ExpressionsOutT, SceneComposeOutT, StoryboardOutT } from "@/lib/ai/schemas";
import {
  capShots,
  fitShots,
  MAX_SHOTS,
  MAX_EXPRESSIONS,
  MAX_VIDEO_SECONDS,
  MIN_EXPRESSIONS,
  round3,
  setExpressionCount,
  blankCastMember,
  defaultPositions,
  maxCastFor,
  withActors,
  blankExpression,
  withReactionsFor,
  type Performance,
  reopenFrom,
  weightedSegments,
  type Expression,
  type ProjectData,
} from "./project";

export type CharacterField = "locks" | "appearance" | "outfit" | "style" | "questions";

/**
 * Apply an analysis of the scene drawing. Picked fields apply to every character the AI described
 * (by cast number); "style" is the scene's shared style; questions go to the first character's list
 * (they are about the scene as a whole).
 */
export function applyCharacter(data: ProjectData, out: CharacterOutT, fields: CharacterField[]): ProjectData {
  const pick = new Set(fields);
  const cast = data.cast.map((member, i) => {
    const o = out.characters.find((x) => x.character === i + 1);
    const c = { ...member };
    if (o) for (const f of ["locks", "appearance", "outfit"] as const) if (pick.has(f)) c[f] = o[f];
    if (i === 0 && pick.has("questions")) {
      const existing = new Set(c.questions.map((q) => q.question));
      c.questions = [...c.questions, ...out.questions.filter((q) => !existing.has(q)).map((q) => ({ question: q, answer: "" }))];
    }
    return c;
  });
  return reopenFrom({ ...data, cast, style: pick.has("style") ? out.style : data.style }, 0);
}

export type ComposeField = "cast" | "style" | "extras" | "opening" | "questions" | "structure";

/** The proposed structure as the app can build it: at most 12 panels, at least 2, within 60 seconds. */
export function composeStructure(data: Pick<ProjectData, "mode">, out: Pick<SceneComposeOutT, "shots" | "duration">) {
  const story = data.mode === "storyboard";
  // character-by-character scenes are one continuous shot: its panels are the beats
  let shots = (story ? out.shots : [{ title: "", seconds: out.duration, panels: out.shots.flatMap((s) => s.panels) }]).filter((s) => s.panels.length);
  const proposedShots = shots.length;
  // at most MAX_SHOTS shots: the shortest shot (fewest panels) joins the one before it
  while (shots.length > MAX_SHOTS) {
    let k = 1;
    for (let i = 2; i < shots.length; i++) if (shots[i].panels.length <= shots[k].panels.length) k = i;
    const merged = { title: shots[k - 1].title, seconds: (shots[k - 1].seconds || 0) + (shots[k].seconds || 0), panels: [...shots[k - 1].panels, ...shots[k].panels] };
    shots = [...shots.slice(0, k - 1), merged, ...shots.slice(k + 1)];
  }
  const panels: { title: string; shot: number; weight: number }[] = [];
  shots.forEach((s, k) => s.panels.forEach((t) => panels.push({ title: t, shot: k, weight: Math.max(0.2, s.seconds || 1) / s.panels.length })));
  const total = panels.length;
  const kept = panels.slice(0, MAX_EXPRESSIONS);
  const duration = round3(Math.min(MAX_VIDEO_SECONDS, Math.max(1, out.duration || kept.reduce((a, p) => a + p.weight, 0))));
  return { story, shots: shots.length, mergedShots: proposedShots - shots.length, panels: kept, total, clipped: total > MAX_EXPRESSIONS, tooFew: kept.length < MIN_EXPRESSIONS, duration };
}

/**
 * Apply a scene composition (씬 구성). "cast" replaces the named characters with the AI's list (up to the
 * mode's limit), keeping each existing member — its id, picture and voice — in order; beats are re-pointed.
 */
export function applyComposition(data: ProjectData, out: SceneComposeOutT, fields: ComposeField[]): ProjectData {
  const pick = new Set(fields);
  let cast = data.cast;
  if (pick.has("cast") && out.characters.length) {
    const list = out.characters.slice(0, maxCastFor(data.mode));
    const positions = defaultPositions(list.length);
    cast = list.map((o, i) => {
      const prev = data.cast[i] ?? blankCastMember();
      return {
        ...prev,
        name: o.name.trim() || prev.name,
        locks: o.locks,
        appearance: o.appearance,
        outfit: o.outfit,
        voice: prev.voice.trim() || o.voice,
        position: list.length === data.cast.length ? prev.position : positions[i],
      };
    });
  }
  if (pick.has("questions") && out.questions.length) {
    const first = { ...cast[0] };
    const existing = new Set(first.questions.map((q) => q.question));
    first.questions = [...first.questions, ...out.questions.filter((q) => !existing.has(q)).map((q) => ({ question: q, answer: "" }))];
    cast = [first, ...cast.slice(1)];
  }
  let next: ProjectData = withActors({
    ...data,
    cast,
    style: pick.has("style") && out.style.trim() ? out.style : data.style,
    extras: pick.has("extras") ? out.extras : data.extras,
    opening: pick.has("opening") && out.opening.trim() ? out.opening : data.opening,
  });
  // 쇼트 구성: panel count, cut links (storyboard), titles and the time split, all at once
  const st = composeStructure(data, out);
  if (pick.has("structure") && !st.tooFew) {
    next = setExpressionCount(next, st.panels.length);
    const expressions = next.expressions.map((e, i) => {
      const p = st.panels[i];
      const opensShot = i > 0 && p.shot !== st.panels[i - 1].shot;
      return st.story
        ? { ...e, emotion: p.title, link: opensShot ? ("cut" as const) : ("continuous" as const) }
        : { ...e, notes: e.notes.trim() || p.title, link: "continuous" as const };
    });
    const ids = expressions.map((e) => e.id);
    next = {
      ...next,
      expressions,
      // the proposed shot count becomes the team's choice (step 2 ① shows and keeps it)
      expressionSetup: st.story ? { ...next.expressionSetup, shots: new Set(st.panels.map((p) => p.shot)).size } : next.expressionSetup,
      acting: { duration: st.duration, segments: weightedSegments(ids, st.panels.map((p) => p.weight), st.duration) },
    };
  }
  return reopenFrom(next, 0);
}

/** AI directions are marked "ai" so the step cannot be approved until a person confirms them. */
export function applyExpressions(data: ProjectData, out: ExpressionsOutT, indexes?: number[]): ProjectData {
  const count = data.expressionSetup.count;
  const pick = new Set(indexes ?? out.expressions.map((_, i) => i));
  const expressions: Expression[] = Array.from({ length: count }, (_, i) => {
    const prev = data.expressions[i] ?? blankExpression(i + 1, data.cast[i % data.cast.length].id);
    const o = out.expressions[i];
    if (!o || !pick.has(i)) return prev;
    // the AI names the lead by cast number (1-based); keep the current lead if it names none
    const actor = data.cast[(o.character ?? 0) - 1]?.id ?? prev.characterId;
    // every other character's acting at that moment (AI directions wait for a person's check, like the lead's)
    const reactions: Performance[] =
      data.cast.length > 1
        ? (o.reactions ?? []).flatMap((r) => {
            const id = data.cast[r.character - 1]?.id;
            if (!id || id === actor) return [];
            return [
              {
                characterId: id,
                emotion: r.emotion,
                intensity: r.intensity,
                brows: r.brows,
                eyes: r.eyes,
                mouth: r.mouth,
                gesture: r.gesture ?? "",
                direction: { facing: r.facing, pitch: r.pitch, tilt: r.tilt, gaze: r.gaze, body: r.body },
                directionStatus: "ai" as const,
              },
            ];
          })
        : [];
    return withReactionsFor(data.cast, {
      ...prev,
      characterId: actor,
      reactions: reactions.length ? reactions : prev.characterId === actor ? prev.reactions : [],
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
    });
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

/** Storyboard mode: the AI's panels (picked ones) become the beats; the speaker names who talks in that panel. */
export function applyStoryboard(data: ProjectData, out: StoryboardOutT, indexes?: number[]): ProjectData {
  const count = data.expressionSetup.count;
  const pick = new Set(indexes ?? out.panels.map((_, i) => i));
  const expressions: Expression[] = Array.from({ length: count }, (_, i) => {
    const prev = data.expressions[i] ?? blankExpression(i + 1, data.cast[0].id);
    const o = out.panels[i];
    if (!o || !pick.has(i)) return prev;
    const speaker = data.cast[o.speaker - 1]?.id ?? prev.characterId;
    return withReactionsFor(data.cast, {
      ...prev,
      characterId: speaker,
      emotion: o.title,
      action: o.action,
      camera: o.camera,
      continuity: o.state ?? prev.continuity,
      link: i === 0 ? "continuous" : o.link ?? prev.link,
    });
  });
  // a shot count the team chose (step 2 ①) stays, keeping the AI's cut places where they fit; else at most MAX_SHOTS
  const chosen = data.expressionSetup.shots;
  // the scene's continuity rules come with a full design (a partial pick keeps the team's rules)
  const whole = !indexes || out.panels.every((_, i) => i >= count || indexes.includes(i));
  const rules = whole && out.continuity?.trim() ? out.continuity.trim() : data.expressionSetup.continuity;
  const next = { ...data, expressions, expressionSetup: { ...data.expressionSetup, continuity: rules } };
  return reopenFrom(chosen !== null ? fitShots(next, chosen) : capShots(next), 1);
}

export function applyDialogue(data: ProjectData, out: DialogueOutT): ProjectData {
  const lines = data.expressions.map((e, i) => {
    const o = out.lines.find((l) => l.panel === i + 1);
    const prev = data.dialogue.lines.find((l) => l.expressionId === e.id);
    return o
      ? { expressionId: e.id, line: o.line, meaning: o.meaning, delivery: o.delivery, vo: o.vo ?? null }
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
  // storyboard: the panel order is the design (cuts, continuity, the panel before each one) — only the times change
  if (data.mode === "storyboard") {
    const at = new Map(data.expressions.map((e, i) => [e.id, i]));
    segs.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  }
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
