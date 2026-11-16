"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AssetView } from "@/lib/types";
import type { JobKind } from "@/lib/ai/schemas";
import type { EnglishSheet } from "@/lib/domain/project";
import { englishStale } from "@/lib/domain/english";
import type { ProjectDoc } from "./use-project-doc";
import type { Jobs } from "./use-jobs";

type EditorCtx = {
  projectId: string;
  workspaceId: string;
  userId: string;
  canEdit: boolean;
  doc: ProjectDoc;
  jobs: Jobs;
  assets: Map<string, AssetView>;
  addAsset: (a: AssetView) => void;
  /** Saves pending edits first so the AI sees exactly what is on screen. */
  askAi: (kind: JobKind, step: number, opts?: { message?: string; instruction?: string; characterId?: string; checkKey?: string }) => Promise<string | null>;
  dismissed: Set<string>;
  dismiss: (jobId: string) => void;
  /**
   * 영어 정리 once, right before a picture or video is generated: when the design changed since the English was
   * made, write it again and wait until it is applied (false when it failed or took too long — the prompt then
   * falls back to the Korean for what changed).
   */
  ensureEnglish: () => Promise<boolean>;
};

const Ctx = createContext<EditorCtx | null>(null);

export function EditorProvider(props: {
  projectId: string;
  workspaceId: string;
  userId: string;
  canEdit: boolean;
  doc: ProjectDoc;
  jobs: Jobs;
  initialAssets: AssetView[];
  children: React.ReactNode;
}) {
  const [assets, setAssets] = useState(() => new Map(props.initialAssets.map((a) => [a.id, a])));
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { doc, jobs } = props;

  const addAsset = useCallback((a: AssetView) => setAssets((m) => new Map(m).set(a.id, a)), []);
  // whole-project jobs (English, checks): one at a time — a second request while one runs only adds load
  // (seven cards' "수정 완료" once started seven English write-ups at the same second)
  const inFlight = useRef(new Map<string, Promise<string | null>>());
  const askAi = useCallback<EditorCtx["askAi"]>(
    async (kind, step, opts) => {
      const single = kind === "write_english" || kind === "check_sheet" || kind === "check_acting";
      if (single) {
        const running = jobs.jobs.find((j) => j.kind === kind && (j.status === "queued" || j.status === "running"));
        if (running) return running.id;
        const pending = inFlight.current.get(kind);
        if (pending) return pending;
      }
      const run = (async () => {
        const ok = await doc.flush();
        if (!ok) return null;
        return jobs.request(kind, step, opts);
      })();
      if (single) {
        inFlight.current.set(kind, run);
        void run.finally(() => inFlight.current.delete(kind));
      }
      return run;
    },
    [doc, jobs],
  );
  const dismiss = useCallback((id: string) => setDismissed((s) => new Set(s).add(id)), []);

  const latest = useRef({ doc, jobs });
  latest.current = { doc, jobs };
  const ensureEnglish = useCallback(async () => {
    if (!props.canEdit) return true;
    const { doc: d } = latest.current;
    if (!d.data.expressions.length || (d.data.english && !englishStale(d.data).length)) return true;
    const id = await askAi("write_english", 4);
    if (!id) return false;
    const until = Date.now() + 4 * 60_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2000));
      const j = latest.current.jobs.jobs.find((x) => x.id === id);
      if (j?.status === "failed") return false;
      if (j?.status === "done" && j.applied_version !== null) {
        await latest.current.doc.flush();
        return true;
      }
    }
    return false;
  }, [askAi, props.canEdit]);

  // 영어 정리 is derived from the design (nothing to choose): apply it as soon as it arrives
  const applying = useRef(new Set<string>());
  useEffect(() => {
    if (!props.canEdit) return;
    const job = jobs.jobs.find((j) => j.kind === "write_english");
    const sheet = (job?.output as { sheet?: EnglishSheet } | null)?.sheet;
    if (!job || job.status !== "done" || job.applied_version !== null || !sheet || applying.current.has(job.id)) return;
    applying.current.add(job.id);
    void (async () => {
      const v = await doc.commit({ ...doc.data, english: sheet }, "ai_apply", "영어 프롬프트 정리 적용");
      if (v) await jobs.markApplied(job.id, v);
    })();
  }, [jobs, doc, props.canEdit]);

  const value = useMemo(
    () => ({
      projectId: props.projectId,
      workspaceId: props.workspaceId,
      userId: props.userId,
      canEdit: props.canEdit,
      doc,
      jobs,
      assets,
      addAsset,
      askAi,
      dismissed,
      dismiss,
      ensureEnglish,
    }),
    [props.projectId, props.workspaceId, props.userId, props.canEdit, doc, jobs, assets, addAsset, askAi, dismissed, dismiss, ensureEnglish],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useEditor() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor outside EditorProvider");
  return v;
}
