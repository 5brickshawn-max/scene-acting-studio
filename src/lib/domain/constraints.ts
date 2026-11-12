/**
 * Studio constraints for every video prompt (always the last block), and the
 * automatic reconciliation (자동 조율) that keeps the rest of the prompt from
 * contradicting them.
 *
 * Precedence, highest first:
 *   1. the director's additional direction (추가 연출) for camera, angle and background
 *   2. the studio constraints (motion cadence, no music, secondary action)
 *   3. the app's general prompt lines
 * The team's texts are adjusted only where they break a studio rule (cuts,
 * music, morphing, smooth motion). Camera sentences in the director's
 * direction are never rewritten; instead the constraints' camera sentence
 * adapts to the director's rig.
 */

/**
 * The studio block, written in positive terms (text encoders tend to picture the words a "never …" names);
 * the things to avoid go to NEGATIVE_PROMPT for models with a negative field. Weight comes from visible
 * results (fast drops, short airtime, hard contacts, planted feet), not from numbers.
 */
/**
 * Motion cadence. The team's rule (SH04_3 Seedance tests, Nov 2026): full 24fps feature-animation cadence is
 * the default; the earlier stop-motion stepped timing stays available as an option.
 */
export const CADENCES = ["full", "stepped"] as const;
export type Cadence = (typeof CADENCES)[number];
export const CADENCE_LABEL: Record<Cadence, string> = { full: "풀 애니메이션 (24fps, 기본)", stepped: "스톱모션 박자" };

const MOTION: Record<Cadence, string> = {
  full:
    "[MOTION] A stylized 2.5D & 3D animated feature film. Full smooth feature-animation cadence, rendered on ones at 24 frames per second, moving pose to pose through clear key poses. REAL-TIME speed. Shapes keep their volume and design from frame to frame (a squash on impact recovers to the same shape).",
  stepped:
    "[MOTION] 2.5D & 3D animation. Only the timing is stop-motion: stepped cadence, 24fps, animated on ones — a new held pose every frame, moving in crisp frame-by-frame steps, with painterly & line boil. Every character, creature and moving object travels pose to pose. Shapes keep their volume and design from frame to frame (a squash on impact recovers to the same shape).",
};

/** How heavy movement reads: real weight, heavy, or exaggerated (as if gravity were about 1.5× as strong). */
export const WEIGHT_LEVELS = ["natural", "heavy", "extra"] as const;
export type WeightLevel = (typeof WEIGHT_LEVELS)[number];
export const WEIGHT_LABEL: Record<WeightLevel, string> = { natural: "실제 무게", heavy: "무겁게", extra: "과장 (중력 1.5배)" };

/** Weight as visible results at real-time speed (no instruction to speed movement up). The number lives in one place only. */
const WEIGHT: Record<WeightLevel, string> = {
  natural:
    "[WEIGHT] Bodies and objects have real weight. All motion runs at real-time speed. Jumps and falls are quick: whatever leaves the ground comes back down promptly, speeding up on the way down. Every foot contact plants flat and holds its place; weight shifts visibly from foot to foot. Landings bend the knees and the body takes the impact, then recovers.",
  heavy:
    "[WEIGHT & GRAVITY — HEAVY] Everything is dense and heavy. All motion runs at real-time speed. Airtime is short: jumps stay low and anything that leaves the ground drops back fast, accelerating on the way down. Every ground contact is a hard hit: feet plant flat and lock in place, knees and spine compress on landing, the body jolts on the impact frame, then recovers with visible effort. Running is heavy and pounding: the torso dips on every footfall, each step shoves off the ground, the feet stay planted.",
  extra:
    "[WEIGHT & GRAVITY — HEAVY, EXAGGERATED] Everything is dense and heavy, as if gravity were about one and a half times as strong. All motion runs at real-time speed. Airtime is short: jumps stay low, and anything that leaves the ground drops back almost at once, accelerating hard on the way down — a fall has only a few poses, spaced wider and wider toward the ground. Every ground contact is a hard hit: feet plant flat and lock in place, knees and spine compress on landing, the body squashes and jolts on the impact frame, then recovers slowly and with visible effort. Running is heavy and pounding: the torso dips on every footfall, each step shoves off the ground, and the feet stay planted. A falling character slams down like a sack of wet sand and stays down for a beat.",
};

