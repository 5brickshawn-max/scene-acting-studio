import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { canEdit, getCtx } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { poll, pollUntilDone, quote, start, type GenSpec } from "@/lib/higgsfield/gen";

export const maxDuration = 300;

async function guard(projectId: string) {
  const { ctx } = await getCtx();
  if (!ctx) return { error: NextResponse.json({ error: "작업함 권한이 없습니다." }, { status: 403 }) };
  const { data: p } = await supabaseAdmin().from("projects").select("workspace_id").eq("id", projectId).maybeSingle();
  if (!p || p.workspace_id !== ctx.workspaceId)
    return { error: NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 }) };
  return { ctx };
}

const Spec = z.discriminatedUnion("target", [
  z.object({ target: z.literal("expressions"), model: z.string().max(64), expressionIds: z.array(z.string().max(64)).max(12).optional() }),
  z.object({ target: z.literal("video"), model: z.string().max(64), resolution: z.string().max(16) }),
  z.object({ target: z.literal("finalize"), draftRowId: z.string().uuid() }),
  z.object({
    target: z.literal("frame"),
    model: z.string().max(64),
    expressionId: z.string().max(64),
    shot: z.enum(["close_up", "bust", "medium"]),
    slot: z.enum(["start", "end"]),
  }),
]);
const Body = z.object({ action: z.enum(["quote", "generate"]), spec: Spec });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.error) return g.error;
  if (!canEdit(g.ctx.role)) return NextResponse.json({ error: "검토자는 생성할 수 없습니다." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  try {
    const spec = parsed.data.spec as GenSpec;
    if (parsed.data.action === "quote") return NextResponse.json(await quote(id, spec));
    const rowIds = await start(id, g.ctx.userId, spec);
    after(() => pollUntilDone(rowIds));
    return NextResponse.json({ jobIds: rowIds });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "실패했습니다." }, { status: 400 });
  }
}

/** Nudge: check a running Higgsfield job once (used if the background loop ran out of time). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.error) return g.error;
  const job = req.nextUrl.searchParams.get("job");
  if (!job) return NextResponse.json({ error: "job이 필요합니다." }, { status: 400 });
  const { data: row } = await supabaseAdmin().from("ai_jobs").select("project_id").eq("id", job).maybeSingle();
  if (!row || row.project_id !== id) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  try {
    return NextResponse.json({ status: await poll(job) });
  } catch (e) {
    return NextResponse.json({ status: "running", error: e instanceof Error ? e.message : "확인 실패" });
  }
}
