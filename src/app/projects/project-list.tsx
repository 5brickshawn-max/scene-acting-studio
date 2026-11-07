"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { MAX_CAST, STEPS, createProjectData } from "@/lib/domain/project";

export type ProjectRow = {
  id: string;
  name: string;
  status: "active" | "archived" | "trashed";
  current_version: number;
  current_step: number;
  approved_through: number;
  thumbnail_asset_id: string | null;
  updated_at: string;
  thumbUrl: string | null;
};

const TABS = [
  { key: "active", label: "작업 중" },
  { key: "archived", label: "보관함" },
  { key: "trashed", label: "휴지통" },
] as const;

const fmt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });

export function ProjectList({ projects, workspaceId, canEdit }: { projects: ProjectRow[]; workspaceId: string; canEdit: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<ProjectRow["status"]>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, projects.filter((p) => p.status === t.key).length])),
    [projects],
  );

  // Projects that share a name are shown together so duplicates are obvious.
  const dupNames = useMemo(() => {
    const m = new Map<string, number>();
    projects.filter((p) => p.status === "active").forEach((p) => m.set(p.name, (m.get(p.name) ?? 0) + 1));
    return m;
  }, [projects]);

  const visible = projects
    .filter((p) => p.status === tab && p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "ko") : b.updated_at.localeCompare(a.updated_at)));

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [castCount, setCastCount] = useState(1);

  async function create() {
    const name = newTitle.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const { data, error } = await supabaseBrowser().rpc("create_project", {
      p_workspace_id: workspaceId,
      p_name: name,
      p_data: createProjectData(name, castCount),
    });
    setBusy(false);
    if (error) return setError("작업을 만들지 못했습니다: " + error.message);
    router.push(`/projects/${data}`);
  }

  async function setStatus(id: string, status: ProjectRow["status"]) {
    const { error } = await supabaseBrowser().from("projects").update({ status }).eq("id", id);
    if (error) return setError(error.message);
    router.refresh();
  }

  async function rename(id: string) {
    const name = newName.trim();
    if (!name) return;
    const { error } = await supabaseBrowser().rpc("rename_project", { p_project_id: id, p_name: name });
    if (error) return setError("이름을 바꾸지 못했습니다: " + error.message);
    setRenaming(null);
    router.refresh();
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">작업 목록</h1>
          <p className="text-muted">장면 하나가 작업 하나입니다(출연진 1~{MAX_CAST}명). 저장할 때마다 버전이 쌓이고, 언제든 이전 버전으로 되돌릴 수 있습니다.</p>
        </div>
        {canEdit && !creating && (
          <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={busy}>
            + 새 장면
          </button>
        )}
      </div>
      {canEdit && creating && (
        <form
          className="rounded-xl border border-line p-4 flex flex-wrap items-end gap-4"
          aria-label="새 장면 만들기"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="min-w-[220px] flex-1">
            <span className="field-label">장면 이름</span>
            <input className="input" autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="예: 칼리엘라와 브람의 결투 직전" />
          </label>
          <div role="group" aria-label="출연진 수">
            <div className="field-label">출연진</div>
            <div className="seg">
              {Array.from({ length: MAX_CAST }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" aria-pressed={castCount === n} onClick={() => setCastCount(n)}>
                  {n === 1 ? "1명 (인물 연기)" : `${n}명`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy || !newTitle.trim()}>
              {busy ? "만드는 중…" : "만들기"}
            </button>
            <button type="button" className="btn" onClick={() => setCreating(false)}>
              취소
            </button>
          </div>
          <p className="field-help w-full">출연진은 1단계에서 언제든 더하거나 뺄 수 있습니다.</p>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="seg" role="group" aria-label="작업 상태">
          {TABS.map((t) => (
            <button key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label} <span className="opacity-70">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <input
          className="input max-w-xs"
          placeholder="이름으로 검색"
          aria-label="작업 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="select w-auto" value={sort} onChange={(e) => setSort(e.target.value as "recent" | "name")} aria-label="정렬">
          <option value="recent">최근 저장순</option>
          <option value="name">이름순</option>
        </select>
      </div>

      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {visible.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          {tab === "active" ? "아직 작업이 없습니다. ‘새 작업’으로 시작하세요." : "비어 있습니다."}
        </div>
      ) : (
        <ul className="card divide-y divide-line">
          {visible.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="w-16 h-16 rounded-lg border border-line overflow-hidden checker grid place-items-center shrink-0">
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbUrl} alt="" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-muted text-sm">없음</span>
                )}
              </div>
              <div className="flex-1 min-w-[200px]">
                {renaming === p.id ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); rename(p.id); }}>
                    <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus aria-label="새 이름" />
                    <button className="btn btn-sm" type="submit">저장</button>
                    <button className="btn btn-sm btn-ghost" type="button" onClick={() => setRenaming(null)}>취소</button>
                  </form>
                ) : (
                  <Link href={`/projects/${p.id}`} className="font-semibold text-[16px] hover:underline">
                    {p.name}
                  </Link>
                )}
                <div className="text-sm text-muted flex flex-wrap gap-x-3">
                  <span>{p.approved_through >= 4 ? "모든 단계 승인" : `${STEPS[Math.min(4, p.approved_through + 1)]} 단계 진행 중`}</span>
                  <span>v{p.current_version}</span>
                  <span>{fmt.format(new Date(p.updated_at))}</span>
                  {p.status === "active" && (dupNames.get(p.name) ?? 0) > 1 && (
                    <span className="pill pill-warn">같은 이름 {dupNames.get(p.name)}개</span>
                  )}
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {p.status === "active" && (
                    <>
                      <button className="btn btn-sm" onClick={() => { setRenaming(p.id); setNewName(p.name); }}>이름 변경</button>
                      <button className="btn btn-sm" onClick={() => setStatus(p.id, "archived")}>보관</button>
                      <button className="btn btn-sm btn-danger" onClick={() => setStatus(p.id, "trashed")}>휴지통</button>
                    </>
                  )}
                  {p.status !== "active" && (
                    <button className="btn btn-sm" onClick={() => setStatus(p.id, "active")}>작업 중으로 복원</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
