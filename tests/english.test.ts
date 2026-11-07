import { setCharacter } from "./helpers";
import { describe, expect, it } from "vitest";
import { approve, createProjectData, type ProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildVideoHandoff, languageEn } from "@/lib/domain/handoff";
import { buildEnglishSheet, englishStale, freshEnglish, textKey } from "@/lib/domain/english";
import { preRenderCheck } from "@/lib/domain/check";
import { applyTextFix, resolveFix } from "@/lib/domain/fixes";
import { EnglishOut } from "@/lib/ai/schemas";

/** A project written the way the team writes: long Korean, Classical Arabic lines. */
function project(): ProjectData {
  const d = createProjectData("아스파샤");
  setCharacter(d, {
    baseAssetId: "base-1",
    locks: "1. 머리색: 짙은 남색~인디고 블루(보라 기운). 허리 아래까지 오는 긴 생머리.\n2. 앞머리: 눈썹을 덮는 두꺼운 일자 앞머리.\n3. 머리띠: 금테를 두른 파란 밴드.",
    appearance: "큰 눈과 작은 입, 양 볼의 연보라색 원형 마크.",
    outfit: "흰색 크롭탑(스퀘어 넥, 금색 트림), 위팔의 금색 암밴드, 연한 파란 랩스커트.",
    style: "선: 가늘고 균일한 짙은 갈색 외곽선. 채색: 부드러운 셀 음영과 은은한 그라데이션. 명암: 낮은 대비.",
    voice: "20세 전후 젊은 여성. 차분하고 따뜻한 메조소프라노로, 중저음 쪽에 무게를 둡니다. 숨이 살짝 섞인 부드러운 음색입니다.",
  });
  d.expressionSetup.framing = "medium";
  const emotions = ["귀찮음·질린 짜증", "장난스러운 윙크", "민망함·움찔하는 질색", "터지는 웃음"];
  d.expressions = d.expressions.map((e, i) => ({
    ...e,
    emotion: emotions[i],
    brows: "눈썹 안쪽이 처지고 바깥쪽이 살짝 내려갑니다. 미간에 힘이 빠져 있습니다.",
    eyes: "눈꺼풀이 반쯤 내려온 상태로 시선이 옆으로 흘러갑니다.",
    mouth: "입을 벌려 긴 한숨을 내쉽니다.",
    notes: "참고 칸의 크게 벌어진 입은 과장이 심하니 입 폭을 1.2배 이내로 제한합니다.",
    gesture: "두 팔을 가슴 아래에서 느슨하게 팔짱 낍니다. 위팔의 금색 암밴드가 양쪽 다 보이게 합니다.",
    imageAssetId: `img-${i}`,
    imageFraming: "medium",
    imageAspect: "3:4",
  }));
  d.dialogue = {
    language: "고대 아랍어",
    lines: d.expressions.map((e, i) => ({
      expressionId: e.id,
      line: ["أُفٍّ… أَعَوْدًا؟", "إِنَّهُ سِرٌّ.", "إِيهٍ… لَا، أَعْفِنِي…", "آهْ، هَا هَا هَا!"][i],
      meaning: "또야?",
      delivery: "발음은 'Uffin… a-ʿawdan?'입니다. 0~0.6초에 'Uff'를 코와 입으로 내쉬는 한숨으로 처리하고, 끝을 올립니다.",
    })),
  };
  d.acting.duration = 8;
  d.acting.segments = d.expressions.map((e, i) => ({ expressionId: e.id, start: i * 2, end: i * 2 + 2, transition: "반쯤 감긴 눈으로 정지하던 중 1.6초 무렵 눈꺼풀이 천천히 올라가며 생기가 돌아옵니다." }));
  return d;
}

const OUT = {
  language: "Classical Arabic",
  style: "Thin even dark-brown outlines, soft cel shading with gentle gradients, low contrast.",
  cast: [
    {
      character: 1,
      look: ["long straight indigo-blue hair to below the waist", "thick blunt bangs over the brows", "gold-rimmed blue headband"],
      outfit: "White square-neck crop top with gold trim, gold armbands and a pale blue wrap skirt.",
      voice: "Young woman around twenty, calm warm mezzo-soprano with a soft breathy tone.",
    },
  ],
  beats: [1, 2, 3, 4].map((panel) => ({
    panel,
    emotion: ["weary annoyance", "playful wink", "squirming cringe", "bursting laughter"][panel - 1],
    face: "Half-lidded eyes drift aside, brows sag, lips part in a long tired sigh.",
    body: "Arms loosely folded under the chest, gold armbands visible on both arms.",
    transition: panel < 4 ? "Eyelids lift and she unfolds her arms toward the next pose." : "",
    delivery: "tired sigh, rising at the end",
  })),
};

