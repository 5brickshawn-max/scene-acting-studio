import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ReviewView } from "@/app/review/[token]/view";
import { createProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildVideoHandoff } from "@/lib/domain/handoff";
import type { ReviewBundle } from "@/lib/review-data";

describe("review page", () => {
  it("renders a two-character scene", () => {
    const d = createProjectData("결투 직전", 2);
    d.cast[0] = { ...d.cast[0], name: "칼리엘라", voice: "낮은 알토" };
    d.cast[1] = { ...d.cast[1], name: "브람", voice: "맑은 테너" };
    d.expressions[0].reactions[0].emotion = "노려보는 경계";
    const b = {
      project: { id: "p", name: "결투 직전", version: 3, updatedAt: new Date().toISOString() },
      link: { expiresAt: Date.now() + 3600_000 },
      data: d,
      assets: {},
      prompts: { expressions: buildExpressionHandoffs(d), video: buildVideoHandoff(d) },
      jobs: [],
      comments: [],
      versions: [],
    } as unknown as ReviewBundle;
    const html = renderToStaticMarkup(createElement(ReviewView, { b, dataUrl: "/api/review/x" }));
    expect(html).toContain("출연진 2명");
    expect(html).toContain("A 칼리엘라");
    expect(html).toContain("B 브람");
    expect(html).toContain("같은 순간 B 브람");
    expect(html).toContain("노려보는 경계");
    expect(html).toContain("목소리 (B 브람)");
  });
});
