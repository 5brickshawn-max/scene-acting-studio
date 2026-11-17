import type { SupabaseClient } from "@supabase/supabase-js";
import { readProjectData, type ProjectData } from "@/lib/domain/project";
import { sequenceChain, type SeqNode } from "@/lib/domain/sequence";

export type SceneRow = { id: string; name: string; version: number; updatedAt: string; data: ProjectData };

/** One scene's current version (null when it is not in this workspace or was deleted). */
export async function loadScene(sb: SupabaseClient, workspaceId: string, id: string): Promise<SceneRow | null> {
  const { data: p } = await sb.from("projects").select("id, name, workspace_id, current_version, updated_at, status").eq("id", id).maybeSingle();
  if (!p || p.workspace_id !== workspaceId || p.status === "deleted") return null;
  const { data: v } = await sb.from("project_versions").select("data").eq("project_id", id).eq("version", p.current_version).single();
  return { id: p.id, name: p.name, version: p.current_version, updatedAt: p.updated_at, data: readProjectData(v?.data).data };
}

/**
 * The whole sequence a scene belongs to: walk `previous` up to the first scene, then follow the next scenes
 * down (scenes whose current version names the scene before as `previous`).
 */
export async function loadSequence(sb: SupabaseClient, workspaceId: string, projectId: string) {
  const scenes = new Map<string, SceneRow>();
  let cur = await loadScene(sb, workspaceId, projectId);
  if (!cur) return null;
  scenes.set(cur.id, cur);
  // up: the first scene
  for (let i = 0; i < 50 && cur.data.previous; i++) {
    const up: SceneRow | null = await loadScene(sb, workspaceId, cur.data.previous.projectId);
    if (!up || scenes.has(up.id)) break;
    scenes.set(up.id, up);
    cur = up;
  }
  const rootId = cur.id;
  // down: every scene made from one already found
  const queue = [rootId];
  const nodes: SeqNode[] = [];
  for (let i = 0; queue.length && i < 200; i++) {
    const at = queue.shift()!;
    const { data: rows } = await sb.from("project_versions").select("project_id").eq("data->previous->>projectId", at).limit(1000);
    const ids = [...new Set((rows ?? []).map((r) => r.project_id as string))].filter((x) => x !== at);
    for (const id of ids) {
      const s = scenes.get(id) ?? (await loadScene(sb, workspaceId, id));
      // an older version pointed here, but the current one does not: not part of this chain any more
      if (!s || s.data.previous?.projectId !== at) continue;
      if (!scenes.has(id)) {
        scenes.set(id, s);
        queue.push(id);
      }
    }
  }
  for (const s of scenes.values()) nodes.push({ id: s.id, name: s.name, previousId: s.data.previous?.projectId ?? null, updatedAt: s.updatedAt });
  const { chain, branches } = sequenceChain(nodes, rootId);
  return {
    rootId,
    scenes: chain.map((id) => scenes.get(id)!),
    branches: branches.map((b) => ({ afterId: b.afterId, scenes: b.ids.map((id) => scenes.get(id)!).map((s) => ({ id: s.id, name: s.name })) })),
  };
}
