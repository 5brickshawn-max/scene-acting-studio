/**
 * The eight animation principles the team's field guide uses for AI video (5BRICKS AI Animation Field Guide):
 * per shot, pick the 2-3 that matter and describe them as visible movement. `en` is the movement instruction
 * the video prompt gets; `check` is the review question.
 */
export const PRINCIPLES = [
  {
    key: "squash_stretch",
    ko: "스쿼시 앤 스트레치",
    short: "눌림·늘어남",
    en: "on contact the body compresses briefly and recovers to its original proportions (head size, limb lengths and mass stay the same)",
    check: "착지·충격 전후에 같은 캐릭터, 같은 질량으로 보이는가?",
  },
  {
    key: "anticipation",
    ko: "안티시페이션",
    short: "준비 동작",
    en: "before the main action the character first looks at the target and visibly prepares (weight shifts, knees or arm draw back), then acts",
    check: "주동작 전에 무슨 행동을 할지 짐작할 수 있는가?",
  },
  {
    key: "pose_to_pose",
    ko: "포즈 투 포즈",
    short: "핵심 포즈 연결",
    en: "the key poses are joined by real movement through shoulders, elbows, hips and steps — never a dissolve from one picture to the next — and the end pose holds briefly",
    check: "핵심 포즈 사이에 실제 움직임이 보이는가?",
  },
  {
    key: "follow_through",
    ko: "팔로우 스루와 오버래핑",
    short: "후속·시차 동작",
    en: "the parts settle at different times: the torso stops first, then the arms; hair and cloth carry on, swing back once with a smaller swing and settle",
    check: "무엇이 먼저 멈추고 무엇이 늦게 멈추는지 읽히는가?",
  },
  {
    key: "slow_in_out",
    ko: "슬로우 인과 슬로우 아웃",
    short: "가속·감속",
    en: "the movement starts slowly, is fastest in the middle and slows down just before it arrives or touches",
    check: "속도가 바뀌는 지점이 동작의 목적과 힘에 맞는가?",
  },
  {
    key: "arcs",
    ko: "아크",
    short: "호 궤적",
    en: "hands and head travel on natural arcs around the joints (shoulder, elbow, neck) while limb lengths stay the same",
    check: "궤적이 연속적이며 관절과 동작의 목적에 맞는가?",
  },
  {
    key: "timing",
    ko: "타이밍과 스페이싱",
    short: "시간 배분",
    en: "a short pause to judge, effort building before the change, and the result pose held long enough to read",
    check: "중요한 감정과 동작을 관객이 읽을 시간이 있는가?",
  },
  {
    key: "staging",
    ko: "스테이징",
    short: "보여 주기",
    en: "the face, the hands and what they act on stay clearly visible and separated from the background; nothing important is hidden",
    check: "한 번 보았을 때 무엇이 가장 중요한지 분명한가?",
  },
] as const;

export type PrincipleKey = (typeof PRINCIPLES)[number]["key"];
export const PRINCIPLE_KEYS = PRINCIPLES.map((p) => p.key) as [PrincipleKey, ...PrincipleKey[]];
export const principleOf = (k: string) => PRINCIPLES.find((p) => p.key === k);
/** A shot gets two or three priority principles (the field guide's rule: not all eight at once). */
export const MAX_PRINCIPLES = 3;

/** The guide's action order: what the AI should spell out for every movement. */
export const ACTION_ORDER_KO = "시선 → 준비 → 행동 → 접촉 → 정착";

/** The seven things a hook-up (HU) records across a cut (연속성 안내서 04). */
export const HU_ITEMS_KO =
  "① 몸의 위치와 방향 ② 머리·시선 ③ 좌우 손의 위치와 역할(몸 기준) ④ 발의 접지와 체중 ⑤ 소품의 소유·방향·접촉 ⑥ 동작 단계와 운동 방향 ⑦ 감정·호흡";

/** Vague words the guide replaces with observable movement. */
export const VAGUE_WORDS = /자연스럽게|부드럽고 생동감|생동감 있게|역동적으로|멋있게|멋지게|3D처럼 입체적으로|naturally|dynamically|lively/i;
