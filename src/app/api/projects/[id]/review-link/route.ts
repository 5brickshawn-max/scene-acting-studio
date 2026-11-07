import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { canEdit, getCtx } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cancelReviewLinks, createReviewToken, MAX_REVIEW_LINK_HOURS } from "@/lib/review-link";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), hours: z.number().min(1).max(MAX_REVIEW_LINK_HOURS) }),
  z.object({ action: z.literal("cancel_all") }),
]);

/** Make a read-only review link for this project, or cancel all of its links. Editors and admins only. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await getCtx();
  if (!ctx) return NextResponse.json({ error: "작업함 권한이 없습니다." }, { status: 403 });
  if (!canEdit(ctx.role)) return NextResponse.json({ error: "검토자는 검토용 링크를 만들 수 없습니다." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });

  const sb = supabaseAdmin();
  const { data: project } = await sb.from("projects").select("workspace_id").eq("id", id).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspaceId) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });

  try {
    if (parsed.data.action === "cancel_all") {
      await cancelReviewLinks(sb, project.workspace_id, id);
      return NextResponse.json({ ok: true });
    }
    const { token, expiresAt } = createReviewToken(id, parsed.data.hours);
    const origin = req.nextUrl.origin;
    return NextResponse.json({ url: `${origin}/review/${token}`, dataUrl: `${origin}/api/review/${token}`, expiresAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "실패했습니다." }, { status: 500 });
  }
}
