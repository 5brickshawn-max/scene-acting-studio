"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { parseProjectData, reopenFrom, type ProjectData, type StepIndex } from "@/lib/domain/project";

export type SaveStatus = "saved" | "dirty" | "saving" | "conflict" | "error";
type VersionKind = "save" | "approve" | "unapprove" | "ai_apply" | "restore";

type Draft = { baseVersion: number; data: ProjectData; at: string };
const draftKey = (id: string) => `fas:draft:${id}`;

function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(id: string, d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey(id), JSON.stringify(d));
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* storage unavailable: autosave to the server still works */
  }
}

/**
 * One document, one version line.
 * - Every edit marks the doc dirty and is mirrored to ONE local draft slot per project.
 * - Autosave runs 1.5s after the last edit with optimistic concurrency.
 * - On conflict nothing is duplicated: the user picks "load latest" or "save mine as newest".
 */
export function useProjectDoc(projectId: string, initial: { data: ProjectData; version: number }, readOnly: boolean) {
  const [data, setData] = useState(initial.data);
  const [version, setVersion] = useState(initial.version);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latestVersion: number } | null>(null);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);

  const dataRef = useRef(data);
  const versionRef = useRef(version);
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<number | false> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  dataRef.current = data;
  versionRef.current = version;

  // Offer to restore an unsaved local draft from a previous session.
  useEffect(() => {
    const d = readDraft(projectId);
    if (d && JSON.stringify(d.data) !== JSON.stringify(initial.data)) setPendingDraft(d);
    else writeDraft(projectId, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const save = useCallback(
    async (kind: VersionKind = "save", note: string | null = null, override?: ProjectData): Promise<number | false> => {
      if (readOnly) return false;
      if (savingRef.current) await savingRef.current;
      if (timer.current) clearTimeout(timer.current);
      const payload = override ?? dataRef.current;
      const run = (async () => {
        setStatus("saving");
        const { data: newVersion, error } = await supabaseBrowser().rpc("save_project", {
          p_project_id: projectId,
          p_expected_version: versionRef.current,
          p_data: payload,
          p_kind: kind,
          p_note: note,
        });
        if (error) {
          if (error.message.includes("version_conflict")) {
            setConflict({ latestVersion: Number(error.details) || versionRef.current + 1 });
            setStatus("conflict");
          } else {
            setError(error.message);
            setStatus("error");
          }
          return false;
        }
        versionRef.current = newVersion as number;
        setVersion(newVersion as number);
        if (override) {
          dataRef.current = override;
          setData(override);
        }
        if (dataRef.current === payload) {
          dirtyRef.current = false;
          writeDraft(projectId, null);
          setStatus("saved");
        } else {
          setStatus("dirty");
        }
        setError(null);
        return newVersion as number;
      })();
      savingRef.current = run;
      const ok = await run;
      savingRef.current = null;
      return ok;
    },
    [projectId, readOnly],
  );

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (dirtyRef.current && status !== "conflict") void save();
    }, 1500);
  }, [save, status]);

  /** Edit data belonging to `step`. Editing an approved step re-opens it (and later steps). */
  const edit = useCallback(
    (step: StepIndex, fn: (d: ProjectData) => ProjectData) => {
      if (readOnly) return;
      setData((prev) => {
        const next = reopenFrom(fn(prev), step);
        dataRef.current = next;
        writeDraft(projectId, { baseVersion: versionRef.current, data: next, at: new Date().toISOString() });
        return next;
      });
      dirtyRef.current = true;
      setStatus("dirty");
      schedule();
    },
    [projectId, readOnly, schedule],
  );

  /** Replace the whole document and save it immediately as a new version. */
  const commit = useCallback(
    async (next: ProjectData, kind: VersionKind, note: string | null) => save(kind, note, next),
    [save],
  );

  /** Flush pending edits before something depends on the saved version (AI jobs, hand-off). */
  const flush = useCallback(async () => {
    if (savingRef.current) await savingRef.current;
    if (dirtyRef.current) return save();
    return status !== "conflict";
  }, [save, status]);

  const resolveConflict = useCallback(
    async (choice: "load_latest" | "keep_mine") => {
      const sb = supabaseBrowser();
      const { data: p } = await sb.from("projects").select("current_version").eq("id", projectId).single();
      const latest = p?.current_version as number;
      if (choice === "load_latest") {
        const { data: v } = await sb
          .from("project_versions")
          .select("data")
          .eq("project_id", projectId)
          .eq("version", latest)
          .single();
        // keep mine in the single draft slot so it can still be recovered
        writeDraft(projectId, { baseVersion: versionRef.current, data: dataRef.current, at: new Date().toISOString() });
        const latestData = parseProjectData(v?.data);
        dataRef.current = latestData;
        versionRef.current = latest;
        setData(latestData);
        setVersion(latest);
        dirtyRef.current = false;
        setConflict(null);
        setStatus("saved");
      } else {
        versionRef.current = latest;
        setVersion(latest);
        setConflict(null);
        await save("save", `v${latest} 이후 충돌 — 내 변경으로 저장`);
      }
    },
    [projectId, save],
  );

  const restoreDraft = useCallback(
    (accept: boolean) => {
      if (accept && pendingDraft) {
        dataRef.current = pendingDraft.data;
        setData(pendingDraft.data);
        dirtyRef.current = true;
        setStatus("dirty");
        void save("save", "브라우저에 남은 변경 복원");
      } else {
        writeDraft(projectId, null);
      }
      setPendingDraft(null);
    },
    [pendingDraft, projectId, save],
  );

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  return {
    data,
    version,
    status,
    error,
    conflict,
    pendingDraft,
    edit,
    commit,
    flush,
    save,
    resolveConflict,
    restoreDraft,
  };
}

export type ProjectDoc = ReturnType<typeof useProjectDoc>;