/**
 * The camera is ONE line of feel. The team's tests: naming a camera position, a path or numbers froze the
 * camera (frames with a still background went from 12% to 70%); "handheld from the hand … breathing with
 * them" kept it flowing.
 */
const CAMERA_HANDHELD: Record<Cadence, string> = {
  full: "[CAMERA] Handheld from the hand, intimate and alive: a soft breathing sway that stays close on the characters, breathing with them.",
  stepped:
    "[CAMERA] The stepped cadence is only for what moves inside the frame, not the camera. Handheld from the hand, intimate and alive: a soft breathing sway that stays close on the characters, breathing with them.",
};
const cameraRig = (rig: string, cadence: Cadence) =>
  `[CAMERA] ${cadence === "stepped" ? "The stepped cadence is only for what moves inside the frame, not the camera. " : ""}The camera move is as directed above (${rig}): quiet and purposeful, alive.`;

const SOUND =
  "[SOUND] Only natural sound and the sound effects that occur in the scene, with no music, all at natural pitch. Impacts sound heavy and low: deep thuds, hard footfalls, the forced breath of effort.";

/** Every reaction has a cause, in order: body first, then the heavier loose parts, then the lighter ones. */
const SECONDARY: Record<WeightLevel, string> = {
  natural:
    "[SECONDARY ACTION] Only loose elements already in the scene (hair, clothing, cloth, straps, accessories, fur). Every reaction has a cause, in order: the body first, then the heavier loose parts, then the lighter ones; they follow with a short delay and settle soon after the body stops.",
  heavy:
    "[SECONDARY ACTION] Only loose elements already in the scene (hair, clothing, cloth, straps, accessories, fur). Every reaction has a cause, in order: the body first, then the heavier loose parts (hoods, braids, cloaks), then the lighter ones (fringe, sleeves, strands of hair). They are heavy: they swing briefly, drop fast and settle. Nothing floats, nothing slides.",
  extra:
    "[SECONDARY ACTION] Only loose elements already in the scene (hair, clothing, cloth, straps, accessories, fur). Every reaction has a cause, in order: the body first, then the heavier loose parts (hoods, braids, cloaks), then the lighter ones (fringe, sleeves, strands of hair). They are pulled down hard: they swing briefly, drop fast, slap against the body on landing and settle with a short, stiff follow-through. Nothing floats, nothing slides.",
};

/** For models with a negative-prompt field (e.g. Kling on its own site); the app does not put these words in the prompt itself. */
export function negativePrompt(weight: WeightLevel = "heavy", cadence: Cadence = "full"): string {
  const common =
    (cadence === "stepped" ? "smooth interpolation, " : "") +
    "motion blur, morphing, melting shapes, gimbal-smooth camera, tripod shot, locked-off shot, background music, text, subtitles";
  const light =
    "slow motion, floating, floaty, weightless, low gravity, moon gravity, hovering, drifting, gliding, sliding feet, foot sliding, moonwalk, bouncy, slow fall, long hang time, hair floating, fabric fluttering slowly";
  return weight === "natural" ? `slow motion, floating, gliding, sliding feet, ${common}` : `${light}, ${common}`;
}

/** The block exactly as the studio wrote it (heavy weight, handheld camera, full cadence). */
export const STUDIO_CONSTRAINTS = constraintsFor(null);

/**
 * The constraints block for one video. The camera part follows the director's rig when they name one other
 * than handheld (Steadicam, gimbal, tripod, dolly …), instead of contradicting it.
 */
