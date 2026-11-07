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
  it("step 1: cast tabs, blocking preview and the shared style", () => {
    const html = render(trio(), createElement(CharacterStep, nav));
    expect(html).toContain("장면과 출연진을 정하세요");
    expect(html).toContain("화면 배치");
    expect(html).toContain("A · 칼리엘라");
    expect(html).toContain("C · 세라");
    expect(html).toContain("+ 인물 추가");
    expect(html).toContain("그림체와 색감 (장면 공통)");
    const solo = render(createProjectData("혼자"), createElement(CharacterStep, nav));
    expect(solo).not.toContain("화면 배치");
  });

  it("step 2: actor picker, others' reaction and the scene aspect", () => {
    const html = render(trio(), createElement(ExpressionStep, nav));
    expect(html).toContain("연기하는 인물");
    expect(html).toContain("나머지 인물의 반응");
    expect(html).toContain("장면 그림 16:9");
    const solo = render(createProjectData("혼자"), createElement(ExpressionStep, nav));
    expect(solo).not.toContain("연기하는 인물");
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
});
