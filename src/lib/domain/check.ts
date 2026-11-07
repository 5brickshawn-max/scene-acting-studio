/**
 * Pre-render check (충돌 점검): everything that goes into the video, side by
 * side, before credits are spent. Instant and deterministic; the AI check
 * (check_prompt) looks for the subtler contradictions on top of this.
 * Each warning carries the fix the team can apply with one click, when there is one.
 */
import { hasCameraMove } from "./constraints";
import { VIDEO_PROMPT_TARGET, type VideoHandoff } from "./handoff";
import { castLabel, continuityAnchor, imageAspectFor, imageIsStale, timelineOrder, type ProjectData } from "./project";
import { estimateSpeechSeconds } from "./speech";
import { retime, timingMismatch } from "./timing";
import { englishStale } from "./english";

/** What a warning's button does (run in the browser on the current document). */
export type CheckFix =
  /** open the step where it is fixed (0-based step index) */
  | { kind: "goto"; step: number; label: string }
  /** stretch the time marks of 추가 연출 (a camera plan's "0–3s …") to the video's length */
  | { kind: "retime"; to: number; label: string; changes: string[] }
  /** put the scene's camera sentences into 추가 연출 */
  | { kind: "append_direction"; text: string; label: string }
  /** run the AI check, which also writes the fixed texts */
  | { kind: "ai_check"; label: string }
  /** write the English for the prompts (영어 정리) */
  | { kind: "english"; label: string };