export function constraintsFor(rig: string | null, weight: WeightLevel = "heavy", cadence: Cadence = "full"): string {
  const secondary = cadence === "stepped" ? SECONDARY[weight].replace("[SECONDARY ACTION]", "[SECONDARY ACTION — also on ones]") : SECONDARY[weight];
  return [MOTION[cadence], WEIGHT[weight], rig ? cameraRig(rig, cadence) : CAMERA_HANDHELD[cadence], SOUND, secondary].join("\n\n");
}

/** The studio's earlier wording, still in many directors' texts: paragraphs repeating it are left out too. */
const LEGACY_BLOCKS = [
  "[MOTION] 2.5D & 3D animation. Only the timing is stop-motion: stepped cadence, 24fps, animated on ones — a new held pose every frame, moving in crisp frame-by-frame steps, with painterly & line boil.",
  "[WEIGHT & GRAVITY — HEAVY] Everything is dense and heavy. All motion runs at real-time speed. Airtime is short: jumps stay low and anything that leaves the ground drops back fast, accelerating on the way down. Every ground contact is a hard hit: feet plant flat and lock in place, knees and spine compress on landing, the body jolts on the impact frame, then recovers with visible effort. Running is heavy and pounding: the torso dips on every footfall, each step shoves off the ground, the feet stay planted.",
  "[CAMERA — NOT STOP-MOTION] The stepped cadence applies only to what moves inside the frame, not to the camera. The camera is a real HANDHELD camera held by a person: in every frame there is a small visible shake, irregular drift and a slight tilt, and in quiet beats it sways like breathing. Moves that follow the action are clear: they start half a beat late, overshoot slightly, and settle with a small wobble. On every heavy impact the camera takes a sharp jolt, as if the ground shook, then settles.",
  "[SECONDARY ACTION — also on ones] Only loose elements already in the scene (hair, clothing, cloth, straps, accessories, fur). They are heavy and pulled down by gravity: they swing with the main action, trail only briefly, drop fast, slap against the body on landing and settle quickly.",
].join("\n\n");
const LEGACY =
  "Constraints: stop-motion stepped cadence on ones at 24fps with painterly & line boil, every character, creature and moving object stepping pose to pose, never gliding. NO smooth interpolation, NO motion blur, NO morphing. NO MUSIC, only natural sound. SECONDARY ACTION on ones: whichever loose elements are present (hair, clothing, fabric, straps, accessories, fur) swinging, streaming and settling with follow-through. HANDHELD, quiet and purposeful, alive, never gimbal-smooth, never tripod-locked, not chaotic.";

/**
 * What kind of text a field holds decides which rules apply:
 * - motion: gestures, transitions (how the body moves)
 * - direction: the director's additional direction (camera, motion, light, sound); every line
 *   under a "CAMERA" title is camera talk, so a "smooth" Steadicam stays as written
 * - voice: voice description and line delivery ("부드럽게 말함" is a soft voice — kept)
 * - face: brows, eyes, mouth, notes ("부드러운 미소" is a look, not a motion — kept)
 */
export type FieldKind = "motion" | "direction" | "voice" | "face";

export type Adjustment = { where: string; rule: string; before: string; after: string };

/* ───────────── What the director's words ask of the camera ───────────── */

