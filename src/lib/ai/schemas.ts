import { z } from "zod";
import { FACING, GAZE, INTENSITY, PITCH, TILT } from "@/lib/domain/project";
import { AI_FIX_TARGETS, type CheckTextFix } from "@/lib/domain/fixes";

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
});

export const ExpressionsOut = z.object({
  summary: z.string(),
  styleWarning: z
    .string()
    .nullable()
    .describe("표정 참고 시트의 그림체가 기본 그림과 크게 다르면 경고 문장, 아니면 null"),
  expressions: z.array(ExpressionOutItem),
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
    z.object({ panel: z.number().int(), line: z.string(), meaning: z.string(), delivery: z.string() }),
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
    }),
  ),
});

export const JOB_KINDS = [
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
  analyze_character: 0,
  design_expressions: 1,
  check_sheet: 1,
  write_dialogue: 2,
  plan_acting: 3,
  check_prompt: 4,
  write_english: 4,
};

export const JOB_LABEL: Record<JobKind, string> = {
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
export function proposalSchemaFor(step: number) {
  switch (step) {
    case 0:
      return CharacterOut;
    case 1:
      return ExpressionsOut;
    case 2:
      return DialogueOut;
    case 3:
      return ActingOut;
    default:
      return null;
  }
}

export function consultSchemaFor(step: number) {
  const p = proposalSchemaFor(step);
  return z.object({
    reply: z.string(),
    proposal: p ? p.nullable().describe("내용 수정을 제안할 때만 채움. 질문에 답만 할 때는 null") : z.null(),
  });
}

export type CharacterOutT = z.infer<typeof CharacterOut>;
export type ExpressionsOutT = z.infer<typeof ExpressionsOut>;
export type SheetCheckOutT = z.infer<typeof SheetCheckOut>;
export type DialogueOutT = z.infer<typeof DialogueOut>;
export type ActingOutT = z.infer<typeof ActingOut>;
export type PromptCheckOutT = z.infer<typeof PromptCheckOut>;
export type EnglishOutT = z.infer<typeof EnglishOut>;
/** What is stored: each fix is tied on the server to the exact text it replaces (older results have no step/fix). */
export type PromptCheckResult = Omit<PromptCheckOutT, "conflicts"> & {
  conflicts: (Omit<PromptCheckOutT["conflicts"][number], "fix" | "step"> & { step?: number | null; fix?: CheckTextFix | null })[];
};
