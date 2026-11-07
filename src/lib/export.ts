"use client";
/**
 * Browser-side packaging of the files needed to make images or videos by hand
 * on higgsfield.ai. Files are fetched with fresh signed URLs and zipped in the
 * browser, so large files never pass through a serverless function.
 */
import { zip, strToU8, type Zippable } from "fflate";
import { supabaseBrowser } from "@/lib/supabase/browser";

export type PackFile = { path: string; data: Uint8Array; compress?: boolean };

/** File-name safe text (keeps Korean). */
export const safeName = (s: string, max = 40) =>
  (s || "").replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "이름없음";

const two = (n: number) => String(n).padStart(2, "0");
export const stamp = (d = new Date()) =>
  `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}`;

/** A text file with Windows line endings (opens cleanly in Notepad too). */
export const text = (path: string, body: string): PackFile => ({ path, data: strToU8(body.replace(/\r?\n/g, "\r\n")), compress: true });

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function zipFiles(files: PackFile[]): Promise<Blob> {
  const tree: Zippable = {};
  // images and videos are already compressed: store them as they are
  for (const f of files) tree[f.path] = [f.data, { level: f.compress ? 6 : 0 }];
  return new Promise((resolve, reject) =>
    zip(tree, (err, out) => (err ? reject(err) : resolve(new Blob([out as BlobPart], { type: "application/zip" })))),
  );
}

export type StoredAsset = { id: string; name: string; kind: string; mime: string; storage_path: string };

const extOf = (a: Pick<StoredAsset, "storage_path" | "mime">) =>
  a.storage_path.split(".").pop()?.toLowerCase() || (a.mime.includes("mp4") ? "mp4" : a.mime.includes("jpeg") ? "jpg" : "png");

/** Asset rows for these ids, with freshly signed URLs for the original files. */
export async function freshAssets(ids: string[]): Promise<(StoredAsset & { url: string; ext: string })[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const sb = supabaseBrowser();
  const { data } = await sb.from("assets").select("id, name, kind, mime, storage_path").in("id", unique);
  const rows = (data ?? []) as StoredAsset[];
  if (!rows.length) return [];
  const { data: signed } = await sb.storage.from("assets").createSignedUrls(rows.map((r) => r.storage_path), 60 * 30);
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({ ...r, url: urlOf.get(r.storage_path) ?? "", ext: extOf(r) }));
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`파일을 받지 못했습니다 (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetch several files with limited parallelism, reporting progress. A failed file comes back as null. */
export async function fetchAll<T extends { url: string }>(items: T[], onProgress?: (done: number, total: number) => void, parallel = 4) {
  const out: (Uint8Array | null)[] = Array(items.length).fill(null);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = items[i].url ? await fetchBytes(items[i].url) : null;
      } catch {
        out[i] = null;
      }
      onProgress?.(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker));
  return out;
}

/**
 * Pad an image with white to the video's aspect ratio (never stretched), the same
 * way the app does for direct generation, so the video model keeps the drawing's
 * proportions. Returns null if the image already has that shape.
 */
export async function padImage(bytes: Uint8Array, aspect: "16:9" | "9:16"): Promise<Uint8Array | null> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  const r = aspect === "16:9" ? 16 / 9 : 9 / 16;
  const w = bmp.width;
  const h = bmp.height;
  if (Math.abs(w / h - r) / r < 0.03) return null;
  const W = w / h < r ? Math.round(h * r) : w;
  const H = w / h < r ? h : Math.round(w / r);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, Math.floor((W - w) / 2), Math.floor((H - h) / 2));
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
