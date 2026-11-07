import { describe, expect, it } from "vitest";
import { createProjectData, parseProjectData, readProjectData } from "@/lib/domain/project";
import { buildEnglishSheet, englishStale, freshEnglish } from "@/lib/domain/english";
import { buildVideoHandoff } from "@/lib/domain/handoff";
import { mergeJobs, withTimeouts, STALE_JOB_MS } from "@/lib/jobs";
import type { JobView } from "@/lib/types";
import { setCharacter } from "./helpers";

/** The cases from the review document (오류 분석·수정 가이드), reproduced. */
describe("#1 영어 정리 cannot loop", () => {
  const scene = () => {
    const d = createProjectData("루프", 1);
    setCharacter(d, { name: "샤리", baseAssetId: "b", locks: "1. 금발", appearance: "열 살", outfit: "튜닉", style: "2D", voice: "쉰 목소리" });
    d.expressions.forEach((e, i) => (e.emotion = `감정${i}`));
    return d;
  };
  const out = (d: ReturnType<typeof scene>, voice: string, beats: number) => ({
    language: "Korean",
    style: "Soft 2D.",
    cast: [{ character: 1, look: ["blond hair"], outfit: "Tunic.", voice }],
    beats: d.expressions.slice(0, beats).map((_, i) => ({ panel: i + 1, emotion: "e", face: "f", body: "b", transition: "", delivery: "" })),
  });

  it("an empty piece written for the current Korean is 'no English', not stale", () => {
    const d = scene();
    d.english = buildEnglishSheet(d, out(d, "", 4));
    // before the fix: ["목소리"] forever, so 5단계 asked again on every saved version
    expect(englishStale(d)).toEqual([]);
    // the prompt uses the Korean voice instead
    expect(freshEnglish(d).cast.get(d.cast[0].id)?.voice).toBeNull();
    expect(buildVideoHandoff(d).prompt).toContain("Voice: 쉰 목소리.");
  });

  it("a beat the AI left out stays stale (asked once per distinct stale set, see video.tsx)", () => {
    const d = scene();
    d.english = buildEnglishSheet(d, out(d, "Hoarse voice.", 3));
    expect(englishStale(d)).toEqual(["4번 표정"]);
  });

  it("a real change of the Korean is still stale", () => {
    const d = scene();
    d.english = buildEnglishSheet(d, out(d, "", 4));
    d.cast[0].voice = "다른 목소리";
    expect(englishStale(d)).toEqual(["목소리"]);
  });
});

const job = (over: Partial<JobView>): JobView => ({
  id: "j",
  kind: "design_expressions",
  step: 1,
  status: "done",
  input: {},
  output: null,
  error: null,
  based_on_version: 1,
  applied_version: null,
  created_at: new Date().toISOString(),
  finished_at: null,
  created_by: null,
  ...over,
});

describe("#2 a Claude job stuck in running does not block its button forever", () => {
  it("shows Claude jobs older than the limit as failed, leaves Higgsfield jobs and fresh jobs alone", () => {
    const now = Date.now();
    const old = new Date(now - STALE_JOB_MS - 1000).toISOString();
    const [stuck, fresh, hf] = withTimeouts(
      [
        job({ id: "a", status: "running", created_at: old }),
        job({ id: "b", status: "running", created_at: new Date(now - 60_000).toISOString() }),
        job({ id: "c", kind: "hf_video", status: "running", created_at: old }),
      ],
      now,
    );
    expect(stuck).toMatchObject({ status: "failed" });
    expect(stuck.error).toContain("시간 안에 끝나지 않아");
    expect(fresh.status).toBe("running");
    expect(hf.status).toBe("running");
  });
});

describe("#14 open proposals stay on screen", () => {
  it("adds older unapplied proposals to the recent jobs, each once, newest first", () => {
    const recent = [job({ id: "n2", created_at: "2026-11-08T10:00:00Z" }), job({ id: "n1", created_at: "2026-11-08T09:00:00Z" })];
    const open = [job({ id: "n1", created_at: "2026-11-08T09:00:00Z" }), job({ id: "old", kind: "compose_scene", created_at: "2026-11-01T09:00:00Z" })];
    expect(mergeJobs(recent, open).map((j) => j.id)).toEqual(["n2", "n1", "old"]);
  });
});

describe("#6 unreadable stored data is flagged, never passed off as a real scene", () => {
  it("says when it fell back to a blank scene", () => {
    expect(readProjectData({ cast: "broken", expressions: 3 }).recovered).toBe(true);
    // old or partial data that can be upgraded is not a failure
    expect(readProjectData({ character: { name: "옛 작업" } }).recovered).toBe(false);
    expect(readProjectData(createProjectData("정상")).recovered).toBe(false);
    expect(parseProjectData({ cast: "broken" }).title).toBe("새 장면");
  });
});
