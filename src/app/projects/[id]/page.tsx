import { notFound } from "next/navigation";
import { getCtx, canEdit } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssets } from "@/lib/assets-server";
import { expireStaleClaudeJobs } from "@/lib/jobs-server";
import { mergeJobs } from "@/lib/jobs";
import { readProjectData } from "@/lib/domain/project";
import { NoAccess } from "@/components/no-access";
import type { JobView } from "@/lib/types";
import { Editor } from "./editor";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, email } = await getCtx();
  if (!ctx) return <NoAccess email={email} />;
  const sb = await supabaseServer();

  const { data: project } = await sb.from("projects").select("id, workspace_id, current_version").eq("id", id).maybeSingle();
  if (!project || project.workspace_id !== ctx.workspaceId) notFound();
  await expireStaleClaudeJobs(id);

  const JOB_COLS = "id, kind, step, status, input, output, error, based_on_version, applied_version, created_at, finished_at, created_by";
  const [{ data: ver }, assets, { data: recentJobs }, { data: openJobs }, { data: members }] = await Promise.all([
    sb.from("project_versions").select("data").eq("project_id", id).eq("version", project.current_version).single(),
    loadAssets({ workspaceId: ctx.workspaceId, projectId: id }),
    sb.from("ai_jobs").select(JOB_COLS).eq("project_id", id).order("created_at", { ascending: false }).limit(60),
    // proposals nobody has applied or closed yet stay on screen even when many newer jobs came after them
    sb.from("ai_jobs").select(JOB_COLS).eq("project_id", id).eq("status", "done").is("applied_version", null).order("created_at", { ascending: false }).limit(60),
    sb.from("workspace_members").select("user_id, email").eq("workspace_id", ctx.workspaceId),
  ]);

  const { data, recovered } = readProjectData(ver?.data);
  // Assets referenced by this project but uploaded elsewhere (reused from another project)
  const referenced = [
    data.baseAssetId,
    ...data.designRefAssetIds,
    ...data.cast.map((c) => c.refAssetId),
    data.expressionSetup.refAssetId,
    data.expressionSetup.sheetAssetId,
    ...data.expressions.flatMap((e) => [e.imageAssetId, e.sketchAssetId]),
    data.video.startFrameAssetId,
    data.video.endFrameAssetId,
    ...data.video.resultAssetIds,
  ].filter((x): x is string => Boolean(x) && !assets.some((a) => a.id === x));
  const extra = await loadAssets({ ids: referenced });

  return (
    <Editor
      projectId={id}
      workspaceId={ctx.workspaceId}
      userId={ctx.userId}
      canEdit={canEdit(ctx.role)}
      initialData={data}
      recovered={recovered}
      initialVersion={project.current_version}
      initialAssets={[...assets, ...extra]}
      initialJobs={mergeJobs((recentJobs ?? []) as JobView[], (openJobs ?? []) as JobView[])}
      members={(members ?? []).filter((m) => m.user_id).map((m) => [m.user_id as string, m.email as string])}
    />
  );
}
