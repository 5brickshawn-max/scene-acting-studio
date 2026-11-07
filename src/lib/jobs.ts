import type { JobView } from "@/lib/types";

/** Newest first, each job once: the recent jobs plus older proposals that are still open. */
export function mergeJobs(recent: JobView[], open: JobView[]): JobView[] {
  const seen = new Set(recent.map((j) => j.id));
  return [...recent, ...open.filter((j) => !seen.has(j.id))].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** A Claude job queued or running for this long is treated as stopped (the server closes it on the next visit). */
export const STALE_JOB_MS = 15 * 60_000;

/** Show a Claude job that has been "running" far too long as failed, so its button works again. */
export function withTimeouts(jobs: JobView[], now = Date.now()): JobView[] {
  return jobs.map((j) =>
    !j.kind.startsWith("hf_") && (j.status === "queued" || j.status === "running") && now - Date.parse(j.created_at) > STALE_JOB_MS
      ? { ...j, status: "failed" as const, error: "AI 작업이 시간 안에 끝나지 않아 멈췄습니다. 다시 시도하세요." }
      : j,
  );
}
