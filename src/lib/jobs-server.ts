/**
 * Claude jobs run after the response (`after()`); if the function is cut off (time limit, restart) the row
 * stays "running" and the step's AI button would stay disabled forever. Rows older than this are closed
 * as timed out. Higgsfield rows (hf_*) have their own recovery (the nudge in the higgsfield route).
 * Server only.
 */
import { supabaseAdmin } from "@/lib/supabase/server";

/** Longer than the AI route's time budget (800 s), so a job that can still finish is never closed. */
export const CLAUDE_JOB_TIMEOUT_MS = 15 * 60_000;
export const TIMEOUT_MESSAGE = "AI 작업이 시간 안에 끝나지 않아 멈췄습니다. 다시 시도하세요.";

export async function expireStaleClaudeJobs(projectId: string) {
  const before = new Date(Date.now() - CLAUDE_JOB_TIMEOUT_MS).toISOString();
  await supabaseAdmin()
    .from("ai_jobs")
    .update({ status: "failed", error: TIMEOUT_MESSAGE, finished_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .in("status", ["queued", "running"])
    .not("kind", "like", "hf_%")
    .lt("created_at", before);
}
