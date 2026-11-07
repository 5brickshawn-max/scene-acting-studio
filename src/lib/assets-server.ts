import { supabaseServer } from "@/lib/supabase/server";
import type { AssetView } from "@/lib/types";

const TTL = 60 * 60 * 6; // 6h

/** Signed URLs for assets the current user can read (RLS applies). */
export async function loadAssets(filter: { ids?: string[]; projectId?: string; workspaceId?: string }): Promise<AssetView[]> {
  const sb = await supabaseServer();
  let q = sb.from("assets").select("*").is("deleted_at", null).order("created_at", { ascending: false });
  if (filter.ids) {
    if (!filter.ids.length) return [];
    q = q.in("id", filter.ids);
  }
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  if (filter.workspaceId) q = q.eq("workspace_id", filter.workspaceId);
  const { data: rows } = await q.limit(500);
  if (!rows?.length) return [];
  const paths = rows.flatMap((r) => [r.storage_path, (r.meta as { previewPath?: string })?.previewPath].filter(Boolean) as string[]);
  const { data: signed } = await sb.storage.from("assets").createSignedUrls(paths, TTL);
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => {
    const preview = (r.meta as { previewPath?: string })?.previewPath;
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      width: r.width,
      height: r.height,
      projectId: r.project_id,
      createdAt: r.created_at,
      url: urlOf.get(r.storage_path) ?? "",
      previewUrl: (preview && urlOf.get(preview)) || urlOf.get(r.storage_path) || "",
    };
  });
}
