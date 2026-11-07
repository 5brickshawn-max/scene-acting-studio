import { getCtx } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { loadAssets } from "@/lib/assets-server";
import { TopBar } from "@/components/top-bar";
import { NoAccess } from "@/components/no-access";
import { ProjectList, type ProjectRow } from "./project-list";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { ctx, email } = await getCtx();
  if (!ctx) return <NoAccess email={email} />;
  const sb = await supabaseServer();
  const { data } = await sb
    .from("projects")
    .select("id, name, status, current_version, current_step, approved_through, thumbnail_asset_id, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as Omit<ProjectRow, "thumbUrl">[];
  const thumbs = await loadAssets({ ids: rows.map((r) => r.thumbnail_asset_id).filter(Boolean) as string[] });
  const thumbOf = new Map(thumbs.map((a) => [a.id, a.previewUrl]));
  const projects: ProjectRow[] = rows.map((r) => ({ ...r, thumbUrl: r.thumbnail_asset_id ? thumbOf.get(r.thumbnail_asset_id) ?? null : null }));

  return (
    <>
      <TopBar ctx={ctx} />
      <main className="mx-auto max-w-[1100px] px-4 sm:px-6 py-8">
        <ProjectList projects={projects} workspaceId={ctx.workspaceId} canEdit={ctx.role !== "reviewer"} />
      </main>
    </>
  );
}
