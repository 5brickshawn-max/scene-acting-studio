"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { parseProjectData } from "@/lib/domain/project";
import type { VersionView } from "@/lib/types";
import { useEditor } from "./editor-context";

const KIND_LABEL: Record<VersionView["kind"], string> = {
  create: "생성",
  save: "저장",
  approve: "승인",
  unapprove: "승인 취소",
  ai_apply: "AI 제안 적용",
  restore: "되돌림",
};
const fmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });

/** Every save is a version. Restoring creates a NEW version — history is never rewritten
 * and no duplicate project is created. */
export function VersionHistory({ onClose, members }: { onClose: () => void; members: Map<string, string> }) {
  const { projectId, doc, canEdit, userId } = useEditor();
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<VersionView[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [onlyMilestones, setOnlyMilestones] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
    supabaseBrowser()
      .from("project_versions")
      .select("version, kind, note, created_at, created_by")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(300)
      .then(({ data }) => setItems((data ?? []) as VersionView[]));
  }, [projectId]);

  async function restore(v: number) {
    if (!window.confirm(`v${v} 내용으로 되돌릴까요? 현재 내용은 기록에 남아 있어 언제든 다시 돌아올 수 있습니다.`)) return;
    setBusy(v);
    await doc.flush();
    const { data } = await supabaseBrowser().from("project_versions").select("data").eq("project_id", projectId).eq("version", v).single();
    await doc.commit(parseProjectData(data?.data), "restore", `v${v}에서 되돌림`);
    setBusy(null);
    ref.current?.close();
  }

  const shown = (items ?? []).filter((v) => !onlyMilestones || v.kind !== "save" || v.note);
  return (
    <dialog ref={ref} onClose={onClose} className="ml-auto mr-0 my-0 h-full max-h-full w-[min(480px,100vw)] p-0 backdrop:bg-black/40">
      <div className="flex items-center justify-between p-4 border-b border-line">
        <h2 className="section-title">버전 기록</h2>
        <button className="btn btn-sm" onClick={() => ref.current?.close()}>닫기</button>
      </div>
      <div className="p-4 space-y-3">
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" className="size-4" checked={onlyMilestones} onChange={(e) => setOnlyMilestones(e.target.checked)} />
          승인·AI 적용·되돌림만 보기
        </label>
        {items === null ? (
          <p className="text-muted">불러오는 중…</p>
        ) : (
          <ol className="space-y-2">
            {shown.map((v) => (
              <li key={v.version} className="rounded-lg border border-line p-3 flex items-start gap-3">
                <div className="flex-1">
                  <div className="font-semibold">
                    v{v.version} · {KIND_LABEL[v.kind]}
                    {v.version === doc.version && <span className="pill pill-ok ml-2">현재</span>}
                  </div>
                  {v.note && <div className="text-[14px]">{v.note}</div>}
                  <div className="text-[13px] text-muted">
                    {fmt.format(new Date(v.created_at))} · {v.created_by === userId ? "나" : members.get(v.created_by ?? "") ?? "팀원"}
                  </div>
                </div>
                {canEdit && v.version !== doc.version && (
                  <button className="btn btn-sm" disabled={busy !== null} onClick={() => restore(v.version)}>
                    {busy === v.version ? "되돌리는 중…" : "이 버전으로 되돌리기"}
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </dialog>
  );
}