const CAMERA_MOVE = new RegExp(
  [
    // Korean
    "무빙",
    "줌\\s*(?:인|아웃)",
    "카메라\\s*팬",
    "패닝",
    "틸트",
    "트래킹",
    "트래블링",
    "트랙\\s*(?:아웃|인)",
    "달리\\s*(?:인|아웃|샷|숏)",
    "푸시\\s*인",
    "풀\\s*(?:백|아웃)",
    "크레인",
    "지미집",
    "핸드\\s*[헬핼]드",
    "스테디\\s*캠",
    "짐벌",
    "카메라(?:가|를|도|는)?\\s*(?:천천히\\s*|빠르게\\s*|조금씩\\s*|계속\\s*)?(?:움직|이동|따라|다가|돌|흔들|들어|빠지|밀|당기|물러|뒤로|앞으로|올라|내려|회전)",
    // English
    "\\bzoom",
    "\\bpan(?:s|ning)?\\b",
    "\\btilt(?:s|ing)?\\b",
    "\\btracking\\b",
    "\\btrack(?:s|ing)?[- ](?:in|out|back|forward|backward|left|right|alongside|with)\\b",
    "\\bdolly",
    "\\bpush(?:es|ing)?[- ]?in\\b",
    "\\bpull(?:s|ing)?[- ]?(?:out|back)\\b",
    "\\bcrane",
    "\\bjib\\b",
    "\\bboom(?:s|ing)?\\s+(?:up|down)\\b",
    "\\btruck(?:s|ing)?\\s+(?:left|right)\\b",
    "\\borbit",
    "\\barc(?:s|ing)?\\s+around\\b",
    "\\bhand-?held\\b",
    "\\bstea?dicam\\b",
    "\\bgimbal",
    "\\bdrone\\b",
    "\\bslider\\b",
    "\\btravel(?:l)?(?:s|ing|ed)?\\s+(?:straight\\s+)?(?:back|forward|backward|toward|away|along|around|left|right|in|out)\\b",
    "\\bcamera\\s+(?:slowly\\s+|steadily\\s+)?(?:moves?|follows?|pushes|pulls|orbits|tracks|drifts|travels|glides|rises|descends|circles|leads|backs)\\b",
    "\\b(?:moves?|moving)\\s+(?:straight\\s+)?(?:back|backward|forward|in|out)\\b",
  ].join("|"),
  "i",
);

/** Rigs other than handheld: when the director names one, it replaces the constraints' HANDHELD. */
const NON_HANDHELD_RIG =
  /\bstea?dicam\b|\bgimbal\b|\bstabili[sz]ed\b|\bgravity[- ]balanced\b|\btripod\b|\blocked[- ]?off\b|\bstatic\s+camera\b|\bdolly\b|\bcrane\b|\bjib\b|\bslider\b|\bdrone\b|스테디\s*캠|짐벌|삼각대|고정\s*카메라|카메라\s*고정|달리\s*(?:샷|숏|인|아웃)|크레인|지미집|슬라이더|드론/i;

/** A camera angle other than eye level. */
const ANGLE = /\blow[- ]angle\b|\bhigh[- ]angle\b|\boverhead\b|\bbird'?s[- ]eye\b|\bworm'?s[- ]eye\b|\bdutch\b|\btop[- ]down\b|로우\s*앵글|하이\s*앵글|부감|앙각|탑\s*뷰|버즈\s*아이/i;

/** An explicit background other than white ("BACKGROUND: …", "배경: …", "배경은 …", "against a …"). */
const BACKGROUND_SPEC = /(?:^|\n|[.。]\s*)\s*(?:background|backdrop|setting|배경)\s*(?:[:：=—-]|은|는|이|으로|is\b|of\b)|\bagainst\s+an?\s+\w+/i;
const WHITE = /흰|하얀|화이트|\bwhite\b|\bblank\b|\bplain\b|단색/i;

/** Sentences about the camera: the director's own words there are never rewritten by the motion rules. */
const CAMERA_TALK = new RegExp(`${CAMERA_MOVE.source}|${NON_HANDHELD_RIG.source}|${ANGLE.source}|\\bcamera\\b|\\blens\\b|\\bframing\\b|\\bshot\\b|\\btake\\b|카메라|렌즈|프레이밍|샷|숏|테이크`, "i");

/**
 * Korean sentences where the camera (or whoever holds it) is the one moving, with words in between:
 * "카메라가 핸드헬드로 인물을 중심으로 180도 회전한다", "촬영자가 들고 뛰면서 회전한다".
 * The camera has to be the subject ("카메라를 향해 몸을 돌린다" is the character moving), and a held
 * camera ("카메라는 고정된 채 …") is not a move.
 */
