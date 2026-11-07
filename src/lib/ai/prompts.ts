import { castLabel, FACING_LABEL, FRAMING_CUT, FRAMING_LABEL, GAZE_LABEL, imageAspectFor, INTENSITY_LABEL, POSITION_LABEL, type ProjectData } from "@/lib/domain/project";

export const BASE_SYSTEM = `당신은 2D 애니메이션 스튜디오의 장면 연기(씬 액팅) 디렉터입니다. 팀원과 함께 출연진 → 표정 → 대사 → 액팅 → 영상 프롬프트 순서로 한 장면을 정리합니다. 장면에는 인물이 1~4명 나오며, 모두 컷 없는 한 쇼트 안에 있습니다.

원칙:
- 모든 답은 한국어로, 실무자가 바로 쓸 수 있게 구체적으로 씁니다.
- 그림에서 보이지 않거나 확신할 수 없는 것은 지어내지 않습니다. 대신 확인 질문으로 남깁니다.
- 당신의 결과는 제안일 뿐이며, 사람이 검토하고 적용합니다.

방향 표기 규칙 (매우 중요):
- 왼쪽/오른쪽은 항상 "보는 사람의 화면 기준"입니다. 캐릭터 본인의 왼쪽/오른쪽이 아닙니다.
- facing(얼굴)과 body(몸)는 같은 5단계 척도: left_profile, left_3q, front, right_3q, right_profile.
  · 코끝과 얼굴 정면이 화면 왼쪽을 향하면 left_3q(또는 left_profile). 이때 보통 캐릭터의 오른쪽 뺨과 귀가 화면 오른쪽에 더 많이 보입니다.
  · 코끝과 얼굴 정면이 화면 오른쪽을 향하면 right_3q(또는 right_profile).
- gaze는 눈동자가 향하는 화면 방향, pitch는 턱의 위아래, tilt는 머리가 기울어진 화면 방향입니다.
- 여러 칸을 볼 때는 칸마다 독립적으로 판단하세요. 칸 사이에 방향이 반대로 바뀌는 경우가 흔합니다.

여러 인물 장면:
- 인물은 출연진 번호(1부터)와 이름으로 구분합니다. 인물마다 화면 위치(왼쪽·가운데·오른쪽)가 정해져 있고, 쇼트 내내 바뀌지 않습니다.
- 인물들은 장면 기준 그림 한 장에 함께 그려져 있고, 그림 속 위치·특징으로 구별합니다.
- 표정(비트)마다 모든 인물의 연기를 함께 정합니다. 중심 인물이 한 명 있고, 대사가 있으면 그 인물이 말합니다. 나머지 인물도 그 순간 각자의 감정·얼굴·자세·방향으로 연기합니다(말하지 않을 때는 입을 다묾).
- 상대를 바라보는 방향은 화면 위치로 정해집니다. 예: 화면 왼쪽 인물이 오른쪽 인물을 보면 얼굴은 right_3q 쪽, 시선은 right.`;

export const STEP_CONTEXT: Record<number, string> = {
  0: "1단계 출연진 — 장면 기준 그림(출연진 전원이 함께 있는 그림) 한 장을 기준으로 인물마다 유지할 특징, 외형, 의상을 정리하고, 장면의 그림체와 인물 위치를 정함",
  1: "2단계 표정 — 표정(비트)마다 중심 인물과 모든 인물의 감정, 얼굴 근육, 팔·손, 머리·시선·몸 방향을 함께 설계",
  2: "3단계 대사 — 표정별 대사(말하는 인물), 의미, 말투, 인물별 목소리",
  3: "4단계 액팅 — 표정 순서와 시간 배분, 전환 연기",
  4: "5단계 영상 프롬프트 — 영상 생성용 지시문 정리",
};

