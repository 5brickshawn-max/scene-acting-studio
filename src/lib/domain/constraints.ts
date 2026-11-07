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

const MOTION =
  "Constraints: stop-motion stepped cadence on ones at 24fps with painterly & line boil, every character, creature and moving object stepping pose to pose, never gliding. NO smooth interpolation, NO motion blur, NO morphing. NO MUSIC, only natural sound.";
const SECONDARY =
  "SECONDARY ACTION on ones: whichever loose elements are present (hair, clothing, fabric, straps, accessories, fur) swinging, streaming and settling with follow-through.";
const CAMERA = "(If a camera move is specified) HANDHELD, quiet and purposeful, alive, never gimbal-smooth, never tripod-locked, not chaotic.";

/** The block exactly as the studio wrote it. */
export const STUDIO_CONSTRAINTS = [MOTION, SECONDARY, CAMERA].join("\n\n");


/**
 * The constraints block for one video. Unchanged unless the director names a
 * camera rig other than handheld (Steadicam, gimbal, tripod, dolly …): then the
 * camera sentence keeps its spirit but follows the director's rig instead of
 * contradicting it ("never gimbal-smooth" vs a Steadicam).
 */
export function constraintsFor(rig: string | null): string {
  if (!rig) return STUDIO_CONSTRAINTS;
  return [MOTION, SECONDARY, `(Camera move as directed above — ${rig} replaces HANDHELD) quiet and purposeful, alive, not chaotic.`].join("\n\n");
}

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

/** Split one line into clauses (keeping their punctuation), drop the ones that match. */
function dropClauses(line: string, re: RegExp): string {
  const parts = line.split(/(?<=[,，;；.!?。])\s+/);
  const kept = parts.filter((p) => !re.test(p));
  if (kept.length === parts.length) return line;
  return kept.join(" ").replace(/[,，;；]\s*$/, "").trim();
}

const CUT_TEST =
  /컷\s*전환|컷(?:이|을)\s*(?:전환|바뀌|넘어가)|컷\s*(?:별로|마다)|(?:다음|이전|앞|첫|마지막|새|각)\s*컷|\bjump[- ]?cuts?\b|\b(?:hard\s+)?cut(?:s|ting)?\s+(?:to|into|away)\b|\b(?:per|each|every)\s+cut\b/i;
const MUSIC_STRICT = /배경\s*음악|BGM|사운드\s*트랙|soundtrack|background\s+music|\bmusic\b/i;
const MUSIC_ANY = /배경\s*음악|BGM|사운드\s*트랙|soundtrack|background\s+music|\bmusic\b|음악/i;
/** Gliding/morphing words with the particles that hang on them ("모핑처럼 자연스럽게" goes as a unit). */
const INTERP_SRC =
  "(?:모핑|디졸브|크로스\\s*페이드|모션\\s*블러|보간|글라이드|미끄러지듯|스르르|스르륵)(?:처럼|으로|로|하듯이?|하며|되며|되듯|과\\s*함께|와\\s*함께)?(?:\\s*자연스럽게)?|\\b(?:morph(?:ing|s|ed)?|dissolv(?:e|es|ing)|cross-?fad(?:e|es|ing)|motion\\s+blur|interpolat(?:e|ed|ion|ing)|glid(?:e|es|ing))\\b";
const SMOOTH_SRC = "(?:부드럽게|매끄럽게|부드러운|매끄러운|\\bsmooth(?:ly)?\\b|\\bseamless(?:ly)?\\b)\\s*";

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
    test: (t, kind) => (kind === "voice" ? MUSIC_STRICT : MUSIC_ANY).test(t),
    apply: (t, kind) => dropClauses(t, kind === "voice" ? MUSIC_STRICT : MUSIC_ANY),
  },
  {
    id: "interp",
    label: "모핑·보간·모션 블러·미끄러지는 움직임 지시를 뺌 (제약: 포즈에서 포즈로 스텝 모션)",
    kinds: ["motion", "direction"],
    test: (t) => new RegExp(INTERP_SRC, "i").test(t),
    apply: (t) => tidy(t.replace(new RegExp(INTERP_SRC, "gi"), "")),
  },
  {
    id: "smooth",
    label: "움직임의 ‘부드럽게·매끄럽게’를 뺌 (제약: NO smooth interpolation)",
    kinds: ["motion", "direction"],
    test: (t) => new RegExp(SMOOTH_SRC, "i").test(t),
    apply: (t) => tidy(t.replace(new RegExp(SMOOTH_SRC, "gi"), "")),
  },
];

function applyRules(text: string, kind: FieldKind, cameraClause: boolean, applied: Set<string>): string {
  let t = text;
  for (const rule of RULES) {
    if (!rule.kinds.includes(kind)) continue;
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
export function reconcile(text: string, kind: FieldKind, where: string, log: Adjustment[]): string {
  const original = text.trim();
  if (!original) return original;
  const applied = new Set<string>();
  const lines = original.split("\n");
  // in the director's text, every line under a "CAMERA" title is about the camera
  let cameraSection = false;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    if (kind !== "direction") return applyRules(line, kind, false, applied);
    if (SECTION_TITLE.test(line)) cameraSection = CAMERA_TITLE.test(line);
    const clauses = line.split(/(?<=[,，;；.!?。])\s+/);
    return clauses
      .map((c) => applyRules(c, kind, cameraSection || CAMERA_TALK.test(c), applied))
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
