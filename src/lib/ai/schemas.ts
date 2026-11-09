import { z } from "zod";
import { FACING, GAZE, INTENSITY, PITCH, TILT } from "@/lib/domain/project";
import { AI_FIX_TARGETS, type CheckTextFix } from "@/lib/domain/fixes";
import { PRINCIPLE_KEYS } from "@/lib/domain/principles";

/** 2-3 priority animation principles for one beat (the field guide's rule: not all eight). */
const Principles = z
  .array(z.enum(PRINCIPLE_KEYS))
  .describe(
    "이 컷(표정)에서 가장 중요한 애니메이션 원칙 2~3개: squash_stretch(눌림·늘어남), anticipation(준비 동작), pose_to_pose(핵심 포즈 연결), follow_through(후속·시차 동작), slow_in_out(가속·감속), arcs(호 궤적), timing(시간 배분·홀드), staging(얼굴·손·목표물이 보이게)",
  );

/* Output schemas for each AI job. Panels are referenced by 1-based number so
 * the model never has to invent ids; the app maps numbers back to expressions
 * when a person applies the proposal. */

/** One analysis of the scene drawing: every cast member (by cast number) and the shared style. */
export const CharacterOut = z.object({
  summary: z.string().describe("한두 문장 요약"),
  characters: z
    .array(
      z.object({
        character: z.number().int().describe("인물 번호 (출연진 순서, 1부터)"),
        locks: z.string().describe("표정이 바뀌어도 절대 변하면 안 되는 식별 요소, 번호 목록"),
        appearance: z.string().describe("얼굴 비율, 눈·코·입, 피부, 머리"),
        outfit: z.string().describe("화면에 보이는 의상·장신구만"),
      }),
    )
    .describe("출연진 한 명마다 하나"),
  style: z.string().describe("장면 전체의 선, 채색, 명암, 색감"),
  questions: z.array(z.string()).describe("그림만으로 확신할 수 없는 점에 대한 확인 질문"),
});

/** 씬 구성: the scene composed from the scenario (and any material): the named characters, style, crowd and the opening. */
export const SceneComposeOut = z.object({
  summary: z.string().describe("이 장면을 어떻게 구성했는지 한두 문장"),
  characters: z
    .array(
      z.object({
        name: z.string().describe("인물 이름 (시나리오에 나온 그대로)"),
        locks: z.string().describe("그림에서 절대 변하면 안 되는 식별 요소, 번호 목록 (다른 인물과 구별되는 것부터)"),
        appearance: z.string().describe("나이대, 얼굴, 체형·키, 피부, 머리"),
        outfit: z.string().describe("의상과 장신구"),
        voice: z.string().describe("목소리: 나이·음색·속도·말투 (대사가 없는 인물은 빈 문자열)"),
      }),
    )
    .describe("이름이 있는 주요 인물 (대사하거나 이름으로 불리는 인물), 등장 순서대로"),
  extras: z.string().describe("이름 없는 군중·배경 인물 (없으면 빈 문자열)"),
  style: z.string().describe("장면 전체의 그림체: 선, 채색, 명암, 색감"),
  opening: z
    .string()
    .describe("첫 장면 묘사: 장소·시간·빛, 모든 주요 인물이 어디서 무엇을 하는지(얼굴이 보이게), 군중·소품 (3~5문장)"),
  questions: z
    .array(z.string())
    .describe("시나리오와 자료만으로 정할 수 없어 새로 정한 것이나 확인이 필요한 것 (팀이 이미 답한 질문은 다시 쓰지 않음, 없으면 빈 배열)"),
  scenario: z
    .string()
    .describe("팀의 확인 답변이 시나리오 글 자체를 바꾸라고 하면(예: '시나리오 내용 수정') 그 답을 반영해 고친 시나리오 전체, 아니면 빈 문자열"),
  duration: z.number().describe("장면 전체 길이(초). 시나리오에 타임코드가 있으면 그 길이, 없으면 대사·동작에 맞는 길이. 60초 이하"),
  shots: z
    .array(
      z.object({
        title: z.string().describe("쇼트 내용 한 줄 (예: 입술 특대 클로즈업)"),
        seconds: z.number().describe("이 쇼트의 길이(초)"),
        panels: z
          .array(z.string().describe("패널(콘티 칸) 한 줄 설명: 이 쇼트 안에서 카메라나 연기가 크게 달라지는 순간"))
          .describe("이 쇼트 안의 패널, 순서대로. 카메라가 한 구도에 머무는 쇼트는 1개, 쇼트 안에서 카메라가 움직여 구도가 바뀌면 바뀌는 구도마다 1개"),
      }),
    )
    .describe("쇼트(컷 분할) 구성, 순서대로. 쇼트와 쇼트 사이는 컷으로 끊김. 인물별 연기 방식이면 쇼트 1개(그 안의 패널 = 표정 비트)"),
});

