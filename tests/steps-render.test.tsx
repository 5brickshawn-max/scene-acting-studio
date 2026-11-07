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

/** Render a step screen with an in-memory document (no Supabase). */
function render(data: ProjectData, step: ReactNode): string {
  const doc = { data, version: 1, status: "saved", edit: () => {}, flush: async () => true, commit: async () => 2 } as unknown as ProjectDoc;
  const jobs = { jobs: [], request: async () => null, refresh: async () => {}, markApplied: async () => {}, requestError: null, clearError: () => {} } as unknown as Jobs;
  return renderToStaticMarkup(
    <EditorProvider projectId="p" workspaceId="w" userId="u" canEdit doc={doc} jobs={jobs} initialAssets={[]}>
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
    expect(html).toContain("AI로 장면 기준 그림 분석");
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
    expect(s1).toContain("주요 인물 (이름이 있는 인물)");
    expect(s1).not.toContain("화면 배치");
    const s2 = render(d, createElement(ExpressionStep, nav));
    expect(s2).toContain("콘티를 만드세요");
    expect(s2).toContain("장면 묘사 (이 순간 화면 전체)");
    expect(s2).toContain("러프 스케치 (선택)");
    expect(s2).toContain("말하는 인물 (이 컷에 대사가 있을 때)");
    expect(s2).not.toContain("중심 인물");
  });

  it("offers more named characters in storyboard mode than in character-by-character mode", () => {
    const story = createProjectData("광장", 4, "storyboard");
    expect(render(story, createElement(CharacterStep, nav))).toContain("+ 인물 추가");
    expect(render(story, createElement(CharacterStep, nav))).toContain("최대 8명");
    const cast = createProjectData("넷", 4, "cast");
    expect(render(cast, createElement(CharacterStep, nav))).not.toContain("+ 인물 추가");
  });
});
