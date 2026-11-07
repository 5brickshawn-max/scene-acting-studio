"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { CommentView } from "@/lib/types";
import { useEditor } from "./editor-context";

const fmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" });

/** Review comments — every role, including reviewers, can comment. */
export function Comments({ step }: { step: number }) {
  const { projectId, userId, doc } = useEditor();
  const [items, setItems] = useState<CommentView[]>([]);
  const [body, setBody] = useState("");
  const [target, setTarget] = useState("all");
  const [showResolved, setShowResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabaseBrowser()
      .from("review_comments")
      .select("id, step, target, body, resolved, author_email, created_at")
      .eq("project_id", projectId)
      .eq("step", step)
      .order("created_at", { ascending: true });
    setItems((data ?? []) as CommentView[]);
  }, [projectId, step]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const sb = supabaseBrowser();
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from("review_comments").insert({
      project_id: projectId,
      step,
      target,
      body: body.trim(),
      author_id: userId,
      author_email: u.user?.email ?? null,
    });
    if (error) return setError(error.message);
    setBody("");
    void load();
  }

  async function toggle(c: CommentView) {
    await supabaseBrowser().from("review_comments").update({ resolved: !c.resolved }).eq("id", c.id);
    void load();
  }

  const targetLabel = (t: string) => {
    if (t === "all") return "단계 전체";
    const i = doc.data.expressions.findIndex((e) => e.id === t);
    return i >= 0 ? `${i + 1}번 표정` : "삭제된 표정";
  };
  const open = items.filter((c) => !c.resolved);
  const shown = showResolved ? items : open;

  return (
    <details className="p-6 border-t border-line" open={open.length > 0}>
      <summary className="cursor-pointer section-title">검토 의견 <span className="text-muted font-normal">{open.length}개 열림</span></summary>
      <div className="space-y-3 mt-3">
      <div className="flex items-center justify-end gap-3">
        {items.length > open.length && (
          <button className="btn btn-sm btn-ghost" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "해결된 의견 숨기기" : `해결된 의견 ${items.length - open.length}개 보기`}
          </button>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((c) => (
            <li key={c.id} className={`rounded-lg border border-line p-3 ${c.resolved ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                <span className="pill">{targetLabel(c.target)}</span>
                <span>{c.author_email ?? "팀원"}</span>
                <span>{fmt.format(new Date(c.created_at))}</span>
                <button className="btn btn-sm btn-ghost ml-auto" onClick={() => toggle(c)}>
                  {c.resolved ? "다시 열기" : "해결됨으로 표시"}
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2 items-start">
        <select className="select w-auto" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="의견 대상">
          <option value="all">단계 전체</option>
          {step >= 1 &&
            doc.data.expressions.map((e, i) => (
              <option key={e.id} value={e.id}>
                {i + 1}번 표정{doc.data.cast.length > 1 ? ` · ${doc.data.cast.find((c) => c.id === e.characterId)?.name || "인물"}` : ""}
                {e.emotion ? ` · ${e.emotion}` : ""}
              </option>
            ))}
        </select>
        <textarea
          className="textarea flex-1 min-w-[240px] min-h-[44px]"
          rows={2}
          placeholder="검토 의견을 남기세요"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="검토 의견"
        />
        <button className="btn" type="submit">의견 남기기</button>
      </form>
      {error && <p className="notice notice-error">{error}</p>}
      </div>
    </details>
  );
}