/** Another character's acting at the same moment (group scenes). */
const ReactionOutItem = z.object({
  character: z.number().int().describe("인물 번호 (1부터)"),
  emotion: z.string(),
  intensity: z.enum(INTENSITY),
  brows: z.string(),
  eyes: z.string(),
  mouth: z.string().describe("말하지 않는 인물은 입을 다문 상태로"),
  gesture: z.string().describe("팔·손·어깨 동작 (클로즈업 구도면 빈 문자열)"),
  facing: z.enum(FACING),
  pitch: z.enum(PITCH),
  tilt: z.enum(TILT),
  gaze: z.enum(GAZE),
  body: z.enum(FACING),
});

export const ExpressionOutItem = z.object({
  character: z.number().int().describe("이 표정의 중심 인물(대사가 있으면 말하는 인물) 번호 (출연진 순서, 1부터). 한 명이면 1"),
  reactions: z
    .array(ReactionOutItem)
    .describe("여러 인물 장면: 같은 순간 나머지 인물 각각의 연기 (중심 인물 제외, 한 명마다 하나). 한 명 장면이면 빈 배열"),
  panel: z.number().int().nullable().describe("표정 참고 시트의 칸 번호(1부터). 참고 시트가 없으면 null"),
  emotion: z.string(),
  intensity: z.enum(INTENSITY),
  brows: z.string(),
  eyes: z.string(),
  mouth: z.string(),
  notes: z.string(),
  gesture: z
    .string()
    .describe("팔·손·어깨 동작: 어느 손이 어디에, 손 모양, 팔 위치 (클로즈업 구도면 빈 문자열)"),
  facing: z.enum(FACING),
  pitch: z.enum(PITCH),
  tilt: z.enum(TILT),
  gaze: z.enum(GAZE),
  body: z.enum(FACING),
  directionEvidence: z.string().describe("방향을 판단한 시각적 근거 (예: 오른쪽 귀가 보임, 코끝이 화면 왼쪽을 향함)"),
  principles: Principles,
});

export const ExpressionsOut = z.object({
  summary: z.string(),
  styleWarning: z
    .string()
    .nullable()
    .describe("표정 참고 시트의 그림체가 기본 그림과 크게 다르면 경고 문장, 아니면 null"),
  expressions: z.array(ExpressionOutItem),
});

/** Storyboard mode: the scene as successive panels, each described as a whole. */
export const StoryboardOut = z.object({
  summary: z.string(),
  continuity: z
    .string()
    .describe(
      "장면 전체의 연결 규칙(모든 컷이 지킴), 번호 목록: 1) 180도 축 — 주요 인물이 화면 어느 쪽에 서고 서로 어느 방향을 보는지 2) 장소의 지리 — 성문·벽·출구 등이 화면 어느 쪽에 있는지 3) 빛 방향·시간 4) 의상·소품의 상태 변화와 그 변화가 일어나는 컷(예: 4번 컷에서 숄을 건넴 → 5번 컷부터 아이가 숄을 듦) 5) 인물의 이동 경로(어디서 어디로)",
    ),
  panels: z.array(
    z.object({
      title: z.string().describe("컷 제목, 짧게 (예: 군중이 갈라지며 칼리엘라 등장)"),
      action: z.string().describe("이 순간 화면 전체에서 일어나는 일: 누가 어디서 무엇을 하는지, 군중·소품, 표정과 자세의 핵심 (2~4문장)"),
      camera: z.string().describe("이 컷의 카메라: 샷 크기·앵글·다음 컷까지의 움직임 (한 문장)"),
      state: z
        .string()
        .describe(
          "이 컷의 연결 상태(HU), '시작: … / 끝: …' 두 부분으로. 보이는 주요 인물마다 화면 위치(화면 기준 왼쪽·가운데·오른쪽, 앞·뒤)·몸과 시선 방향, 손(몸 기준 오른손·왼손)에 든 것, 발 접지, 동작 단계와 운동 방향, 감정·호흡, 빛이 오는 쪽. 시작은 바로 앞 컷의 끝과 같아야 함(첫 컷 제외)",
        ),
      speaker: z.number().int().describe("대사가 있으면 말하는 주요 인물 번호(1부터), 없으면 0"),
      principles: Principles,
      link: z
        .enum(["continuous", "cut"])
        .describe("앞 컷과의 연결: continuous = 같은 쇼트에서 카메라가 이어서 움직여 이 컷이 됨, cut = 컷 분할(장면이 끊기고 새 쇼트). 첫 컷은 continuous"),
    }),
  ),
});

