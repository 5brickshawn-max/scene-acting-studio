-- A Higgsfield result is saved by whoever claims the job first (the server's poll loop or the
-- browser's nudge), so the same result is never stored twice.
alter table ai_jobs add column if not exists claimed_at timestamptz;
