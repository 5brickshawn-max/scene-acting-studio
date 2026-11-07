import { getCtx } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { TopBar } from "@/components/top-bar";
import { NoAccess } from "@/components/no-access";
import { TeamManager, type Member } from "./team-manager";
import { HiggsfieldPanel } from "./higgsfield-panel";

export const dynamic = "force-dynamic";

function startOfTodayKST() {
  const kst = new Date(Date.now() + 9 * 3600_000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600_000).toISOString();
}

export default async function TeamPage() {
  const { ctx, email } = await getCtx();
  if (!ctx) return <NoAccess email={email} />;
  const sb = await supabaseServer();
  const [{ data: members }, { data: ws }, { data: jobs }, { data: assets }] = await Promise.all([
    sb.from("workspace_members").select("email, role, user_id, created_at").eq("workspace_id", ctx.workspaceId).order("created_at"),
    sb.from("workspaces").select("daily_ai_limit, storage_limit_mb").eq("id", ctx.workspaceId).single(),
    sb.from("ai_jobs").select("kind, status, input_tokens, output_tokens").eq("workspace_id", ctx.workspaceId).gte("created_at", startOfTodayKST()),
    sb.from("assets").select("size_bytes").eq("workspace_id", ctx.workspaceId).is("deleted_at", null),
  ]);
  const claudeJobs = (jobs ?? []).filter((j) => !String(j.kind).startsWith("hf_"));
  const used = claudeJobs.length;
  const tokensIn = claudeJobs.reduce((s, j) => s + (j.input_tokens ?? 0), 0);
  const tokensOut = claudeJobs.reduce((s, j) => s + (j.output_tokens ?? 0), 0);
  const storageMb = Math.round(((assets ?? []).reduce((s, a) => s + Number(a.size_bytes), 0) / 1024 / 1024) * 10) / 10;

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="mx-auto max-w-[900px] px-4 sm:px-6 py-8 space-y-8">
        <section className="space-y-3">
          <h1 className="text-2xl font-bold">팀·사용량</h1>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="card p-4">
              <div className="text-muted text-sm">오늘 AI 요청</div>
              <div className="text-2xl font-bold">{used} / {ws?.daily_ai_limit ?? 60}</div>
              <div className="text-[13px] text-muted">매일 0시(KST) 초기화</div>
            </div>
            <div className="card p-4">
              <div className="text-muted text-sm">오늘 사용한 토큰</div>
              <div className="text-2xl font-bold">{Math.round((tokensIn + tokensOut) / 1000)}K</div>
              <div className="text-[13px] text-muted">입력 {Math.round(tokensIn / 1000)}K · 출력 {Math.round(tokensOut / 1000)}K</div>
            </div>
            <div className="card p-4">
              <div className="text-muted text-sm">자료 보관량</div>
              <div className="text-2xl font-bold">{storageMb} MB</div>
              <div className="text-[13px] text-muted">한도 {ws?.storage_limit_mb ?? 2000} MB · 파일 {(assets ?? []).length}개</div>
            </div>
          </div>
          <p className="field-help">
            그림 생성은 Higgsfield 구독 크레딧으로 처리되어 위 AI 요청 수에 포함되지 않습니다.
            위 숫자는 Claude 분석·상의 요청만 셉니다.
          </p>
        </section>
        <HiggsfieldPanel isAdmin={ctx.role === "admin"} />
        <TeamManager
          workspaceId={ctx.workspaceId}
          isAdmin={ctx.role === "admin"}
          myEmail={ctx.email}
          members={(members ?? []) as Member[]}
          dailyLimit={ws?.daily_ai_limit ?? 60}
        />
      </main>
    </>
  );
}