const KO_CAMERA_SUBJECT = /(?:카메라|촬영자|촬영\s*감독|촬영\s*기사)(?:가|는|도)(?![가-힣])/;
const KO_MOVE_VERB = /움직|이동|따라|다가|돌|회전|흔들|뛰|걸으|걸어|들어가|들어오|빠지|빠져|밀고|밀려|당기|물러|뒤로|앞으로|올라|내려|선회|공전|궤도|트랙|줌|패닝|틸트|크레인/;
const KO_STILL = /고정|정지|멈춰\s*있|멈춘\s*채|움직이지\s*않|움직임\s*(?:이\s*)?없|가만히|안\s*움직/;
function koreanCameraMove(text: string): boolean {
  return text.split(/(?<=[.!?。])\s+|\n+/).some((s) => {
    const at = s.search(KO_CAMERA_SUBJECT);
    return at >= 0 && KO_MOVE_VERB.test(s.slice(at)) && !KO_STILL.test(s);
  });
}

export const hasCameraMove = (texts: string[]) => texts.some((t) => CAMERA_MOVE.test(t) || koreanCameraMove(t));
/** The rig the director names (e.g. "Steadicam"), or null for none / handheld. */
export const directorRig = (text: string): string | null => text.match(NON_HANDHELD_RIG)?.[0] ?? null;
export const directorAngle = (text: string) => ANGLE.test(text);
/** True when the director describes a background that is not white. */
export function directorBackground(text: string): boolean {
  const m = BACKGROUND_SPEC.exec(text);
  if (!m) return false;
  const statement = text.slice(m.index, m.index + 120).split(/\n/).slice(0, 2).join(" ");
  return !WHITE.test(statement);
}

/* ───────────── Rules that keep the team's texts within the studio rules ───────────── */

type Rule = {
  id: string;
  /** shown to the team: what was changed and why */
  label: string;
  kinds: FieldKind[];
  /** does this text (a line or a clause) break the rule? */
  test: (t: string, kind: FieldKind) => boolean;
  /** the adjusted text ("" removes it) */
  apply: (t: string, kind: FieldKind) => string;
};

