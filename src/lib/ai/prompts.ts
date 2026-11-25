import { castLabel, FACING_LABEL, FRAMING_CUT, FRAMING_LABEL, GAZE_LABEL, imageAspectFor, INTENSITY_LABEL, POSITION_LABEL, type ProjectData } from "@/lib/domain/project";

export const BASE_SYSTEM = `당신은 애니메이션 스튜디오(장면마다 2D 또는 3D & 2.5D)의 장면 연기(씬 액팅) 디렉터입니다. 팀원과 함께 출연진 → 표정 → 대사 → 액팅 → 영상 프롬프트 순서로 한 장면을 정리합니다. 장면에는 인물이 1~4명 나오며, 모두 컷 없는 한 쇼트 안에 있습니다.

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

스토리보드 방식 장면 (모드가 '스토리보드'일 때):
- 표정(비트) 대신 컷(콘티의 한 칸)으로 다룹니다. 컷마다 그 순간 화면 전체를 한 장의 그림으로 정합니다: 장면 묘사(누가 무엇을 하는지, 군중 포함), 카메라, 말하는 인물.
- 인물별 얼굴 근육·방향은 따로 정하지 않고, 화면 위치도 컷마다 바뀔 수 있습니다.
- 스토리보드는 원 씬 원 컷입니다: 컷 분할 없는 하나의 쇼트이고, 컷(콘티 패널)은 그 쇼트 안의 순간·구도입니다. 카메라는 앞 패널이 끝난 위치에서 끊지 않고 이어서 움직여 다음 패널의 구도에 닿습니다.

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

/**
 * Acting principles from the Seedance 2.5 acting report (SH04_3 SHOT 1, Nov 2026): the emotion is the
 * protagonist, every change has a trigger, the eyes lead the head and the head leads the body, the
 * peak is a moving hold. The report's speed-up (movements in two-thirds of the time) is left out on
 * purpose: everything stays at real speed.
 * Brought over from Facial Acting Studio as it stood on 2026-11-25 (its rules against morphing, mirrored arms and
 * there-and-back looks included); the character-by-character mode uses them for every cast member.
 */
export const ACTING_PRINCIPLES = [
  "연기 원칙 (영상 연기 제작 리포트에서 효과가 확인된 방식):",
  "- 감정이 주인공입니다. 표정마다 감정 상태 하나를 정하고, 그 상태가 눈썹·이마·눈·몸에 어떻게 보이는지 씁니다. 한 얼굴로 굳지 않고 계속 살아 있는 연기입니다.",
  "- 상태가 바뀔 때마다 계기가 있습니다(원인 → 반응: 상대의 말, 눈에 들어온 것, 깊은 숨).",
  "- 바뀔 때는 눈이 먼저, 그다음 고개, 그다음 몸이 차례로 움직입니다. 한꺼번에 움직이지 않습니다.",
  "- 표정과 표정 사이는 사람의 관절을 따라 움직입니다. 고개는 목에서 돌고 어깨가 뒤따르며(고개가 한쪽에서 다른 쪽으로 돌 때는 정면을 지나 비낀 각도에 자리 잡음), 팔은 어깨 → 팔꿈치 → 손목 차례로 한 길로 움직이고 손은 화면 안에 보인 채 이동합니다. 손이 얼굴로 가거나 몸이 돌아서는 큰 변화는 0.5~1초쯤 걸립니다. 의상은 몸에 걸친 한 벌 그대로 따라오고, 관객을 가리키는 손은 팔 길이에서 몸과 같은 깊이에 둡니다.",
  "- 동작은 실제 속도 그대로, 무게가 실린 결과로 보여 줍니다(전체를 빠르게 하지 않음). 감정이 가장 높은 순간은 포즈를 멈추고 숨·어깨·눈만 움직이는 무빙 홀드로 시간을 줍니다.",
  "- 감정이 바뀌는 순간은 고개·어깨·팔이 분명하고 크게 움직입니다. 손의 작은 일(끈·머리카락·소품 만지작거림)은 무빙 홀드나 긴 멈춤에서만 씁니다. 멈춤은 대사 사이나 감정 정점처럼 필요한 곳에만 둡니다.",
  "- 한 상태가 3초 이상 이어지는 구간에도 몸이 크게 한 번 움직이는 순간을 넣습니다(무너질 듯 흔들림, 고개가 떨어짐, 무게 중심이 옮겨감, 어깨가 크게 들썩임). 숨·깜빡임만으로 채우지 않습니다. 감정 정점의 무빙 홀드는 예외입니다.",
  "- 숨과 깜빡임은 늘 살아 있습니다(2026-11-23): 말하기 전에 숨을 들이쉬고 말끝에 내쉬며, 가슴·어깨가 숨에 따라 오르내립니다. 깜빡임은 몇 초마다 자연스럽게, 감정이 바뀌는 순간에 한 번 더 합니다. 무빙 홀드에서도 숨과 깜빡임은 이어집니다.",
  // fine control of the face (2026-11-24): four parts, each on its own
  "- 얼굴 근육은 네 부분을 따로 정합니다: 눈썹(안쪽·꼬리·좌우 높이), 눈꺼풀(위·아래, 좌우의 열림과 힘), 눈동자(어디를 보고 언제 옮기는지, 고개와 따로), 볼 근육(올라감·굳음·떨림, 좌우). 표정 안에서 언제 어떻게 바뀌는지까지 씁니다.",
  // the details the team asked to see in every prompt (2026-11-24)
  "- 디테일: 눈동자가 먼저 대상에 가 닿고, 시선이 닿은 뒤에 턱이 올라오거나 고개·어깨가 차례로 따라갑니다. 감정이 흔들리면 시선도 잠깐 흔들립니다. 이름이나 힘준 말을 부른 직후 숨이 한 번 걸립니다. 마지막 모음을 끝까지 발음한 뒤에야 아랫입술이 한 번 떨리는 것처럼, 말이 끝난 뒤의 작은 반응을 둡니다.",
  "- 눈동자는 고개와 따로 자주 움직입니다: 고개는 그대로 두고 눈만 옆으로 흘끗 보기, 아래로 떨구기, 상대에게서 다른 곳으로 옮기기. 한 번 본 곳에는 잠깐 머뭅니다.",
  // 2026-11-24, the team: the eyes and the head went there and back too symmetrically (a glance away and back in
  // every beat, 3/4 → front → 3/4 → front across the expressions)
  "- 시선과 고개는 시계추처럼 왔다 갔다 하지 않습니다. 갔다가 같은 자리로 되돌아오는 왕복(렌즈 → 옆 → 렌즈 → 옆, 오른쪽 3/4 → 정면 → 오른쪽 3/4 → 정면), 좌우로 번갈아 가는 대칭(왼쪽 → 오른쪽 → 왼쪽), 같은 크기·같은 박자로 되풀이되는 움직임을 쓰지 않습니다. 한 번 옮긴 시선·고개는 그 자리에 머물거나 다른 곳으로 더 나아가고, 돌아와야 하면 처음과 다른 자리(높이·기울임·거리)에 다른 박자로 닿습니다. 눈이 떠났다 돌아오는 동작은 한 표정에 한 번까지이고, 표정마다 되풀이하지 않습니다.",
  "- 크기는 mm 같은 수치 대신 눈에 보이는 말로 씁니다(분명히 들림, 크게 우묵해짐, 살짝 처짐). 수치로 쓰면 표정이 미세해집니다.",
  "- 대사가 있는 구간은 손짓·시선·고개 동작을 대사의 특정 단어에 맞춥니다(예: '잠깐'에서 손바닥을 들고, '처음부터'에서 손바닥을 펼침). 힘주어 말하는 단어에서 동작이 일어납니다.",
  // from the team's live-action prompt examples (Z_1–Z_4, 2026-11-22): the gestures carried their meaning, the
  // intention drove them, and the attitude set their manner
  "- 표정마다 의도를 정합니다: 이 순간 인물이 상대(또는 자신)에게 바라는 것을 동사로(말을 멈추게 하려고, 기를 꺾으려고, 붙잡으려고). 손짓·고개·말투가 그 의도를 실행합니다.",
  "- 손짓·고갯짓은 말없이 전하는 뜻까지 정합니다(멈추라는 듯 두 손바닥을 듦, 되감듯 손을 굴림, '처음부터 말해 봐' 하고 손바닥을 펼침, '바로 저기' 하고 턱으로 가리킴, '됐어' 하며 눈을 굴림).",
  "- 같은 동작도 인물의 태도로 결이 달라집니다(여유·오만: 서두르지 않는 최소한의 동작, 다급함: 앞으로 쏠리는 몸, 망설임: 멈칫하는 손). 장면이 코믹하면 애니메이션식으로 과장한 연기(눈 굴림, 볼 부풀림, 과장된 으쓱)도 씁니다.",
  "- 하던 동작(씹기, 잔 들기)은 반응하는 동안에도 이어 가고, 말이 아닌 소리(한숨, 짧은 웃음, 콧소리)도 연기로 적습니다.",
  "- 시선은 방향과 양까지 정합니다(어디를 얼마나 오래 보고 언제 옮기는지).",
  "- 표정이 바뀌는 순간은 두 속도 중 하나입니다: 아주 천천히(얼굴이 한 부분씩 눈 → 눈썹·눈꺼풀 → 입, 몸도 함께 흘러감) 또는 빠른 스냅(숨을 들이쉬고 깜빡이는 짧은 준비 뒤 얼굴이 몇 프레임 만에 바뀜. 고개 각도는 그대로 두고, 다음 표정의 방향이 다르면 곧장 작게 감. 뒤따르는 것은 장신구·머리카락 끝이 한 번 흔들리고 멈추는 정도). 중간 속도로 스르르 바뀌면 얼굴이 녹듯 바뀝니다(모핑). 깨달음·충격·분노·결심은 스냅, 차오르는 슬픔·그리움·풀어짐은 천천히처럼 상황에 맞춰 고릅니다.",
  "- 표정 사이는 팀의 애니메이션 8원칙으로 잇습니다: 눈이나 숨이 먼저 바뀔 것을 예고하고(스냅의 준비는 숨과 깜빡임까지: 고개를 반대쪽으로 숙이거나 휘두르지 않음), 사이의 연기를 부위별로 차례로(눈썹이 풀림 → 숨을 내쉼 → 입꼬리가 올라감), 고개가 움직일 때는 목을 축으로 호를 그리며, 스냅 뒤에는 장신구·머리카락 끝이 한 번 흔들리고 멈추고, 바뀐 표정은 한 호흡 머물러 읽힌 뒤 다음 동작으로 갑니다.",
  "- 구도: 얼굴은 좌우 대칭인 정면으로 두지 않습니다. 고개를 조금이라도 돌리거나 기울여 비대칭으로 두고, 관객(렌즈)을 볼 때도 그 비낀 고개에서 봅니다. 기울였던 고개가 돌아오거나 관객 쪽으로 올 때도 한쪽으로 살짝 돌린 채로 씁니다(고개를 렌즈 정면으로 바로 세우는 동작은 쓰지 않음).",
  "- 왕관·보석·장신구가 반짝이거나 빛난다는 말은 쓰지 않습니다(영상에서 빛 효과가 됩니다). 장신구는 흔들림·부딪힘·자리 잡음으로 씁니다.",
  "- 좌우 얼굴의 긴장과 반응 강도를 다르게 설계하고, 그 차이를 고개·어깨·손까지 잇습니다. 표정마다 ① 감정과 반응 대상(무엇에 반응하는지) → ② 주도할 요소(눈·눈썹·입 중 하나) → ③ 좌우 긴장 차이 → ④ 고개·어깨·손 순서로 정합니다. 좌우는 화면 기준으로 씁니다.",
  "- 좌우 차이의 크기는 고개 방향을 따릅니다: 방향이 '정면'(정면에 가까운 각도)이면 양쪽이 거의 같고 한쪽이 아주 조금만 앞섭니다(한쪽 눈썹이 살짝 높고 한쪽 눈이 살짝 가늚). 정면에서는 차이가 그대로 다 보여서 크게 다르면 어색합니다. 차이를 분명하게 두는 것은 3/4·옆 각도이거나 한쪽 감정(비웃음·경멸·의심·능청)일 때입니다.",
  "- 눈썹: 양쪽의 높이·기울기·꺾임을 다르게 합니다. 한쪽은 올라가고 다른 쪽은 눌리는 식으로, 의심·당혹·분노 같은 복합 감정이 여기서 드러납니다.",
  "- 눈: 눈꺼풀이 열린 정도와 긴장을 좌우 다르게 합니다(한쪽은 크게 뜨고 다른 쪽은 좁힘). 눈동자 크기가 아니라 눈꺼풀 모양으로 조절하고, 두 눈은 같은 대상을 봅니다.",
  "- 입·볼·턱: 거울처럼 똑같지 않게, 그러나 어색하지 않게. 눈썹·눈이 앞서는 쪽의 입꼬리가 올라가거나 당겨지거나 처지고, 그쪽 볼이 함께 올라가며 턱도 따라 반응합니다. 화·경멸·비웃음·울음처럼 센 감정은 입 자체도 한쪽으로 기웁니다(그쪽 윗입술이 더 들려 이가 그쪽으로 더 보이거나, 입이 그쪽으로 당겨짐). 의심·능청도 한쪽이 분명하게. 대사를 말하는 입 모양은 크게 비틀지 않습니다. 기쁨·놀람·두려움·크게 웃음은 입은 거의 그대로 두고, 고개를 한쪽으로 조금 기울이고 눈썹·눈으로 차이를 줍니다.",
  "- 고개·어깨·손: 얼굴의 감정을 상체로 잇습니다. 고개의 기울기·회전·턱 높이가 감정을 따르고, 긴장한 쪽 어깨가 조금 올라가거나 안으로 모이며, 손도 같은 감정을 합니다(움츠린 손, 머리를 짚는 손, 쥔 주먹).",
  "- 어느 손을 쓸지: 몸이 3/4로 돌아 있으면 가슴·얼굴로 가는 손은 카메라에 가까운 손으로 정합니다(몸이 화면 오른쪽으로 돌면 화면 왼쪽 손, 화면 왼쪽으로 돌면 화면 오른쪽 손). 먼 쪽 손은 몸에 가려 그림에서 반대 손으로 바뀌기 쉽습니다. 이어지는 표정끼리는 같은 손을 이어 쓰고, 손을 바꿔야 하면 바꾸는 동작을 따로 씁니다.",
  // 2026-11-24, 칼리엘라: picture 1 had the screen-right hand on the chest and the other low, picture 2 the reverse
  // 2026-11-24: the rules against morphing (a small snap, no return, a slow change) had left the beats with breaths,
  // blinks and looks only; the head and hair stay calm and the body carries the size
  "- 고개와 머리카락은 차분하게 두고, 연기의 크기는 몸이 맡습니다. 표정마다 어깨가 들리거나 떨어지고, 상체가 기울거나 물러나고, 팔이 움직이는 크고 분명한 몸 동작을 한 번 넣습니다. 숨·깜빡임·시선만으로 표정을 채우지 않습니다.",
  "- 이웃한 표정에서 두 팔의 자세를 좌우로 맞바꾸지 않습니다(1번: 화면 오른쪽 손이 가슴·왼쪽 손이 아래 → 2번: 화면 왼쪽 손이 가슴·오른쪽 손이 아래 같은 거울 자세). 가슴·얼굴로 올라간 손은 다음 표정에서도 그 손이 일하고, 아래에 있던 팔은 아래에서 따로 반응합니다. 손·팔이 닿는 몸의 부위도 화면 기준으로 씁니다('가슴 왼쪽 심장 위'가 아니라 '화면 오른쪽 가슴, 심장 위').",
  "- 비대칭은 표정 근육(눈썹·눈꺼풀·입·볼)에서 만듭니다. 얼굴 생김새·비율은 캐릭터 그대로이고, 고개를 돌려서 생기는 원근 차이와 표정의 비대칭을 섞지 않습니다.",
  "- 눈은 자연스러운 크기를 지킵니다. 놀람도 조금만 커집니다.",
].join("\n");

/** Compact text view of the project data relevant up to `step`. */
export function projectContext(d: ProjectData, step: number): string {
  const multi = d.cast.length > 1;
  const story = d.mode === "storyboard";
  const lines: string[] = [
    `장면 이름: ${d.title || "(없음)"}`,
    `통제 방식: ${story ? "스토리보드(컷 단위 — 컷마다 장면 전체를 한 장으로)" : "인물별 연기"}`,
    `${story ? "주요 인물" : "출연진"}: ${d.cast.length}명`,
  ];
  d.cast.forEach((c, i) => {
    lines.push(
      [
        `인물 ${i + 1} (${castLabel(d, c.id)})${story ? "" : ` · 화면 위치 ${POSITION_LABEL[c.position]}`}`,
        `  유지할 특징: ${c.locks || "(없음)"}`,
        `  외형: ${c.appearance || "(없음)"}`,
        `  의상: ${c.outfit || "(없음)"}`,
      ].join("\n"),
    );
    const answered = c.questions.filter((q) => q.answer.trim());
    if (answered.length) lines.push(`  확인된 사항: ${answered.map((q) => `${q.question} → ${q.answer}`).join(" / ")}`);
  });
  if (story && d.extras.trim()) lines.push(`군중·배경 인물: ${d.extras.trim()}`);
  lines.push(`화풍 차원: ${d.dimension === "2d" ? "2D 애니메이션" : "3D & 2.5D 애니메이션"} (그림체는 이 차원을 따름)`);
  lines.push(`그림체(장면 공통): ${d.style || "(없음)"}`);
  if (d.previous)
    lines.push(
      `시퀀스: 이 장면은 앞 장면 '${d.previous.name}'에 이어지는 ${d.previous.index}번째 장면입니다. 앞 장면은 이렇게 끝났습니다: ${d.previous.endState || "(기록 없음)"}. ` +
        `이 장면의 첫 컷 '시작'은 이 상태에서 이어지게(같은 의상·소품·위치·빛, 바뀐다면 장면 사이의 시간 경과로 설명되게) 설계하세요.`,
    );
  const actor = (id: string) => (multi ? `${castLabel(d, id)} · ` : "");
  if (step >= 1 && story) {
    lines.push(`컷 수: ${d.expressionSetup.count} · 컷 그림 비율 ${imageAspectFor(d)}`);
    lines.push(`영상 전체 길이: ${d.acting.duration}초 (고정)`);
    if (d.expressionSetup.scene.trim()) lines.push(`상황 설정·기초 대사:\n${d.expressionSetup.scene.trim()}`);
    if (d.expressionSetup.continuity.trim()) lines.push(`장면 연결 규칙:\n${d.expressionSetup.continuity.trim()}`);
    d.expressions.forEach((e, i) => {
      lines.push(
        `컷 ${i + 1}: ${i > 0 ? "[이어짐] " : ""}${e.emotion || "(제목 없음)"} · 장면 묘사: ${e.action || "(없음)"}${
          e.camera ? ` · 카메라: ${e.camera}` : ""
        }${e.continuity ? ` · 연결 상태: ${e.continuity}` : ""} · 말하는 인물(대사가 있을 때): ${castLabel(d, e.characterId)}`,
      );
    });
  } else if (step >= 1) {
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
    `기초 대사는 하나도 빠짐없이 이 장면의 어느 ${d.mode === "storyboard" ? "컷" : "표정"}에든 넣으세요. 시나리오상 정확히 맞는 순간이 없으면 가장 가까운 순간에 넣고 summary에 알려 주세요. ` +
    `대사 언어 설정(${d.dialogue.language})과 기초 대사의 언어가 다르면 뜻과 리듬을 살려 설정한 언어로 옮기세요.`
  );
}