export type CheckItem = {
  /** warn = look at it before rendering, fixed = resolved automatically, ok = checked and fine */
  level: "warn" | "fixed" | "ok";
  area: string;
  text: string;
  fix?: CheckFix;
};

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The scene's sentences that move the camera ("천천히 트랙아웃(클로즈업에서 바스트쇼트로)"). */
export function sceneCameraSentences(scene: string): string {
  return scene
    .split(/\n+|(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && hasCameraMove([s]))
    .join("\n");
}

const order0 = (d: ProjectData) => timelineOrder(d);

export function preRenderCheck(data: ProjectData, h: VideoHandoff): CheckItem[] {
  const items: CheckItem[] = [];
  const add = (level: CheckItem["level"], area: string, text: string, fix?: CheckFix) =>
    items.push(fix ? { level, area, text, fix } : { level, area, text });
  const director = data.video.extraDirection.trim();
  const duration = data.acting.duration;

  // ── the prompt's fixed frame ──
  add("ok", "한 쇼트", "‘컷 없는 한 쇼트’ 지시가 프롬프트 맨 앞에 있습니다.");
  if (h.prompt.endsWith(h.constraints)) add("ok", "제약사항", "스튜디오 제약사항이 프롬프트 맨 끝에 있습니다.");
  else add("warn", "제약사항", "스튜디오 제약사항이 프롬프트 맨 끝에 없습니다.");

  // ── the cast: who is in the shot, who speaks with which voice ──
  if (data.cast.length > 1) {
    add("ok", "출연진", `${data.cast.length}명이 한 화면에 나옵니다: ${data.cast.map((c) => castLabel(data, c.id)).join(", ")}. 대사마다 말하는 인물을 지정해 입 모양이 섞이지 않게 지시합니다.`);
    const speakers = new Set(
      data.dialogue.lines.filter((l) => l.line.trim()).map((l) => data.expressions.find((e) => e.id === l.expressionId)?.characterId),
    );
    const silent = data.cast.filter((c) => speakers.has(c.id) && !c.voice.trim());
    if (silent.length)
      add("warn", "목소리", `${silent.map((c) => castLabel(data, c.id)).join(", ")}의 목소리 설정이 없어 영상 모델이 목소리를 구분하지 못할 수 있습니다.`, { kind: "goto", step: 2, label: "3단계 대사로" });
    const shown = new Set(h.references.filter((r) => r.role === "expression").map((r) => r.expressionId));
    const left = order0(data).filter((e) => e.imageAssetId && !shown.has(e.id));
    if (!data.video.startFrameAssetId && left.length)
      add(
        "warn",
        "참고 그림 수",
        `영상 모델이 받는 참고 그림 수에 한도가 있어 표정 그림 ${left.length}장(${left.map((e) => `${data.expressions.indexOf(e) + 1}번`).join(", ")})은 첨부하지 않습니다. 인물 기본 그림 ${data.cast.length}장이 먼저 들어갑니다.`,
      );
  }

  // ── the director's direction wins over the app's general lines ──
  if (director) {
    if (h.prompt.includes("DIRECTOR'S DIRECTION")) add("ok", "추가 연출", `추가 연출이 줄이지 않고 그대로 들어갔습니다 (${director.length.toLocaleString("ko-KR")}자, 줄바꿈 유지).`);
    else add("warn", "추가 연출", "추가 연출이 프롬프트에 들어가지 않았습니다.");
  }
  for (const o of h.overrides) add("fixed", "추가 연출 우선", o);
  add(
    "ok",
    "카메라",
    h.overrides.some((o) => o.startsWith("카메라"))
      ? "카메라는 추가 연출을 따릅니다."
      : h.cameraMove
        ? "구간 설명에 카메라 움직임이 있어 제약사항대로 핸드헬드로 지시합니다."
        : "카메라 움직임 지시가 없어 정지 화면으로 지시합니다.",
  );
  // ── a camera plan written for another length than the video ──
  const planned = timingMismatch(director, duration);
  if (planned !== null)
    add(
      "warn",
      "추가 연출 시간",
      `추가 연출의 시간 표시는 ${planned}초 기준인데 영상은 ${duration}초입니다. ${
        planned < duration ? `${planned}초 뒤에는 카메라가 할 일이 정해져 있지 않습니다.` : `${duration}초 뒤의 지시는 영상에 담기지 않습니다.`
      }`,
      { kind: "retime", to: duration, label: `${duration}초에 맞추기`, changes: retime(director, duration).changes },
    );

  // ── 영어 정리: the design reaches the models as short English, not Korean cut to fit ──
  const notEnglish = englishStale(data);
  const toEnglish: CheckFix = { kind: "english", label: "AI로 영어 정리" };
  if (!data.english)
    add("warn", "영어 정리", "아직 영어 정리가 없어 구간 설명이 한국어로 줄여 들어갑니다. 영상 모델은 짧은 영어를 더 잘 따릅니다.", toEnglish);
  else if (notEnglish.length)
    add("warn", "영어 정리", `영어 정리 뒤에 바뀐 곳: ${notEnglish.join(", ")}. 그 부분은 한국어로 줄여 들어갑니다.`, toEnglish);
  else add("ok", "영어 정리", "구간 설명·목소리·특징이 짧은 영어로 들어갑니다.");

  // ── the team's texts adjusted to the studio rules ──
  for (const a of h.adjustments) add("fixed", a.where, a.rule);

  // ── things that will not reach the video unless moved ──
  const scene = data.expressionSetup.scene.trim();
  if (scene && hasCameraMove([scene]) && !hasCameraMove([director])) {
    const moves = sceneCameraSentences(scene);
    add(
      "warn",
      "상황 설정",
      "상황 설정에 카메라 움직임이 있지만 영상 프롬프트에는 들어가지 않습니다. 영상에 넣으려면 추가 연출에 적으세요.",
      moves ? { kind: "append_direction", text: moves, label: "추가 연출로 옮기기" } : undefined,
    );
  }

  // ── length ──
  if (h.prompt.length > (h.lengthTarget ?? VIDEO_PROMPT_TARGET))
    add(
      "warn",
      "길이",
      `프롬프트가 ${h.prompt.length.toLocaleString("ko-KR")}자로 깁니다. 영상 모델이 일부 지시를 놓칠 수 있으니 추가 연출이나 설계 문구를 줄여 보세요. AI가 앱 문장·제약사항과 겹치는 부분을 덜어 낸 안을 만들 수 있습니다.`,
      { kind: "ai_check", label: "AI로 줄일 안 만들기" },
    );
  else add("ok", "길이", `프롬프트 ${h.prompt.length.toLocaleString("ko-KR")}자.`);

  // ── expression images ──
  const order = timelineOrder(data);
  const framing = data.expressionSetup.framing;
  const missing = order.filter((e) => !e.imageAssetId);
  const stale = order.filter((e) => imageIsStale(e, framing, imageAspectFor(data)));
  const no = (id: string) => data.expressions.findIndex((x) => x.id === id) + 1;
  const toImages: CheckFix = { kind: "goto", step: 1, label: "2단계 표정 그림으로" };
  if (!data.video.startFrameAssetId) {
    if (missing.length) add("warn", "표정 그림", `그림이 없는 표정: ${missing.map((e) => `${no(e.id)}번`).join(", ")}. 그 구간은 참고 그림 없이 만들어집니다.`, toImages);
    if (stale.length) add("warn", "표정 그림", `구도·비율이 다른 그림: ${stale.map((e) => `${no(e.id)}번`).join(", ")}. 다시 생성하면 표정이 한 쇼트처럼 이어집니다.`, toImages);
    if (!missing.length && !stale.length) add("ok", "표정 그림", `표정 그림 ${order.length}장이 모두 지금 구도·비율입니다 (연결 기준: ${continuityAnchor(data) ? `${no(continuityAnchor(data)!.id)}번` : "없음"}).`);
  } else {
    add("ok", "표정 그림", "시작 프레임 방식이라 표정 그림은 첨부하지 않습니다.");
    if (data.video.endFrameAssetId) add("ok", "끝 프레임", "영상이 끝 프레임 장면에서 끝나도록 첨부합니다 (Kling 4.0·MiniMax H3. Seedance는 시작 프레임만 받음).");
  }
  if (data.video.endFrameAssetId && !data.video.startFrameAssetId)
    add("warn", "끝 프레임", "끝 프레임은 시작 프레임과 함께 쓸 때만 첨부됩니다. 지금은 참고 그림 방식이라 끝 프레임이 쓰이지 않습니다.");

  // ── dialogue against the timeline ──
  const tight = data.acting.segments
    .map((s, k) => {
      const line = data.dialogue.lines.find((l) => l.expressionId === s.expressionId)?.line ?? "";
      const need = estimateSpeechSeconds(line);
      return { k, need, have: s.end - s.start };
    })
    .filter((x) => x.need > x.have);
  if (tight.length)
    add("warn", "대사 시간", tight.map((x) => `${x.k + 1}번 구간: 대사에 약 ${x.need}초가 필요한데 ${r1(x.have)}초`).join(" · "), {
      kind: "goto",
      step: 3,
      label: "4단계 시간 분배로",
    });
  const n = data.acting.segments.length;
  if (n && duration / n < 2) add("warn", "표정당 시간", `표정당 ${r1(duration / n)}초로 짧아 전환이 급해질 수 있습니다.`, { kind: "goto", step: 1, label: "2단계 길이·표정 수로" });

  const allLines = data.dialogue.lines.map((l) => l.line).join(" ");
  if (/[가-힣]/.test(allLines) && /영어|english/i.test(data.dialogue.language))
    add("warn", "대사 언어", `대사 언어는 ${data.dialogue.language}인데 대사에 한글이 있습니다.`, { kind: "goto", step: 2, label: "3단계 대사로" });

  return items;
}
