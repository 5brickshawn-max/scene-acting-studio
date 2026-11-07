"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { AssetKind, AssetView } from "@/lib/types";

const MAX_BYTES = 50 * 1024 * 1024;
const PREVIEW_MAX = 1568; // long edge; also what Claude analyses

async function imageSize(file: Blob): Promise<{ w: number; h: number; bitmap: ImageBitmap } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    return { w: bitmap.width, h: bitmap.height, bitmap };
  } catch {
    return null;
  }
}

async function makePreview(bitmap: ImageBitmap): Promise<Blob | null> {
  const scale = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff"; // flatten transparency for JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.88));
}

export async function uploadAsset(opts: {
  file: File;
  kind: AssetKind;
  workspaceId: string;
  projectId: string | null;
}): Promise<AssetView> {
  const { file, kind, workspaceId, projectId } = opts;
  if (file.size > MAX_BYTES) throw new Error("50MB보다 큰 파일은 올릴 수 없습니다.");
  const sb = supabaseBrowser();
  const id = crypto.randomUUID();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const folder = `${workspaceId}/${projectId ?? "shared"}`;
  const path = `${folder}/${id}.${ext}`;

  const { error: upErr } = await sb.storage.from("assets").upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new Error("업로드 실패: " + upErr.message);

  let width: number | null = null;
  let height: number | null = null;
  let previewPath: string | undefined;
  if (file.type.startsWith("image/")) {
    const size = await imageSize(file);
    if (size) {
      width = size.w;
      height = size.h;
      const preview = await makePreview(size.bitmap);
      if (preview) {
        previewPath = `${folder}/${id}_preview.jpg`;
        const { error } = await sb.storage.from("assets").upload(previewPath, preview, { contentType: "image/jpeg" });
        if (error) previewPath = undefined;
      }
    }
  }

  const { data: row, error } = await sb
    .from("assets")
    .insert({
      id,
      workspace_id: workspaceId,
      project_id: projectId,
      kind,
      name: file.name,
      storage_path: path,
      mime: file.type || "application/octet-stream",
      size_bytes: file.size,
      width,
      height,
      meta: previewPath ? { previewPath } : {},
    })
    .select("*")
    .single();
  if (error || !row) throw new Error("자료 등록 실패: " + (error?.message ?? ""));

  const paths = [path, previewPath].filter(Boolean) as string[];
  const { data: signed } = await sb.storage.from("assets").createSignedUrls(paths, 60 * 60 * 6);
  const url = signed?.find((s) => s.path === path)?.signedUrl ?? "";
  const previewUrl = signed?.find((s) => s.path === previewPath)?.signedUrl ?? url;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    width,
    height,
    projectId,
    createdAt: row.created_at,
    url,
    previewUrl,
  };
}

/** Workspace assets for the "use an existing image" picker. */
export async function listWorkspaceAssets(workspaceId: string, kinds: AssetKind[]): Promise<AssetView[]> {
  const sb = supabaseBrowser();
  const { data: rows } = await sb
    .from("assets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("kind", kinds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(120);
  if (!rows?.length) return [];
  const paths = rows.map((r) => (r.meta as { previewPath?: string })?.previewPath ?? r.storage_path);
  const all = [...new Set([...paths, ...rows.map((r) => r.storage_path)])];
  const { data: signed } = await sb.storage.from("assets").createSignedUrls(all, 60 * 60 * 6);
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r, i) => ({
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
    previewUrl: urlOf.get(paths[i]) ?? "",
  }));
}

/** Load one asset (e.g. a sheet saved by a Higgsfield job) with signed URLs. */
export async function fetchAsset(id: string): Promise<AssetView | null> {
  const sb = supabaseBrowser();
  const { data: r } = await sb.from("assets").select("*").eq("id", id).maybeSingle();
  if (!r) return null;
  const preview = (r.meta as { previewPath?: string })?.previewPath;
  const paths = [r.storage_path, preview].filter(Boolean) as string[];
  const { data: signed } = await sb.storage.from("assets").createSignedUrls(paths, 60 * 60 * 6);
  const url = signed?.find((s) => s.path === r.storage_path)?.signedUrl ?? "";
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
    url,
    previewUrl: (preview && signed?.find((s) => s.path === preview)?.signedUrl) || url,
  };
}
