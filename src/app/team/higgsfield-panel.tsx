"use client";
import { useCallback, useEffect, useState } from "react";

type Ws = { id: string; name: string | null; type: string; plan_type: string; credits: number };
type Status = {
  connected: boolean;
  expired?: boolean;
  error?: string;
  accountEmail: string | null;
  hfWorkspaceId: string | null;
  hfWorkspaceName: string | null;
  workspaces: Ws[] | null;
};

async function post(body: object) {
  const res = await fetch("/api/higgsfield/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "실패했습니다.");
  return json;
}

export function HiggsfieldPanel({ isAdmin }: { isAdmin: boolean }) {
  const [st, setSt] = useState<Status | null>(null);
  const [step, setStep] = useState<"idle" | "waiting">("idle");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/higgsfield/connect");
    setSt(await res.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "실패했습니다." });
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      const { authorizeUrl } = await post({ action: "start" });
      window.open(authorizeUrl, "_blank", "noopener");
      setStep("waiting");
    });
  const finish = () =>
    run(async () => {
      await post({ action: "finish", url: pasted });
      setPasted("");
      setStep("idle");
      setMsg({ ok: true, text: "Higgsfield 계정을 연결했습니다." });
      await load();
    });
  const choose = (id: string) =>
    run(async () => {
      await post({ action: "workspace", workspaceId: id });
      await load();
    });
  const disconnect = () =>
    run(async () => {
      if (!window.confirm("Higgsfield 연결을 해제할까요? 다시 연결하기 전까지 ‘바로 생성’을 쓸 수 없습니다.")) return;
      await post({ action: "disconnect" });
      await load();
    });

  return (
    <section className="card p-5 space-y-4" aria-labelledby="hf-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="hf-title" className="section-title">Higgsfield 연결</h2>
        {st?.connected && !st.expired ? <span className="pill pill-ok">연결됨</span> : <span className="pill">연결 안 됨</span>}
      </div>
      <p className="text-muted">
        연결하면 표정 시트를 앱에서 바로 생성하고, 선택한 Higgsfield 워크스페이스의 <strong className="text-ink">구독 크레딧</strong>이 차감됩니다.
      </p>

      {st === null && <p className="text-muted">확인 중…</p>}

      {st?.connected && (
        <div className="space-y-3">
          <p>
            계정: <strong>{st.accountEmail ?? "확인 불가"}</strong> · 크레딧 사용처: <strong>{st.hfWorkspaceName ?? "선택 안 됨"}</strong>
          </p>
          {st.expired && <p className="notice notice-error">{st.error ?? "로그인이 만료되었습니다."} 다시 연결해 주세요.</p>}
          {isAdmin && st.workspaces && (
            <div>
              <div className="field-label">크레딧을 쓸 워크스페이스</div>
              <ul className="space-y-2">
                {st.workspaces.map((w) => (
                  <li key={w.id}>
                    <label className="flex items-center gap-3 rounded-lg border border-line p-3 cursor-pointer">
                      <input type="radio" name="hfws" className="size-5" checked={st.hfWorkspaceId === w.id} disabled={busy} onChange={() => choose(w.id)} />
                      <span className="flex-1">
                        <strong>{w.name ?? (w.type === "private" ? "개인 워크스페이스" : w.id)}</strong>
                        <span className="text-muted"> · {w.type === "private" ? "개인" : "공유(팀)"} · {w.plan_type}</span>
                      </span>
                      <span className="font-semibold">{Math.floor(w.credits).toLocaleString("ko-KR")} 크레딧</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="field-help">
                기본은 개인 워크스페이스입니다. 팀 워크스페이스를 골라도 앱은 생성할 때만 잠깐 바꿨다가 원래 선택으로 되돌리므로,
                Claude 채팅 등 같은 계정의 다른 앱에는 영향이 없습니다.
              </p>
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="space-y-3">
          {step === "idle" ? (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-dark" onClick={start} disabled={busy}>
                {st?.connected ? "다른 계정으로 다시 연결" : "Higgsfield 로그인 열기"}
              </button>
              {st?.connected && <button className="btn btn-danger" onClick={disconnect} disabled={busy}>연결 해제</button>}
            </div>
          ) : (
            <div className="rounded-lg border border-line p-4 space-y-3">
              <ol className="list-decimal pl-5 space-y-1">
                <li>새 탭에서 Higgsfield에 로그인하고 <strong>허용(Allow)</strong>을 누르세요.</li>
                <li>“사이트에 연결할 수 없음” 화면이 뜨면 정상입니다.</li>
                <li>그 화면의 <strong>주소창 전체</strong>(http://localhost:3000/… )를 복사해 아래에 붙여넣으세요.</li>
              </ol>
              <label className="field-label" htmlFor="hf-url">로그인 후 주소</label>
              <input id="hf-url" className="input font-mono text-[13px]" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://localhost:3000/api/higgsfield/callback?code=..." />
              <div className="flex gap-2">
                <button className="btn btn-primary" onClick={finish} disabled={busy || !pasted.trim()}>연결 완료</button>
                <button className="btn btn-ghost" onClick={() => setStep("idle")}>취소</button>
              </div>
            </div>
          )}
        </div>
      )}
      {!isAdmin && !st?.connected && <p className="field-help">관리자가 연결하면 사용할 수 있습니다.</p>}
      {msg && <p className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`} role="status">{msg.text}</p>}
    </section>
  );
}