export const SheetCheckOut = z.object({
  summary: z.string(),
  panelCountMatches: z.boolean(),
  issues: z.array(
    z.object({
      panel: z.number().int().nullable(),
      severity: z.enum(["high", "low"]),
      message: z.string(),
    }),
  ),
});

export const DialogueOut = z.object({
  summary: z.string(),
  voices: z
    .array(z.object({ character: z.number().int().describe("인물 번호 (1부터)"), voice: z.string().describe("그 인물의 목소리: 나이·음색·속도·말투·억양") }))
    .describe("대사가 있는 인물마다 하나"),
  lines: z.array(
    z.object({
      panel: z.number().int(),
      line: z.string(),
      meaning: z.string(),
      delivery: z.string(),
      vo: z.boolean().describe("보이스오버(속마음·내레이션·화면 밖 목소리)면 true — 화면 속 입은 움직이지 않음. 시나리오에 V.O.·속마음이라고 되어 있으면 true"),
    }),
  ),
});

export const ActingOut = z.object({
  summary: z.string(),
  duration: z.number(),
  segments: z.array(
    z.object({ panel: z.number().int(), start: z.number(), end: z.number(), transition: z.string() }),
  ),
});

export const PromptCheckOut = z.object({
  summary: z.string().describe("전체 판단 한두 문장 (한국어)"),
  conflicts: z.array(
    z.object({
      severity: z.enum(["high", "low"]).describe("high: 영상이 의도와 다르게 나올 가능성이 큼, low: 다듬으면 좋음"),
      where: z.string().describe("어디와 어디가 부딪히는지 (예: 추가 연출 ↔ 2번 구간 연기)"),
      problem: z.string().describe("무엇이 부딪히는지 (한국어, 구체적으로)"),
      suggestion: z.string().describe("어느 칸을 어떻게 고치면 되는지 (한국어)"),
      step: z
        .number()
        .int()
        .nullable()
        .describe("사람이 고칠 단계: 1 캐릭터, 2 표정, 3 대사, 4 액팅, 5 영상·추가 연출. 모르면 null"),
      fix: z
        .object({
          target: z
            .enum(AI_FIX_TARGETS)
            .describe(
              "direction: 추가 연출 / transition: 다음 표정으로 넘어가는 연기 / gesture: 팔·손 동작 / notes: 표정 메모 / delivery: 대사 말투 / voice: 목소리",
            ),
          expression: z
            .number()
            .int()
            .nullable()
            .describe("transition·gesture·notes·delivery는 표정 번호(1부터), voice는 인물 번호(1부터), direction은 null"),
          text: z.string().describe("그 칸에 들어갈 고친 글 전체 (원래 글을 통째로 바꿈). 고칠 곳 말고는 원래 글을 그대로 둠"),
        })
        .nullable()
        .describe("글 한 칸을 고쳐 풀리면 채움. 같은 칸은 한 번만. 그림·시간 배분·영상 길이처럼 글로 못 고치면 null"),
    }),
  ),
});

