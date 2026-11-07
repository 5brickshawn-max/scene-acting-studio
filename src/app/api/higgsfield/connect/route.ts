import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCtx } from "@/lib/auth";
import { chooseWorkspace, disconnect, finishLogin, getConnection, listWorkspaces, startLogin } from "@/lib/higgsfield/client";

/** Connection status — any member may see whether Higgsfield is connected (never the tokens). */
export async function GET() {
  const { ctx } = await getCtx();
  if (!ctx) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const c = await getConnection(ctx.workspaceId);
  const connected = Boolean(c?.access_token);
  let workspaces = null;
  if (connected && ctx.role === "admin") {
    try {
      workspaces = await listWorkspaces(ctx.workspaceId);
    } catch (e) {
      return NextResponse.json({ connected, expired: true, error: e instanceof Error ? e.message : "오류" });
    }
  }
  return NextResponse.json({
    connected,
    accountEmail: c?.account_email ?? null,
    hfWorkspaceId: c?.hf_workspace_id ?? null,
    hfWorkspaceName: c?.hf_workspace_name ?? null,
    workspaces,
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("finish"), url: z.string().min(10).max(4000) }),
  z.object({ action: z.literal("workspace"), workspaceId: z.string().uuid() }),
  z.object({ action: z.literal("disconnect") }),
]);

/** Admin-only connection management. */
export async function POST(req: NextRequest) {
  const { ctx } = await getCtx();
  if (!ctx || ctx.role !== "admin") return NextResponse.json({ error: "관리자만 Higgsfield를 연결할 수 있습니다." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const b = parsed.data;
  try {
    if (b.action === "start") return NextResponse.json({ authorizeUrl: await startLogin(ctx.workspaceId) });
    if (b.action === "finish") {
      await finishLogin(ctx.workspaceId, b.url);
      const ws = await listWorkspaces(ctx.workspaceId);
      // Default to the personal workspace; the admin can switch to a team workspace.
      const pick = ws.find((w) => w.type === "private") ?? ws[0];
      if (pick) await chooseWorkspace(ctx.workspaceId, pick);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "workspace") {
      const ws = await listWorkspaces(ctx.workspaceId);
      const pick = ws.find((w) => w.id === b.workspaceId);
      if (!pick) return NextResponse.json({ error: "그 워크스페이스에 접근할 수 없습니다." }, { status: 400 });
      await chooseWorkspace(ctx.workspaceId, pick);
      return NextResponse.json({ ok: true });
    }
    await disconnect(ctx.workspaceId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "실패했습니다." }, { status: 400 });
  }
}