/** Compact text view of the project data relevant up to `step`. */
export function projectContext(d: ProjectData, step: number): string {
  const multi = d.cast.length > 1;
  const lines: string[] = [`장면 이름: ${d.title || "(없음)"}`, `출연진: ${d.cast.length}명`];
  d.cast.forEach((c, i) => {
    lines.push(
      [
        `인물 ${i + 1} (${castLabel(d, c.id)}) · 화면 위치 ${POSITION_LABEL[c.position]}`,
        `  유지할 특징: ${c.locks || "(없음)"}`,
        `  외형: ${c.appearance || "(없음)"}`,
        `  의상: ${c.outfit || "(없음)"}`,
      ].join("\n"),
    );
    const answered = c.questions.filter((q) => q.answer.trim());
    if (answered.length) lines.push(`  확인된 사항: ${answered.map((q) => `${q.question} → ${q.answer}`).join(" / ")}`);
  });
  lines.push(`그림체(장면 공통): ${d.style || "(없음)"}`);
  const actor = (id: string) => (multi ? `${castLabel(d, id)} · ` : "");
  if (step >= 1) {
    lines.push(`표정 개수: ${d.expressionSetup.count}`);
    lines.push(
      `표정 그림 구도: ${FRAMING_LABEL[d.expressionSetup.framing]} — ${FRAMING_CUT[d.expressionSetup.framing]}, ${imageAspectFor(d)}${
        multi ? " (표정마다 모든 인물이 들어간 장면 그림 한 장)" : ""
      } (표정들은 컷 없는 한 쇼트의 순간들)`,
    );
    lines.push(`영상 전체 길이: ${d.acting.duration}초 (고정, 표정당 평균 ${Math.round((d.acting.duration / Math.max(1, d.expressions.length)) * 10) / 10}초)`);
    if (d.expressionSetup.scene.trim()) lines.push(`상황 설정·기초 대사:\n${d.expressionSetup.scene.trim()}`);
    if (d.expressionSetup.instruction) lines.push(`표정 연출 지시: ${d.expressionSetup.instruction}`);
    d.expressions.forEach((e, i) => {
      const dir = e.direction;
      lines.push(
        `표정 ${i + 1}: ${actor(e.characterId)}${e.emotion || "(미정)"} · ${INTENSITY_LABEL[e.intensity]} · 눈썹 ${e.brows} · 눈 ${e.eyes} · 입 ${e.mouth} · ` +
          `얼굴 ${FACING_LABEL[dir.facing]} · 시선 ${GAZE_LABEL[dir.gaze]} · 몸 ${FACING_LABEL[dir.body]}${e.gesture ? ` · 팔·손 ${e.gesture}` : ""}${e.notes ? ` · ${e.notes}` : ""}`,
      );
      if (multi)
        for (const r of e.reactions)
          lines.push(
            `  같은 순간 ${castLabel(d, r.characterId)}: ${r.emotion || "(미정)"} · ${INTENSITY_LABEL[r.intensity]} · 눈썹 ${r.brows} · 눈 ${r.eyes} · 입 ${r.mouth} · ` +
              `얼굴 ${FACING_LABEL[r.direction.facing]} · 시선 ${GAZE_LABEL[r.direction.gaze]} · 몸 ${FACING_LABEL[r.direction.body]}${r.gesture ? ` · 팔·손 ${r.gesture}` : ""}`,
          );
    });
  }
  if (step >= 2) {
    lines.push(`대사 언어: ${d.dialogue.language}`);
    d.cast.forEach((c) => lines.push(`목소리 (${castLabel(d, c.id)}): ${c.voice || "(없음)"}`));
    d.expressions.forEach((e, i) => {
      const l = d.dialogue.lines.find((x) => x.expressionId === e.id);
      if (l) lines.push(`대사 ${i + 1}: ${multi ? `${castLabel(d, e.characterId)}: ` : ""}"${l.line}" (의미: ${l.meaning}; 말투: ${l.delivery})`);
    });
  }
  if (step >= 2) {
    d.acting.segments.forEach((s) => {
      const i = d.expressions.findIndex((e) => e.id === s.expressionId);
      lines.push(`구간 ${s.start}~${s.end}초: 표정 ${i + 1}${s.transition ? ` · 전환 ${s.transition}` : ""}`);
    });
  }
  // the director's own words, as written (the video prompt carries them whole)
  if (step >= 4 && d.video.extraDirection.trim()) lines.push(`추가 연출 (감독 지시, 5단계):\n${d.video.extraDirection.trim()}`);
  return lines.join("\n");
}