/** 영어 정리: the design as short English for the image and video prompts (see domain/english.ts). */
export const EnglishOut = z.object({
  language: z.string().describe("대사 언어의 영어 이름 (예: 고대 아랍어 → Classical Arabic)"),
  style: z.string().describe("장면 전체의 그림체(선·채색·명암), 영어 한 문장 (160자 이내)"),
  continuity: z.string().describe("스토리보드의 연결 규칙(180도 축·지리·빛·의상/소품 변화·동선)을 영어로 짧게, 번호 목록 그대로 (500자 이내). 스토리보드가 아니거나 규칙이 없으면 빈 문자열"),
  cast: z
    .array(
      z.object({
        character: z.number().int().describe("인물 번호 (1부터)"),
        look: z.array(z.string()).describe("그 인물을 다른 인물과 구별해 주는 식별 요소를 짧은 영어 명사구로, 중요한 순서로 최대 8개 (항목당 60자 이내)"),
        outfit: z.string().describe("화면에 보이는 의상·장신구, 영어 한 문장 (160자 이내)"),
        voice: z.string().describe("목소리(나이·음색·속도·말투), 영어 한 문장 (160자 이내). 목소리 설정이 없으면 빈 문자열"),
      }),
    )
    .describe("출연진 한 명마다 하나"),
  beats: z.array(
    z.object({
      panel: z.number().int().describe("표정 번호 (1부터)"),
      emotion: z.string().describe("감정, 영어 2~5단어"),
      face: z.string().describe("연기하는 인물의 눈썹·눈·입 연기, 영어 한 문장 (160자 이내)"),
      body: z.string().describe("중심 인물의 팔·손·어깨·몸 연기, 영어 한 문장 (120자 이내). 손이 화면에 안 보이는 구도면 빈 문자열"),
      others: z
        .array(
          z.object({
            character: z.number().int().describe("인물 번호 (1부터)"),
            emotion: z.string().describe("감정, 영어 2~5단어"),
            face: z.string().describe("눈썹·눈·입 연기, 영어 한 문장 (120자 이내)"),
            body: z.string().describe("팔·손·몸 연기, 영어 한 문장 (100자 이내). 손이 안 보이는 구도면 빈 문자열"),
          }),
        )
        .describe("여러 인물 장면: 중심 인물을 뺀 나머지 인물마다 하나. 한 명 장면이면 빈 배열"),
      transition: z
        .string()
        .describe("다음 표정으로 넘어가게 하는 몸의 동작(깜빡임·숨·고개 돌림·얼굴 앞을 지나는 손 등), 영어 한 문장 (100자 이내). 마지막 표정이면 빈 문자열"),
      delivery: z.string().describe("대사 말투, 영어 3~8단어. 대사가 없으면 빈 문자열"),
      state: z.string().describe("스토리보드: 이 컷의 연결 상태(화면 위치·보는 방향·이동·의상/소품 상태·빛), 영어 한 문장 (220자 이내). 스토리보드가 아니면 빈 문자열"),
    }),
  ),
});

export const JOB_KINDS = [
  "compose_scene",
  "analyze_character",
  "design_expressions",
  "check_sheet",
  "write_dialogue",
  "plan_acting",
  "check_prompt",
  "write_english",
  "consult",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STEP: Record<Exclude<JobKind, "consult">, number> = {
  compose_scene: 0,
  analyze_character: 0,
  design_expressions: 1,
  check_sheet: 1,
  write_dialogue: 2,
  plan_acting: 3,
  check_prompt: 4,
  write_english: 4,
};

export const JOB_LABEL: Record<JobKind, string> = {
  compose_scene: "씬 구성",
  analyze_character: "기본 그림 분석",
  design_expressions: "표정 설계",
  check_sheet: "표정 그림 검사",
  write_dialogue: "대사 작성",
  plan_acting: "액팅 타이밍 설계",
  check_prompt: "렌더 전 AI 점검",
  write_english: "영어 프롬프트 정리",
  consult: "상의",
};

/** Proposal schema the consult chat may return for a given step. */
export function proposalSchemaFor(step: number, storyboard = false) {
  switch (step) {
    case 0:
      return CharacterOut;
    case 1:
      return storyboard ? StoryboardOut : ExpressionsOut;
    case 2:
      return DialogueOut;
    case 3:
      return ActingOut;
    default:
      return null;
  }
}

export function consultSchemaFor(step: number, storyboard = false) {
  const p = proposalSchemaFor(step, storyboard);
  return z.object({
    reply: z.string(),
    proposal: p ? p.nullable().describe("내용 수정을 제안할 때만 채움. 질문에 답만 할 때는 null") : z.null(),
  });
}

export type CharacterOutT = z.infer<typeof CharacterOut>;
export type SceneComposeOutT = z.infer<typeof SceneComposeOut>;
export type ExpressionsOutT = z.infer<typeof ExpressionsOut>;
export type StoryboardOutT = z.infer<typeof StoryboardOut>;
export type SheetCheckOutT = z.infer<typeof SheetCheckOut>;
export type DialogueOutT = z.infer<typeof DialogueOut>;
export type ActingOutT = z.infer<typeof ActingOut>;
export type PromptCheckOutT = z.infer<typeof PromptCheckOut>;
export type EnglishOutT = z.infer<typeof EnglishOut>;
/** What is stored: each fix is tied on the server to the exact text it replaces (older results have no step/fix). */
export type PromptCheckResult = Omit<PromptCheckOutT, "conflicts"> & {
  conflicts: (Omit<PromptCheckOutT["conflicts"][number], "fix" | "step"> & { step?: number | null; fix?: CheckTextFix | null })[];
};
