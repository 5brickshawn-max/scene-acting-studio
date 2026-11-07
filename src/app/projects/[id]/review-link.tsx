"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "./editor-context";
import { CopyButton } from "./ui";

const LIFETIMES = [
  { hours: 1, label: "1시간" },
  { hours: 24, label: "24시간" },
  { hours: 168, label: "7일" },
] as const;

const fmt = (t: number) => new Date(t).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

/** Make a read-only link to this project (no login needed), or cancel every link made so far. */
export function ReviewLinkDialog({ onClose }: { onClose: () => void }) {
  const { projectId, doc } = useEditor();
  const ref = useRef<HTMLDialogElement>(null);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function call(body: object) {
    const res = await fetch(`/api/projects/${projectId}/review-link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "실패했습니다.");
    return json;
  }

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      await doc.flush(); // the link shows the saved version, so save what is on screen first
      const j = await call({ action: "create", hours });
      setLink({ url: j.url, expiresAt: j.expiresAt });
    } catch (e) {
      setMsg({ error: true, text: e instanceof Error ? e.message : "링크를 만들지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  async function cancelAll() {
    if (!window.confirm("이 작업의 검토용 링크를 모두 끊을까요? 이미 보낸 링크는 더 이상 열리지 않습니다.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await call({ action: "cancel_all" });
      setLink(null);
      setMsg({ error: false, text: "이 작업의 검토용 링크를 모두 끊었습니다. 필요하면 새 링크를 만드세요." });
    } catch (e) {
      setMsg({ error: true, text: e instanceof Error ? e.message : "링크를 끊지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto rounded-xl p-0 w-[min(560px,96vw)] backdrop:bg-black/40">
      <div className="flex items-center justify-between p-4 border-b border-line">
        <h2 className="section-title">검토용 링크</h2>
        <button className="btn btn-sm" onClick={() => ref.current?.close()}>닫기</button>
      </div>
      <div className="p-5 space-y-4">
        <p>
          로그인 없이 이 작업을 <strong>보기만</strong> 할 수 있는 링크입니다. 설계 내용, 표정 그림과 영상, Higgsfield에 보내는 프롬프트, 생성 기록이
          보입니다. 수정은 할 수 없고 팀원 이메일은 보이지 않습니다.
        </p>
        <div>
          <div className="field-label">열려 있는 기간</div>
          <div className="seg" role="group" aria-label="열려 있는 기간">
            {LIFETIMES.map((l) => (
              <button key={l.hours} type="button" aria-pressed={hours === l.hours} onClick={() => setHours(l.hours)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" onClick={create} disabled={busy}>
          {busy ? "처리 중…" : link ? "새 링크 만들기" : "링크 만들기"}
        </button>
        {link && (
          <div className="space-y-2">
            <input
              readOnly
              className="input font-mono text-[13px]"
              value={link.url}
              aria-label="검토용 링크"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex flex-wrap gap-2">
              <CopyButton text={link.url} label="링크 복사" />
              <a className="btn btn-sm" href={link.url} target="_blank" rel="noreferrer">
                열어 보기 ↗
              </a>
            </div>
            <p className="field-help">
              {fmt(link.expiresAt)}까지 열립니다. 링크를 가진 사람은 누구나 볼 수 있으니 필요한 사람에게만 보내세요.
            </p>
          </div>
        )}
        {msg && <p className={`notice ${msg.error ? "notice-error" : "notice-ok"}`}>{msg.text}</p>}
        <div className="border-t border-line pt-4 space-y-2">
          <button className="btn btn-sm" onClick={cancelAll} disabled={busy}>
            이 작업의 링크 모두 끊기
          </button>
          <p className="field-help">보낸 링크를 기간이 끝나기 전에 막아야 할 때 씁니다.</p>
        </div>
      </div>
    </dialog>
  );
}
