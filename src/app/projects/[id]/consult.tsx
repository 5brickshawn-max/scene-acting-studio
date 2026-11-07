"use client";
import { useEffect, useRef, useState } from "react";
import { STEPS } from "@/lib/domain/project";
import { useEditor } from "./editor-context";

const fmt = new Intl.DateTimeFormat("ko-KR", { timeStyle: "short" });

/** Chat with the AI about the current step. The only thing here is conversation;
 * step actions (analyse, design, …) live in the step itself. */
export function ConsultPanel({ step, onClose }: { step: number; onClose: () => void }) {
  const { jobs, askAi, canEdit } = useEditor();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const thread = jobs.jobs.filter((j) => j.kind === "consult" && j.step === step).slice().reverse();
  const pending = thread.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [thread.length, pending]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    const id = await askAi("consult", step, { message: text.trim() });
    setSending(false);
    if (id) setText("");
  }

  return (
    <aside className="card flex flex-col h-full max-h-[calc(100vh-120px)]" aria-label="AI와 상의">
      <div className="flex items-center justify-between p-4 border-b border-line">
        <div>
          <div className="eyebrow">{STEPS[step]} 단계</div>
          <h2 className="section-title">AI와 상의</h2>
        </div>
        <button className="btn btn-sm" onClick={onClose} aria-label="상의 패널 닫기">닫기</button>
      </div>
      <div ref={logRef} className="flex-1 overflow-y-auto p-4 space-y-4" aria-live="polite">
        {thread.length === 0 && (
          <p className="text-muted text-center py-8">
            이 단계에서 고민되는 점을 물어보세요.
            <br />
            수정이 필요하면 AI가 제안을 만들고, 적용 여부는 직접 정합니다.
          </p>
        )}
        {thread.map((j) => {
          const out = j.output as { reply?: string; proposal?: unknown } | null;
          return (
            <div key={j.id} className="space-y-2">
              <div className="ml-6 rounded-xl rounded-tr-sm bg-[#fff1e8] p-3">
                <div className="text-[13px] text-muted mb-1">나 · {fmt.format(new Date(j.created_at))}</div>
                <p className="whitespace-pre-wrap">{j.input.message}</p>
              </div>
              <div className="mr-6 rounded-xl rounded-tl-sm bg-[#f1f4ec] p-3">
                <div className="text-[13px] text-muted mb-1">AI</div>
                {j.status === "done" && <p className="whitespace-pre-wrap">{out?.reply}</p>}
                {(j.status === "queued" || j.status === "running") && <p className="text-muted">생각하는 중… 창을 닫아도 계속됩니다.</p>}
                {j.status === "failed" && <p className="text-err">{j.error}</p>}
                {j.status === "done" && out?.proposal ? (
                  <p className="mt-2 pill pill-accent">수정 제안을 단계 화면에 올렸습니다</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {jobs.requestError && <p className="notice notice-error mx-4">{jobs.requestError}</p>}
      {canEdit ? (
        <form onSubmit={send} className="p-4 border-t border-line space-y-2">
          <label htmlFor="consult-input" className="sr-only">AI에게 보낼 메시지</label>
          <textarea
            id="consult-input"
            className="textarea"
            rows={3}
            placeholder="예: 3번 표정은 더 당황스럽게, 대사는 짧게 바꿔줘"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-muted">Ctrl/⌘+Enter로 보내기</span>
            <button className="btn btn-primary" type="submit" disabled={sending || pending || !text.trim()}>보내기</button>
          </div>
        </form>
      ) : (
        <p className="p-4 text-muted border-t border-line">검토자는 대화를 볼 수만 있습니다. 의견은 단계 아래 ‘검토 의견’에 남기세요.</p>
      )}
    </aside>
  );
}
