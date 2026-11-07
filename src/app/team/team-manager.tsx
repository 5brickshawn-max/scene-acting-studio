"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type Member = { email: string; role: "admin" | "editor" | "reviewer"; user_id: string | null; created_at: string };

const ROLE_LABEL = { admin: "관리자", editor: "편집자", reviewer: "검토자" } as const;
const ROLE_HELP = {
  admin: "팀원 관리 + 편집",
  editor: "작성·AI 요청·승인",
  reviewer: "열람·검토 의견만",
} as const;

export function TeamManager(props: { workspaceId: string; isAdmin: boolean; myEmail: string; members: Member[]; dailyLimit: number }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("editor");
  const [limit, setLimit] = useState(props.dailyLimit);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sb = supabaseBrowser();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await sb.from("workspace_members").insert({ workspace_id: props.workspaceId, email: email.trim().toLowerCase(), role });
    if (error) return setMsg({ ok: false, text: error.code === "23505" ? "이미 등록된 이메일입니다." : error.message });
    setMsg({ ok: true, text: `${email}을(를) 등록했습니다. 이 이메일로 로그인하면 바로 사용할 수 있습니다 (따로 승인할 필요 없음).` });
    setEmail("");
    router.refresh();
  }
  async function changeRole(m: Member, r: Member["role"]) {
    const { error } = await sb.from("workspace_members").update({ role: r }).eq("workspace_id", props.workspaceId).eq("email", m.email);
    if (error) return setMsg({ ok: false, text: error.message });
    router.refresh();
  }
  async function remove(m: Member) {
    if (!window.confirm(`${m.email}을(를) 팀에서 해제할까요?`)) return;
    const { error } = await sb.from("workspace_members").delete().eq("workspace_id", props.workspaceId).eq("email", m.email);
    if (error) return setMsg({ ok: false, text: error.message });
    router.refresh();
  }
  async function saveLimit() {
    const { error } = await sb.from("workspaces").update({ daily_ai_limit: limit }).eq("id", props.workspaceId);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "하루 AI 요청 한도를 바꿨습니다." });
  }

  return (
    <section className="space-y-4">
      <h2 className="section-title">팀원 {props.members.length}명</h2>
      <ul className="card divide-y divide-line">
        {props.members.map((m) => (
          <li key={m.email} className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex-1 min-w-[200px]">
              <div className="font-semibold">{m.email}{m.email === props.myEmail && <span className="pill ml-2">나</span>}</div>
              <div className="text-[13px] text-muted">{m.user_id ? "로그인한 적 있음" : "아직 로그인 전"}</div>
            </div>
            {props.isAdmin && m.email !== props.myEmail ? (
              <>
                <select className="select w-auto" value={m.role} onChange={(e) => changeRole(m, e.target.value as Member["role"])} aria-label={`${m.email} 권한`}>
                  {(["admin", "editor", "reviewer"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_HELP[r]}</option>)}
                </select>
                <button className="btn btn-sm btn-danger" onClick={() => remove(m)}>해제</button>
              </>
            ) : (
              <span className="pill">{ROLE_LABEL[m.role]}</span>
            )}
          </li>
        ))}
      </ul>

      {props.isAdmin && (
        <>
          <form onSubmit={add} className="card p-4 grid sm:grid-cols-[1fr_200px_auto] gap-3 items-end">
            <div>
              <label className="field-label" htmlFor="new-email">팀원 이메일</label>
              <input id="new-email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </div>
            <div>
              <label className="field-label" htmlFor="new-role">권한</label>
              <select id="new-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Member["role"])}>
                {(["editor", "reviewer", "admin"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" type="submit">등록</button>
          </form>
          <div className="card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="field-label" htmlFor="limit">하루 AI 요청 한도</label>
              <input id="limit" type="number" min={1} max={1000} className="input w-32" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 1)} />
            </div>
            <button className="btn" onClick={saveLimit}>저장</button>
          </div>
        </>
      )}
      {msg && <p className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`} role="status">{msg.text}</p>}
    </section>
  );
}
