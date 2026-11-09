import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { EditorProvider } from "@/app/projects/[id]/editor-context";
import { CharacterStep } from "@/app/projects/[id]/steps/character";
import { ExpressionStep } from "@/app/projects/[id]/steps/expressions";
import { DialogueStep } from "@/app/projects/[id]/steps/dialogue";
import { ActingStep } from "@/app/projects/[id]/steps/acting";
import { createProjectData, type ProjectData } from "@/lib/domain/project";
import type { ProjectDoc } from "@/app/projects/[id]/use-project-doc";
import type { Jobs } from "@/app/projects/[id]/use-jobs";
import type { AssetView } from "@/lib/types";

/** Render a step screen with an in-memory document (no Supabase). */
function render(data: ProjectData, step: ReactNode, initialAssets: AssetView[] = []): string {
  const doc = { data, version: 1, status: "saved", edit: () => {}, flush: async () => true, commit: async () => 2 } as unknown as ProjectDoc;
  const jobs = { jobs: [], request: async () => null, refresh: async () => {}, markApplied: async () => {}, requestError: null, clearError: () => {} } as unknown as Jobs;
  return renderToStaticMarkup(
    <EditorProvider projectId="p" workspaceId="w" userId="u" canEdit doc={doc} jobs={jobs} initialAssets={initialAssets}>
      {step}
    </EditorProvider>,
  );
}

function trio(): ProjectData {
  const d = createProjectData("셋의 대화", 3);
  d.cast = d.cast.map((c, i) => ({ ...c, name: ["칼리엘라", "브람", "세라"][i] }));
  return d;
}

const nav = { onNavigate: () => {} };

