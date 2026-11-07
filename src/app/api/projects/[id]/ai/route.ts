import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { canEdit, getCtx } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runJob } from "@/lib/ai/run";
import { JOB_KINDS, JOB_STEP } from "@/lib/ai/schemas";

// AI jobs run after the response is sent; allow up to 5 minutes.
export const maxDuration = 300;

const Body = z.object({
  kind: z.enum(JOB_KINDS),
  step: z.number().int().min(0).max(4),
  message: z.string().max(4000).optional(),
  instruction: z.string().max(4000).optional(),
  /** analyze_character: the cast member to analyze */
  characterId: z.string().max(64).optional(),
});

function startOfTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600_000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600_000).toISOString();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await getCtx();
  if (!ctx) return NextResponse.json({ error: "작업함 권한이 없습니다." }, { status: 403 });
  if (!canEdit(ctx.role)) return NextResponse.json({ error: "검토자는 AI 요청을 보낼 수 없습니다." }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const body = parsed.data;
  if (body.kind === "consult" && !body.message?.trim())
    return NextResponse.json({ error: "메시지를 입력하세요." }, { status: 400 });
  const step = body.kind === "consult" ? body.step : JOB_STEP[body.kind];

  const sb = supabaseAdmin();
  const { data: project } = await sb
    .from("projects")
    .select("id, workspace_id, current_version")
    .eq("id", id)
    .maybeSingle();
  if (!project || project.workspace_id !== ctx.workspaceId)
    return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });

  const { data: ws } = await sb.from("workspaces").select("daily_ai_limit").eq("id", ctx.workspaceId).single();
  const { count } = await sb
    .from("ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspaceId)
    .not("kind", "like", "hf_%") // Higgsfield generations use Higgsfield credits, not the Claude limit
    .gte("created_at", startOfTodayKST());
  if ((count ?? 0) >= (ws?.daily_ai_limit ?? 60))
    return NextResponse.json({ error: "오늘의 AI 요청 한도를 모두 사용했습니다. 내일 오전 0시(KST)에 초기화됩니다." }, { status: 429 });

  const { data: job, error } = await sb
    .from("ai_jobs")
    .insert({
      workspace_id: ctx.workspaceId,
      project_id: id,
      kind: body.kind,
      step,
      input: { message: body.message, instruction: body.instruction, characterId: body.characterId },
      based_on_version: project.current_version,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !job) return NextResponse.json({ error: "작업을 등록하지 못했습니다." }, { status: 500 });

  // Keeps running even if the browser tab is closed.
  after(() => runJob(job.id));
  return NextResponse.json({ jobId: job.id, basedOnVersion: project.current_version });
}