/**
 * How the expression design follows the team's scene (상황 설정·기초 대사).
 * Empty when no scene is written.
 */
export function sceneDesignNote(d: ProjectData, hasReferenceSheet: boolean): string {
  const scene = d.expressionSetup.scene.trim();
  if (!scene) return "";
  const n = d.expressionSetup.count;
  return [
    `아래 '상황 설정·기초 대사'의 장면을 연기하는 표정 ${n}개를 장면이 흘러가는 순서대로 설계하세요. 표정 1이 장면의 처음이고, 표정 ${n}이 끝입니다.`,
    `- 기초 대사가 있으면 대사마다 그 대사를 말하는 표정을 하나씩 배정하세요. 남는 표정은 첫 대사 전, 대사 사이, 마지막 대사 뒤의 반응(숨, 시선, 감정이 바뀌는 순간)으로 쓰고, 대사가 표정보다 많으면 감정이 이어지는 대사끼리 한 표정에 묶으세요.`,
    `- 대사의 겉뜻보다 속마음(서브텍스트)을 연기하도록 감정과 강도를 정하고, 표정끼리 감정이 장면의 흐름대로 이어지게 하세요.`,
    d.cast.length > 1
      ? `- 여러 인물 장면입니다. 표정마다 character에 중심 인물(대사가 있으면 말하는 인물) 번호를 적고, reactions에 같은 순간 나머지 인물 각각의 연기(감정·얼굴·팔손·방향)를 적으세요. 대사를 주고받는 흐름과 듣는 인물의 반응이 이어지게 하세요.`
      : "",
    `- notes는 이 표정이 맡는 장면 속 순간으로 시작하세요 (예: "대사 1 ‘…’을 말하는 순간", "대사 1과 2 사이의 반응"). 장면의 소품·환경(베일, 장신구, 빛, 바람 등)이 얼굴 연기에 주는 영향도 notes에 짧게 적으세요.`,
    hasReferenceSheet
      ? `- 표정 참고 시트에서 각 순간에 가장 잘 맞는 칸을 골라 panel에 적으세요(칸 순서와 표정 순서가 달라도 됩니다). 그 칸의 연기를 그대로 베끼지 말고 이 장면과 캐릭터에 맞게 조정하세요.`
      : "",
    `- 카메라 움직임·배경 같은 화면 연출은 표정 그림에 그리지 않습니다(표정 그림은 흰 배경). 연기에 필요한 부분만 반영하세요.`,
    d.cast.length > 1 ? `- 기초 대사에 말하는 사람이 적혀 있으면(예: "칼리엘라: …") 그 인물에게 배정하세요.` : "",
    ``,
    `상황 설정·기초 대사:\n${scene}`,
  ]
    .filter((x) => x !== "")
    .join("\n");
}

/** Step 3: the scene's basic lines are the dialogue — used as written, placed on the expressions that act them. */
export function sceneDialogueNote(d: ProjectData): string {
  if (!d.expressionSetup.scene.trim()) return "";
  return (
    `'상황 설정·기초 대사'에 기초 대사가 있으면 그 대사를 고치거나 다듬지 말고 그대로 쓰세요. 각 표정의 메모(장면 속 순간)에 맞춰 대사를 배치하고, 대사가 배정되지 않은 반응 표정은 line을 비우세요. ` +
    (d.cast.length > 1 ? `대사는 그 표정을 연기하는 인물이 말합니다. 기초 대사의 화자와 표정의 인물이 맞지 않으면 summary에 알려 주세요. ` : "") +
    `대사 언어 설정(${d.dialogue.language})과 기초 대사의 언어가 다르면 뜻과 리듬을 살려 설정한 언어로 옮기세요.`
  );
}
