import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { parseProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildVideoHandoff } from "@/lib/domain/handoff";
import { preRenderCheck } from "@/lib/domain/check";
import { supabaseServer } from "@/lib/supabase/server";

/** Builds the Higgsfield hand-off prompt server-side from the latest saved version. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await getCtx();
  if (!ctx) return NextResponse.json({ error: "작업함 권한이 없습니다." }, { status: 403 });
  const kind = req.nextUrl.searchParams.get("kind");

  const sb = await supabaseServer(); // RLS: members only
  const { data: project } = await sb.from("projects").select("current_version").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  const { data: ver } = await sb
    .from("project_versions")
    .select("data")
    .eq("project_id", id)
    .eq("version", project.current_version)
    .single();
  const data = parseProjectData(ver?.data);

  if (kind === "expressions") return NextResponse.json({ version: project.current_version, items: buildExpressionHandoffs(data) });
  if (kind === "video") {
    // same source as real generation (gen.ts), so what is shown and checked is what gets sent
    const h = buildVideoHandoff(data, data.video.startFrameAssetId ? "start_frame" : "references");
    return NextResponse.json({ version: project.current_version, ...h, checks: preRenderCheck(data, h) });
  }
  return NextResponse.json({ error: "kind는 expressions 또는 video" }, { status: 400 });
}