describe("영어 정리 (English for the prompts)", () => {
  it("never sends a broken-off fragment, keeps transitions, and asks for acted (not morphed) changes", () => {
    const d = project();
    d.dialogue.lines[0].delivery = "after a 0.3-second silent smile, spoken low and warm with a long breath before the last word of the line";
    d.expressions[0].gesture = "화면 왼쪽 손(캐릭터 오른손, 금색 커프 팔찌 착용)을 손바닥을 편 채 초커 바로 아래 가슴 중앙에 가볍게 얹고 손가락을 모읍니다";
    const p = buildVideoHandoff(d).prompt;
    expect(p).not.toContain("(캐릭터 오른손.");
    expect(p).not.toMatch(/after a 0\.3-second silent\n/);
    expect(p).toContain("Each expression change is acted, not morphed");
    expect(p).toContain("The face shape, eye shape and size, nose, hairline and body proportions stay identical in every beat");
    expect(p).toContain("the character stays at the same distance, size and position in the frame");
    d.english = buildEnglishSheet(d, OUT);
    const en = buildVideoHandoff(d).prompt;
    const beats = en.slice(en.indexOf("\n\n1. "));
    expect(beats.match(/Into the next expression:/g)).toHaveLength(3);
    // the last beat moves into nothing
    expect(beats.slice(beats.indexOf("\n\n4. "))).not.toContain("Into the next expression");
  });

  it("is used only while the Korean it came from is unchanged, piece by piece", () => {
    const d = project();
    expect(englishStale(d)).toEqual(["유지할 특징", "의상", "목소리", "그림체", "대사 언어", "1번 표정", "2번 표정", "3번 표정", "4번 표정"]);
    d.english = buildEnglishSheet(d, OUT);
    expect(englishStale(d)).toEqual([]);
    expect(freshEnglish(d).beats.size).toBe(4);
    expect(textKey("가")).toBe(textKey("가"));
    expect(textKey("가")).not.toBe(textKey("나"));

    // the team edits expression 2's gesture: only that beat goes back to Korean
    d.expressions[1].gesture = "검지를 입술에 댑니다.";
    expect(englishStale(d)).toEqual(["2번 표정"]);
    const p = buildVideoHandoff(d).prompt;
    expect(p).toContain("1. 0–2 seconds: weary annoyance");
    expect(p).toContain("2. 2–4 seconds: 장난스러운 윙크");
    expect(p).toContain("팔·손: 검지를 입술에 댑니다.");

    // a render-check fix to a text also counts as a change
    const fix = resolveFix(d, { target: "transition", expression: 3, text: "몸은 제자리에 둔 채 고개만 돌립니다." })!;
    expect(englishStale(applyTextFix(d, fix, "x"))).toEqual(["2번 표정", "3번 표정"]);
  });

  it("gives the video model short English beats, the exact lines and an English language name", () => {
    const d = project();
    const korean = buildVideoHandoff(d);
    d.english = buildEnglishSheet(d, OUT);
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain('Say exactly (Classical Arabic): "إِنَّهُ سِرٌّ." — tired sigh, rising at the end');
    expect(h.prompt).toContain("Acting (moderate): Half-lidded eyes drift aside");
    expect(h.prompt).toContain("Into the next expression: Eyelids lift and she unfolds her arms toward the next pose.");
    expect(h.prompt).toContain("Keep visible: long straight indigo-blue hair to below the waist; thick blunt bangs over the brows");
    expect(h.prompt).toContain("Voice: Young woman around twenty, calm warm mezzo-soprano with a soft breathy tone.");
    expect(h.prompt).toContain("2. expression 1 (weary annoyance) — approved expression target");
    expect(h.prompt).not.toMatch(/[가-힣]{2,}\s*(?:강도|눈썹:|팔·손:)/);
    expect(h.prompt.length).toBeLessThanOrEqual(h.lengthTarget);
    expect(h.prompt.endsWith(h.constraints)).toBe(true);
    // the Korean fallback never breaks a sentence off with "…"
    expect(korean.prompt).toContain("Say exactly (Classical Arabic)");
    expect(korean.prompt).not.toContain("0~0…");
    // the delivery note ends at its first full sentence (the "…" left is the team's own pronunciation note)
    expect(korean.prompt).toContain("— 발음은 'Uffin… a-ʿawdan?'입니다.\n");
    expect(korean.prompt).not.toMatch(/[가-힣a-z]…\n/);
  });

  it("uses the English pieces in the expression image prompt (shorter for long Korean designs)", () => {
    const d = project();
    const before = buildExpressionHandoffs(d)[0].prompt;
    d.english = buildEnglishSheet(d, OUT);
    const after = buildExpressionHandoffs(d)[0].prompt;
    expect(after).toContain("Must keep: long straight indigo-blue hair to below the waist; thick blunt bangs over the brows");
    expect(after).toContain("Expression: moderate weary annoyance. Half-lidded eyes drift aside");
    expect(after).toContain("Body language: Arms loosely folded under the chest");
    expect(after).not.toContain("Appearance:");
    expect(after).not.toContain("짙은 남색");
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it("names more languages in English", () => {
    expect(languageEn("고대 아랍어")).toBe("Classical Arabic");
    expect(languageEn("아랍어")).toBe("Arabic");
    expect(languageEn("고대 그리스어")).toBe("Ancient Greek");
  });

  it("asks for the English in the render check until it is there and up to date", () => {
    let d = project();
    const item = () => preRenderCheck(d, buildVideoHandoff(d)).find((i) => i.area === "영어 정리")!;
    expect(item()).toMatchObject({ level: "warn", fix: { kind: "english", label: "AI로 영어 정리" } });
    d = { ...d, english: buildEnglishSheet(d, OUT) };
    expect(item().level).toBe("ok");
    d.cast[0].voice = "낮은 목소리";
    expect(item().text).toContain("목소리");
  });

  it("keeps the character 2D when the director asks for a real-world background", () => {
    let d = project();
    for (const s of [0, 1, 2, 3] as const) d = approve(d, s);
    d.video.extraDirection = "배경은 사막 (낮, 완만한 모래 언덕, 실사 스타일)";
    const h = buildVideoHandoff(d);
    expect(h.prompt).toContain("Keep the character in this 2D style (never photorealistic or 3D); only the background follows the DIRECTOR'S DIRECTION.");
    expect(h.overrides.join(" ")).toContain("배경만 추가 연출의 실사 스타일");
    d.video.extraDirection = "배경은 사막";
    expect(buildVideoHandoff(d).prompt).toContain("Stay in this 2D style; never photorealistic or 3D.");
  });

  it("the AI output schema takes the English sheet", () => {
    expect(EnglishOut.parse(OUT).beats).toHaveLength(4);
  });
});