/** Collapse the gaps a removed word leaves behind ("돌리며 , 시선" → "돌리며, 시선"). Works within one line. */
const tidy = (t: string) =>
  t
    .replace(/[ \t]+([,，.;；!?。])/g, "$1")
    .replace(/([,，;；])[ \t]*([,，;；])/g, "$1")
    .replace(/^[ \t,，;；]+/, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const CUT_TEST =
  /컷\s*전환|컷(?:이|을)\s*(?:전환|바뀌|넘어가)|컷\s*(?:별로|마다)|(?:다음|이전|앞|첫|마지막|새|각)\s*컷|\bjump[- ]?cuts?\b|\b(?:hard\s+)?cut(?:s|ting)?\s+(?:to|into|away)\b|\b(?:per|each|every)\s+cut\b/i;
const MUSIC_STRICT = /배경\s*음악|BGM|사운드\s*트랙|soundtrack|background\s+music|\bmusic\b/i;
const MUSIC_ANY = /배경\s*음악|BGM|사운드\s*트랙|soundtrack|background\s+music|\bmusic\b|음악/i;
/** Gliding/morphing words with the particles that hang on them ("모핑처럼 자연스럽게" goes as a unit). */
const INTERP_SRC =
  "(?:모핑|디졸브|크로스\\s*페이드|모션\\s*블러|보간|글라이드|미끄러지듯|스르르|스르륵)(?:처럼|으로|로|하듯이?|하며|되며|되듯|과\\s*함께|와\\s*함께)?(?:\\s*자연스럽게)?|\\b(?:morph(?:ing|s|ed)?|dissolv(?:e|es|ing)|cross-?fad(?:e|es|ing)|motion\\s+blur|interpolat(?:e|ed|ion|ing)|glid(?:e|es|ing))\\b";
const SMOOTH_SRC = "(?:부드럽게|매끄럽게|부드러운|매끄러운|\\bsmooth(?:ly)?\\b|\\bseamless(?:ly)?\\b)\\s*";

/**
 * A word that is itself forbidden ("never gliding", "NO morphing", "모핑 없이", "BGM 금지") already agrees
 * with the constraints: removing it would leave "never." / "NO," behind.
 */
const NEG_BEFORE = /(?:\b(?:no|never|not|without|avoid|avoiding|zero|nor|non)\b|없이|금지|말고)[\s\-:]*(?:\w+[\s-]+){0,2}$/i;
const NEG_AFTER = /^\s*(?:없이|없는|없음|금지|하지\s*(?:말|않)|되지\s*않|않|은\s*없|는\s*없|이\s*없|가\s*없|을\s*쓰지|를\s*쓰지)/;
function negated(text: string, index: number, length: number) {
  return NEG_BEFORE.test(text.slice(Math.max(0, index - 30), index)) || NEG_AFTER.test(text.slice(index + length, index + length + 12));
}
/** Replace the matches of `src` that are not themselves negated. */
function removeUnnegated(t: string, src: string): string {
  return t.replace(new RegExp(src, "gi"), (m: string, ...rest: unknown[]) => {
    const offset = rest.find((x) => typeof x === "number") as number;
    return negated(t, offset, m.length) ? m : "";
  });
}
const hasUnnegated = (t: string, re: RegExp) => [...t.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].some((m) => !negated(t, m.index ?? 0, m[0].length));

const RULES: Rule[] = [
  {
    id: "cut",
    label: "‘컷’ 표현을 구간·표정 전환으로 바꿈 (컷 없는 한 쇼트)",
    kinds: ["motion", "direction", "voice", "face"],
    test: (t) => CUT_TEST.test(t),
    apply: (t) =>
      t
        .replace(/컷\s*전환/g, "표정 전환")
        .replace(/컷(?:이|을)\s*(전환|바뀌|넘어가)/g, "표정이 $1")
        .replace(/컷\s*(별로|마다)/g, "구간$1")
        .replace(/(다음|이전|앞|첫|마지막|새|각)\s*컷/g, "$1 구간")
        .replace(/\bjump[- ]?cuts?\b/gi, "change")
        .replace(/\b(?:hard\s+)?cut(?:s|ting)?\s+(?:to|into|away)\b/gi, "move on to")
        .replace(/\b(per|each|every)\s+cut\b/gi, "$1 beat"),
  },
  {
    id: "music",
    label: "음악 지시를 뺌 (제약: NO MUSIC, 자연음만)",
    kinds: ["direction", "motion", "voice"],
    // voice texts keep the plain word "음악" (e.g. "음악적인 억양"); only clear music-layer phrases go
    test: (t, kind) => hasUnnegated(t, kind === "voice" ? MUSIC_STRICT : MUSIC_ANY),
    apply: (t, kind) => {
      const re = kind === "voice" ? MUSIC_STRICT : MUSIC_ANY;
      const parts = t.split(/(?<=[,，;；.!?。])\s+/);
      const kept = parts.filter((p) => !hasUnnegated(p, re));
      return kept.length === parts.length ? t : kept.join(" ").replace(/[,，;；]\s*$/, "").trim();
    },
  },
  {
    id: "interp",
    label: "모핑·보간·모션 블러·미끄러지는 움직임 지시를 뺌 (제약: 포즈에서 포즈로 스텝 모션)",
    kinds: ["motion", "direction"],
    test: (t) => hasUnnegated(t, new RegExp(INTERP_SRC, "i")),
    apply: (t) => tidy(removeUnnegated(t, INTERP_SRC)),
  },
  {
    id: "smooth",
    label: "움직임의 ‘부드럽게·매끄럽게’를 뺌 (제약: NO smooth interpolation)",
    kinds: ["motion", "direction"],
    test: (t) => hasUnnegated(t, new RegExp(SMOOTH_SRC, "i")),
    apply: (t) => tidy(removeUnnegated(t, SMOOTH_SRC)),
  },
];

function applyRules(text: string, kind: FieldKind, cameraClause: boolean, applied: Set<string>, allowCuts = false): string {
  let t = text;
  for (const rule of RULES) {
    if (!rule.kinds.includes(kind)) continue;
    // a storyboard with cut panels: talk of cuts is the team's intent, not a slip
    if (allowCuts && rule.id === "cut") continue;
    // the director's camera sentences (a Steadicam that "glides smoothly") are the director's call
    if (cameraClause && (rule.id === "interp" || rule.id === "smooth")) continue;
    if (!rule.test(t, kind)) continue;
    const next = rule.apply(t, kind);
    if (next !== t) {
      applied.add(rule.label);
      t = next;
    }
  }
  return t;
}

/** A section title in a structured direction: "CAMERA", "SEQUENCE", "LIGHT:", "카메라:" … */
const SECTION_TITLE = /^\s*(?:[A-Z][A-Z0-9 &/'’()-]{1,30}|(?:카메라|촬영|조명|빛|사운드|소리|배경|연기|동작|시퀀스|제약|제약사항|구성)\s*(?:워크|연출)?)\s*[:：]?\s*$/;
const CAMERA_TITLE = /camera|카메라|촬영/i;

/**
 * Adjust one of the team's texts so it does not break a studio rule. Line
 * breaks are kept; only the parts that break a rule change. Each change is
 * recorded in `log` (one entry per field, with every rule that applied).
 */
export function reconcile(text: string, kind: FieldKind, where: string, log: Adjustment[], opts: { allowCuts?: boolean } = {}): string {
  const original = text.trim();
  if (!original) return original;
  const applied = new Set<string>();
  const lines = original.split("\n");
  // in the director's text, every line under a "CAMERA" title is about the camera
  let cameraSection = false;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    if (kind !== "direction") return applyRules(line, kind, false, applied, opts.allowCuts);
    if (SECTION_TITLE.test(line)) cameraSection = CAMERA_TITLE.test(line);
    const clauses = line.split(/(?<=[,，;；.!?。])\s+/);
    return clauses
      .map((c) => applyRules(c, kind, cameraSection || CAMERA_TALK.test(c), applied, opts.allowCuts))
      .filter((c) => c.trim() !== "")
      .join(" ")
      .replace(/[,，;；]\s*$/, "");
  });
  const result = out
    .filter((l, i) => l.trim() !== "" || !lines[i].trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (applied.size && result !== original) log.push({ where, rule: [...applied].join(" / "), before: original, after: result });
  return result;
}

const words = (t: string) => (t.toLowerCase().match(/[a-z0-9가-힣]{3,}/g) ?? []);

/**
 * Paragraphs of the director's text that only repeat the studio constraints (which close the prompt anyway)
 * are left out of the director's block, so the room goes to the beats. A paragraph stays when it adds
 * anything of its own (more than a few words the constraints do not have).
 */
export function dropConstraintRepeats(direction: string, where: string, log: Adjustment[]): string {
  if (!direction.trim()) return direction;
  const known = new Set([...words(constraintsFor(null)), ...words(constraintsFor(null, "heavy", "stepped")), ...words(LEGACY), ...words(LEGACY_BLOCKS)]);
  const paras = direction.split(/\n\s*\n/);
  const kept = paras.filter((p) => {
    const w = words(p.replace(/^\s*[A-Za-z가-힣 &]{2,30}\s*[:：]/, ""));
    if (w.length < 4) return true;
    const own = w.filter((x) => !known.has(x)).length;
    return own >= Math.max(1, Math.ceil(w.length * 0.1));
  });
  if (kept.length === paras.length) return direction;
  const result = kept.join("\n\n").trim();
  log.push({ where, rule: "제약사항과 같은 문단을 뺌 (프롬프트 맨 끝 제약사항에 이미 있음)", before: direction, after: result });
  return result;
}
