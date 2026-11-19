"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { nextSceneData } from "@/lib/domain/project";
import { useEditor } from "./editor-context";

/** The name for the scene after this one: "몰리송 #2", "몰리송 #3" … */
function nextName(title: string, index: number) {
  const base = title.replace(/\s*#\d+\s*$/, "").trim() || "장면";
  return `${base} #${index + 1}`;
}

/**
 * 다음 장면 만들기: a new scene that continues this one (same cast, sheets, style, references, rules and video
 * settings; its first cut starts where this scene ends). The new scene opens right away.
 */
export function NextSceneButton() {
  const { doc, projectId, workspaceId, canEdit } = useEditor();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = doc.data.previous?.index ?? 1;
  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);
  if (!canEdit) return null;

  async function create() {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    await doc.flush();
    const { data, error } = await supabaseBrowser().rpc("create_project", {
      p_workspace_id: workspaceId,
      p_name: n,
      p_data: nextSceneData(doc.data, projectId, n),
    });
    setBusy(false);
    if (error) return setError("다음 장면을 만들지 못했습니다: " + error.message);
    router.push(`/projects/${data}`);
  }

  return (
    <>
      <button
        className="btn btn-sm"
        onClick={() => {
          setName(nextName(doc.data.title, index));
          setOpen(true);
        }}
      >
        다음 장면 만들기
      </button>
      {open && (
        <dialog ref={ref} onClose={() => setOpen(false)} className="m-auto rounded-xl p-5 w-[min(560px,94vw)] backdrop:bg-black/50">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <h2 className="section-title">다음 장면 만들기</h2>
            <p className="text-[14px] text-muted">
              이 장면에 이어지는 새 장면을 만듭니다. <strong className="text-ink">출연진(캐릭터 시트·특징·의상·목소리), 그림체·화풍 차원, 장면 기준 그림·참고 그림, 기초 자료(대본 PDF 등), 장면 연결 규칙,
              영상 설정</strong>은 그대로 가져오고, 시나리오·컷·대사·액팅·결과는 비어 있습니다. 새 장면의 첫 컷은 이 장면의 마지막 상태에서 이어지게 설계됩니다.
              기초 자료가 있으면 새 장면에서 ‘AI로 씬 구성’을 누를 때 자료 중 이 장면 다음 부분을 이어서 구성합니다.
            </p>
            <label className="block">
              <span className="field-label">새 장면 이름</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            {error && <p className="notice notice-error">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-sm" onClick={() => ref.current?.close()}>
                취소
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? "만드는 중…" : "만들고 열기"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