describe("step screens render for one and for several characters", () => {
  it("step 1: one scene picture, cast tabs, blocking preview and the shared style", () => {
    const html = render(trio(), createElement(CharacterStep, nav));
    expect(html).toContain("장면 기준 그림 (출연진 전원이 함께)");
    expect(html).toContain("① 씬 시놉시스·시나리오 (기준)");
    expect(html).toContain("AI로 씬 구성");
    expect(html).toContain("시나리오로 첫 장면 생성");
    expect(html).toContain("첫 장면 묘사");
    expect(html).toContain("이 인물 참고 자료 (선택)");
    expect(html).toContain("장면과 출연진을 정하세요");
    expect(html).toContain("화면 배치");
    expect(html).toContain("A · 칼리엘라");
    expect(html).toContain("C · 세라");
    expect(html).toContain("+ 인물 추가");
    expect(html).toContain("그림체와 색감 (장면 공통)");
    const solo = render(createProjectData("혼자"), createElement(CharacterStep, nav));
    expect(solo).not.toContain("화면 배치");
  });

  it("step 2: the lead picker and an acting panel for every character", () => {
    const html = render(trio(), createElement(ExpressionStep, nav));
    expect(html).toContain("중심 인물 (대사가 있으면 이 인물이 말함)");
    expect(html).toContain("A 칼리엘라 · 중심");
    expect(html).toContain('aria-label="C 세라"');
    expect(html).toContain("장면 그림 16:9");
    const solo = render(createProjectData("혼자"), createElement(ExpressionStep, nav));
    expect(solo).not.toContain("중심 인물");
    expect(solo).toContain("세로 3:4");
  });

  it("step 3: one voice per character and the speaker of each line", () => {
    const html = render(trio(), createElement(DialogueStep, nav));
    expect(html).toContain("목소리 · A 칼리엘라");
    expect(html).toContain("목소리 · C 세라");
    expect(html).toContain("말하는 인물: B 브람");
  });

  it("step 4: the actor on each timeline segment", () => {
    const html = render(trio(), createElement(ActingStep, nav));
    expect(html).toContain("A 칼리엘라 · ");
  });

  it("storyboard mode: crowd field in step 1, panel cards in step 2", () => {
    const d = createProjectData("광장", 2, "storyboard");
    d.cast = d.cast.map((c, i) => ({ ...c, name: ["칼리엘라", "브람"][i] }));
    const s1 = render(d, createElement(CharacterStep, nav));
    expect(s1).toContain("군중·배경 인물 (선택)");
    const asked = { ...d, cast: d.cast.map((c, i) => (i === 0 ? { ...c, questions: [{ question: "횃불을 껐습니다. 맞나요?", answer: "횃불을 넣어주세요" }] } : c)) };
    expect(render(asked, createElement(CharacterStep, nav))).toContain("답변 반영해 씬 구성 다시 제안 (답한 질문 1개)");
    expect(s1).toContain("주요 인물 (이름이 있는 인물)");
    expect(s1).not.toContain("화면 배치");
    const s2 = render(d, createElement(ExpressionStep, nav));
    expect(s2).toContain("콘티를 만드세요");
    expect(s2).toContain("장면 묘사 (이 순간 화면 전체)");
    expect(s2).toContain("러프 스케치 (선택)");
    expect(s2).toContain("러프 콘티 바로 생성");
    expect(s2).toContain("장면 연결 규칙");
    expect(s2).toContain("연결 상태 HU (시작 → 끝");
    expect(s2).toContain("우선 애니메이션 원칙 (2~3개");
    expect(s2).toContain("애니메이션 원칙·연속성 점검");
    expect(s2).toContain("연결성 우선: 앞 컷부터 한 장씩 차례로 생성");
    // step 4 of a storyboard: lengths only, the panel order is fixed
    const acting = render(d, createElement(ActingStep, nav));
    expect(acting).toContain("컷 순서는 2단계 콘티 순서 그대로입니다");
    expect(acting).not.toContain('aria-label="앞으로"');
    expect(s2).toContain("러프 콘티 전부 생성 (0컷)");
    expect(s2).toContain("앞 컷과의 연결");
    expect(s2).toContain("✂ 컷 분할 (새 쇼트)");
    expect(s2).toContain("쇼트 1");
    expect(s2).toContain("말하는 인물 (이 컷에 대사가 있을 때)");
    expect(s2).not.toContain("중심 인물");
    // with panels written, every panel offers its own sketch and the batch counts them
    const w = { ...d, expressions: d.expressions.map((e) => ({ ...e, action: "x" })) };
    const s3 = render(w, createElement(ExpressionStep, nav));
    expect(s3).toContain(`러프 콘티 전부 생성 (${w.expressions.length}컷)`);
    expect(s3.split("러프 콘티 생성").length - 1).toBe(w.expressions.length);
    // any number of shots: no cap, no merge button
    const many = { ...w, expressions: w.expressions.map((e, i) => ({ ...e, link: i ? ("cut" as const) : ("continuous" as const) })) };
    const s4 = render(many, createElement(ExpressionStep, nav));
    expect(s4).toContain(`쇼트 ${w.expressions.length}개`);
    expect(s4).not.toContain("합치기");
  });

  it("offers more named characters in storyboard mode than in character-by-character mode", () => {
    const story = createProjectData("광장", 4, "storyboard");
    expect(render(story, createElement(CharacterStep, nav))).toContain("+ 인물 추가");
    expect(render(story, createElement(CharacterStep, nav))).toContain("최대 8명");
    const cast = createProjectData("넷", 4, "cast");
    expect(render(cast, createElement(CharacterStep, nav))).not.toContain("+ 인물 추가");
  });

  it("shows the cast size controls: −/+, a remove button per character, and a way out when over the limit", () => {
    const six = createProjectData("대화", 6, "storyboard");
    six.cast = six.cast.map((c, i) => ({ ...c, name: `인물${i + 1}` }));
    const html = render({ ...six, mode: "cast" }, createElement(CharacterStep, nav));
    expect(html).toContain('aria-label="마지막 인물 빼기"');
    expect(html).toContain('aria-label="A 인물1 빼기"');
    expect(html).toContain('aria-label="F 인물6 빼기"');
    expect(html).toContain("스토리보드 방식으로 바꾸기");
    expect(html).toContain("최대 4명");
    const solo = render(createProjectData("혼자"), createElement(CharacterStep, nav));
    expect(solo).not.toMatch(/aria-label="A [^"]* 빼기"/);
    expect(solo).toContain("+ 인물 추가");
  });

  it("step 1 reopens on the tab the scene picture came from; step 2 offers a fresh redesign for the cut count", () => {
    const asset = (id: string, name: string) =>
      ({ id, kind: "base", name, mime: "image/png", sizeBytes: 1, width: 16, height: 9, projectId: "p", createdAt: "", url: "u", previewUrl: "u" }) as AssetView;
    const d = { ...createProjectData("사막", 1, "storyboard"), baseAssetId: "gen-1" };
    const generated = render(d, createElement(CharacterStep, nav), [asset("gen-1", "첫 장면 · GPT Image 2.5 · 1K")]);
    expect(generated).toMatch(/aria-pressed="true"[^>]*>시나리오로 첫 장면 생성/);
    const uploaded = render(d, createElement(CharacterStep, nav), [asset("gen-1", "my-drawing.png")]);
    expect(uploaded).toMatch(/aria-pressed="true"[^>]*>그림 올리기/);
    const s2 = render(d, createElement(ExpressionStep, nav));
    expect(s2).toContain("컷 6개·8초로 처음부터 다시 설계");
  });
});
