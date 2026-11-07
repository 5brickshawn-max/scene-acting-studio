"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { JobView } from "@/lib/types";
import type { JobKind } from "@/lib/ai/schemas";
import { mergeJobs, withTimeouts } from "@/lib/jobs";

const COLS = "id, kind, step, status, input, output, error, based_on_version, applied_version, created_at, finished_at, created_by";

/** AI jobs for one project. Polls while anything is queued or running. */
export function useJobs(projectId: string, initial: JobView[]) {
  const [jobs, setJobs] = useState<JobView[]>(() => withTimeouts(initial));
  const [requestError, setRequestError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const sb = supabaseBrowser();
    const [{ data }, { data: open }] = await Promise.all([
      sb.from("ai_jobs").select(COLS).eq("project_id", projectId).order("created_at", { ascending: false }).limit(60),
      // open proposals stay on screen even after many newer jobs
      sb.from("ai_jobs").select(COLS).eq("project_id", projectId).eq("status", "done").is("applied_version", null).order("created_at", { ascending: false }).limit(60),
    ]);
    if (data) setJobs(withTimeouts(mergeJobs(data as JobView[], (open ?? []) as JobView[])));
  }, [projectId]);

  // While jobs run, poll only those rows (small payload) and re-render only when something changed.
  const activeIds = jobs
    .filter((j) => j.status === "queued" || j.status === "running")
    .map((j) => j.id)
    .join(",");
  useEffect(() => {
    if (!activeIds) return;
    const ids = activeIds.split(",");
    const tick = async () => {
      const { data } = await supabaseBrowser().from("ai_jobs").select(COLS).in("id", ids);
      if (!data) return;
      // a Claude job running far too long is shown as stopped, which also ends its polling
      const byId = new Map(withTimeouts(data as JobView[]).map((j) => [j.id, j]));
      setJobs((js) => {
        let changed = false;
        const next = js.map((j) => {
          const n = byId.get(j.id);
          if (!n || (n.status === j.status && n.finished_at === j.finished_at)) return j;
          changed = true;
          return n;
        });
        return changed ? next : js;
      });
    };
    timer.current = setInterval(tick, 2500);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [activeIds]);

  const request = useCallback(
    async (kind: JobKind, step: number, opts: { message?: string; instruction?: string; characterId?: string } = {}) => {
      setRequestError(null);
      const res = await fetch(`/api/projects/${projectId}/ai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, step, ...opts }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRequestError(body.error ?? "AI 요청에 실패했습니다.");
        return null;
      }
      await refresh();
      return body.jobId as string;
    },
    [projectId, refresh],
  );

  const markApplied = useCallback(
    async (jobId: string, version: number) => {
      await supabaseBrowser().from("ai_jobs").update({ applied_version: version }).eq("id", jobId);
      setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, applied_version: version } : j)));
    },
    [],
  );

  return { jobs, request, refresh, markApplied, requestError, clearError: () => setRequestError(null) };
}

export type Jobs = ReturnType<typeof useJobs>;
