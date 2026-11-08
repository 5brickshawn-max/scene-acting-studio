/**
 * Higgsfield generations (plan credits via the official MCP server):
 * - "expressions": one image per expression (step 2) — submitted together as one batch
 * - "video": facial acting video (step 5), incl. finalizing a Seedance draft at 1080p
 *
 * Every generated image/video is its own ai_jobs row (kind hf_expr / hf_video).
 * Results are saved into the project's assets and offered to the user — never auto-applied.
 */
import { supabaseAdmin } from "@/lib/supabase/server";
import { FRAMING_LABEL, readProjectData, type Framing, type ProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildSketchHandoffs, buildFrameHandoff, buildSceneImageHandoff, buildVideoHandoff } from "@/lib/domain/handoff";
import { findJobIds, getConnection, openSession, withWorkspace, type McpSession } from "./client";
import sharp from "sharp";
import { composeSideBySide, padToAspect, type VideoAspect } from "./pad";
import { comboParts } from "@/lib/combo";
import { createHash } from "node:crypto";
import { IMAGE_MODELS, VIDEO_MODELS, isImageModel, isVideoModel, videoDuration } from "./models";

const TERMINAL_FAIL = new Set(["failed", "nsfw", "canceled", "cancelled", "ip_detected", "error"]);

export type GenSpec =
  | { target: "expressions"; model: string; expressionIds?: string[] }
  /** 러프 콘티: rough line sketches of storyboard panels (all, or the listed ones) */
  | { target: "sketch"; model: string; expressionIds?: string[] }
  | { target: "video"; model: string; resolution: string }
  | { target: "finalize"; draftRowId: string }
  /** 첫 장면: the scene reference picture drawn from the scenario (step 1) */
  | { target: "scene"; model: string }
  /** a start or end frame for the video (시작·끝 프레임), drawn at the video's aspect ratio */
  | { target: "frame"; model: string; expressionId: string; shot: Framing; slot: "start" | "end" };

type Media = { assetId: string; role: string };
type Item = { params: Record<string, unknown>; medias: Media[]; label: string; meta: Record<string, unknown> };
type Plan = {
  kind: "hf_expr" | "hf_video" | "hf_frame" | "hf_scene" | "hf_sketch";
  step: number;
  tool: "generate_image_batch" | "generate_video_batch";
  single: "generate_image" | "generate_video";
  items: Item[];
  /** pad reference images to this shape (video output) so the model never stretches them */
  padTo?: VideoAspect;
};

async function latestData(projectId: string) {
  const sb = supabaseAdmin();
  const { data: p } = await sb.from("projects").select("workspace_id, current_version").eq("id", projectId).single();
  const { data: v } = await sb
    .from("project_versions")
    .select("data")
    .eq("project_id", projectId)
    .eq("version", p!.current_version)
    .single();
  const read = readProjectData(v?.data);
  if (read.recovered) throw new Error("저장된 내용을 읽지 못했습니다. ‘기록’에서 이전 버전으로 되돌린 뒤 다시 시도하세요.");
  return { workspaceId: p!.workspace_id as string, version: p!.current_version as number, data: read.data };
}

async function plan(projectId: string, spec: GenSpec, data: ProjectData): Promise<Plan> {
  if (spec.target === "expressions") {
    if (!isImageModel(spec.model)) throw new Error("지원하지 않는 이미지 모델입니다.");
    if (!data.baseAssetId) throw new Error(data.cast.length > 1 ? "1단계에서 장면 기준 그림을 먼저 올리세요." : "1단계에서 기본 그림을 먼저 올리세요.");
    const m = IMAGE_MODELS[spec.model];
    const wanted = spec.expressionIds?.length ? new Set(spec.expressionIds) : null;
    const items = buildExpressionHandoffs(data)
      .filter((h) => !wanted || wanted.has(h.expressionId))
      .map((h) => ({
        params: { ...m.params, prompt: h.prompt, aspect_ratio: h.aspectRatio },
        medias: h.references.map((r) => ({ assetId: r.assetId, role: "image_references" })),
        label: `${h.index + 1}번 ${h.emotion || "표정"} · ${m.label}`,
        // framing is stored with the job so the app knows which shot size a result was made with
        meta: { model: spec.model, expressionId: h.expressionId, index: h.index, framing: data.expressionSetup.framing, aspect: h.aspectRatio },
      }));
    if (!items.length) throw new Error("생성할 표정이 없습니다.");
    if (items.length > 12) throw new Error("한 번에 12장까지 생성할 수 있습니다.");
    return { kind: "hf_expr", step: 1, tool: "generate_image_batch", single: "generate_image", items };
  }

  if (spec.target === "sketch") {
    if (!isImageModel(spec.model)) throw new Error("지원하지 않는 이미지 모델입니다.");
    if (data.mode !== "storyboard") throw new Error("러프 콘티는 스토리보드 방식에서만 생성합니다.");
    const m = IMAGE_MODELS[spec.model];
    const wanted = spec.expressionIds?.length ? new Set(spec.expressionIds) : null;
    const items = buildSketchHandoffs(data)
      .filter((h) => !wanted || wanted.has(h.expressionId))
      .filter((h) => {
        const e = data.expressions.find((x) => x.id === h.expressionId);
        return Boolean(e?.action.trim() || e?.camera.trim());
      })
      .map((h) => ({
        // a rough sketch needs no high rendering quality (cheaper)
        params: { ...m.params, ...("quality" in m.params ? { quality: "low" } : {}), prompt: h.prompt, aspect_ratio: h.aspectRatio },
        medias: h.references.map((r) => ({ assetId: r.assetId, role: "image_references" })),
        label: `${h.index + 1}번 컷 러프 콘티 · ${m.label}`,
        meta: { model: spec.model, expressionId: h.expressionId, index: h.index },
      }));
    if (!items.length) throw new Error("러프 콘티를 그릴 컷이 없습니다. 컷마다 장면 묘사나 카메라를 먼저 쓰세요.");
    if (items.length > 12) throw new Error("한 번에 12장까지 생성할 수 있습니다.");
    return { kind: "hf_sketch", step: 1, tool: "generate_image_batch", single: "generate_image", items };
  }

  if (spec.target === "scene") {
    if (!isImageModel(spec.model)) throw new Error("지원하지 않는 이미지 모델입니다.");
    if (!data.expressionSetup.scene.trim() && !data.opening.trim()) throw new Error("먼저 씬 시놉시스·시나리오나 첫 장면 묘사를 쓰세요.");
    if (!data.cast.some((c) => c.name.trim() || c.appearance.trim() || c.refAssetId))
      throw new Error("주요 인물의 이름·외형을 적거나 ‘AI로 씬 구성’을 먼저 하세요.");
    const m = IMAGE_MODELS[spec.model];
    const h = buildSceneImageHandoff(data);
    return {
      kind: "hf_scene",
      step: 0,
      tool: "generate_image_batch",
      single: "generate_image",
      items: [
        {
          params: { ...m.params, prompt: h.prompt, aspect_ratio: h.aspectRatio },
          medias: h.references.map((r) => ({ assetId: r.assetId, role: "image_references" })),
          label: `첫 장면 · ${m.label}`,
          meta: { model: spec.model, aspect: h.aspectRatio },
        },
      ],
    };
  }

  if (spec.target === "frame") {
    if (!isImageModel(spec.model)) throw new Error("지원하지 않는 이미지 모델입니다.");
    if (!data.baseAssetId) throw new Error(data.cast.length > 1 ? "1단계에서 장면 기준 그림을 먼저 올리세요." : "1단계에서 기본 그림을 먼저 올리세요.");
    const m = IMAGE_MODELS[spec.model];
    const f = buildFrameHandoff(data, spec.expressionId, spec.shot);
    const n = data.expressions.findIndex((e) => e.id === spec.expressionId) + 1;
    return {
      kind: "hf_frame",
      step: 4,
      tool: "generate_image_batch",
      single: "generate_image",
      items: [
        {
          params: { ...m.params, prompt: f.prompt, aspect_ratio: f.aspectRatio },
          medias: f.references.map((r) => ({ assetId: r.assetId, role: "image_references" })),
          label: `${spec.slot === "start" ? "시작" : "끝"} 프레임 · ${n}번 표정 · ${FRAMING_LABEL[spec.shot]} · ${m.label}`,
          meta: { model: spec.model, expressionId: spec.expressionId, shot: spec.shot, slot: spec.slot, aspect: f.aspectRatio },
        },
      ],
    };
  }

  if (spec.target === "video") {
    if (!isVideoModel(spec.model)) throw new Error("지원하지 않는 영상 모델입니다.");
    const vm = VIDEO_MODELS[spec.model];
    const res = vm.resolutions.find((r) => r.key === spec.resolution);
    if (!res) throw new Error("이 모델에서 지원하지 않는 해상도입니다.");
    if (!data.baseAssetId) throw new Error(data.cast.length > 1 ? "1단계에서 장면 기준 그림을 먼저 올리세요." : "1단계에서 기본 그림을 먼저 올리세요.");
    const start = data.video.startFrameAssetId;
    // the last frame goes with a start frame, to models that take one
    const end = start && vm.endRole ? data.video.endFrameAssetId : null;
    const h = buildVideoHandoff(data, start ? "start_frame" : "references", { endFrame: Boolean(end) });
    // Upload order must match the "reference image N" numbers in the prompt.
    const medias: Media[] = start
      ? [{ assetId: start, role: vm.startRole }, ...(end && vm.endRole ? [{ assetId: end, role: vm.endRole }] : [])]
      : h.references.map((r) => ({ assetId: r.assetId, role: "image_references" }));
    const duration = videoDuration(vm, data.acting.duration, { start: Boolean(start), end: Boolean(end) });
    return {
      kind: "hf_video",
      step: 4,
      tool: "generate_video_batch",
      single: "generate_video",
      padTo: data.video.aspectRatio,
      items: [
        {
          params: {
            model: vm.model,
            prompt: h.prompt,
            aspect_ratio: data.video.aspectRatio,
            duration,
            ...res.params,
            ...(start ? vm.withStartFrame : vm.withReferences),
          },
          medias,
          label: `${vm.label} · ${res.label} · ${duration}초`,
          meta: { model: spec.model, resolution: spec.resolution, duration, draft: res.key === "draft" },
        },
      ],
    };
  }

  // Finalize a completed Seedance draft at 1080p.
  const { data: row } = await supabaseAdmin().from("ai_jobs").select("*").eq("id", spec.draftRowId).single();
  const out = row?.output as { hfJobId?: string } | null;
  const inp = row?.input as { draft?: boolean; duration?: number } | null;
  if (!row || row.project_id !== projectId || row.status !== "done" || !inp?.draft || !out?.hfJobId)
    throw new Error("확정할 수 있는 드래프트가 아닙니다.");
  return {
    kind: "hf_video",
    step: 4,
    tool: "generate_video_batch",
    single: "generate_video",
    items: [
      {
        params: { model: "seedance_2_5", draft_job_id: out.hfJobId, resolution: "1080p" },
        medias: [],
        label: "Seedance 2.5 · 드래프트 1080p 확정",
        meta: { model: "seedance_2_5", resolution: "1080p", finalizeOf: spec.draftRowId, duration: inp.duration },
      },
    ],
  };
}

/**
 * Import each distinct reference once (shared across items).
 * With `padTo`, images of another shape are first padded with white to that
 * aspect ratio (stored next to the original and reused), never stretched.
 */
async function importMedias(s: McpSession, assetIds: string[], padTo?: VideoAspect) {
  const sb = supabaseAdmin();
  const map = new Map<string, string>();
  for (const id of [...new Set(assetIds)]) {
    const parts = comboParts(id);
    if (parts) {
      // consecutive beats in one image (composed once per aspect ratio, stored next to the first part)
      const { data: rows } = await sb.from("assets").select("id, storage_path").in("id", parts);
      const byId = new Map((rows ?? []).map((r) => [r.id as string, r.storage_path as string]));
      const paths = parts.map((p) => byId.get(p));
      if (paths.some((p) => !p)) continue;
      const aspect = padTo ?? "16:9";
      const hash = createHash("sha1").update(`${parts.join("+")}|${aspect}`).digest("hex").slice(0, 16);
      const combo = `${paths[0]!.replace(/\/[^/]*$/, "")}/combo_${hash}.png`;
      const { data: exists } = await sb.storage.from("assets").createSignedUrl(combo, 60);
      if (!exists?.signedUrl) {
        const files = await Promise.all(paths.map((p) => sb.storage.from("assets").download(p!)));
        if (files.some((f) => !f.data)) continue;
        const out = await composeSideBySide(await Promise.all(files.map(async (f) => Buffer.from(await f.data!.arrayBuffer()))), aspect).catch(() => null);
        if (!out) continue;
        const up = await sb.storage.from("assets").upload(combo, out, { contentType: "image/png", upsert: true });
        if (up.error) continue;
      }
      const { data: signed } = await sb.storage.from("assets").createSignedUrl(combo, 600);
      if (!signed?.signedUrl) continue;
      const r = await s.call<{ media_id?: string }>("media_import_url", { url: signed.signedUrl, type: "image" });
      if (r.media_id) map.set(id, r.media_id);
      continue;
    }
    const { data: a } = await sb.from("assets").select("storage_path, mime").eq("id", id).single();
    if (!a) continue;
    let path = a.storage_path as string;
    if (padTo && String(a.mime).startsWith("image/")) {
      const padded = `${path.replace(/\.[^./]+$/, "")}_pad${padTo.replace(":", "x")}.png`;
      const { data: exists } = await sb.storage.from("assets").createSignedUrl(padded, 60);
      if (exists?.signedUrl) path = padded;
      else {
        const { data: file } = await sb.storage.from("assets").download(path);
        const out = file ? await padToAspect(Buffer.from(await file.arrayBuffer()), padTo).catch(() => null) : null;
        if (out) {
          const up = await sb.storage.from("assets").upload(padded, out, { contentType: "image/png", upsert: true });
          if (!up.error) path = padded;
        }
      }
    }
    const { data: signed } = await sb.storage.from("assets").createSignedUrl(path, 600);
    if (!signed?.signedUrl) continue;
    const r = await s.call<{ media_id?: string }>("media_import_url", { url: signed.signedUrl, type: "image" });
    if (r.media_id) map.set(id, r.media_id);
  }
  return map;
}

/** Map batch response → job id per request index. */
export function indexedJobIds(res: unknown, count: number): (string | undefined)[] {
  const out: (string | undefined)[] = Array(count).fill(undefined);
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      const id = (r.job_id ?? r.jobId) as unknown;
      if (typeof r.index === "number" && typeof id === "string" && r.index < count) out[r.index] = id;
      Object.values(r).forEach(walk);
    }
  };
  walk(res);
  if (out.every((x) => !x)) findJobIds(res).slice(0, count).forEach((id, i) => (out[i] = id));
  return out;
}

/** Cost preview. Spends nothing. */
export async function quote(projectId: string, spec: GenSpec) {
  const { workspaceId, data } = await latestData(projectId);
  const p = await plan(projectId, spec, data);
  const { s, conn } = await openSession(workspaceId);
  const { r, bal } = await withWorkspace(s, conn, async () => ({
    r: await s.call<{ cost?: { credits?: number } }>(p.single, { params: { ...p.items[0].params, use_unlim: false, get_cost: true } }),
    bal: await s.call<{ credits?: number }>("balance", {}),
  }));
  const each = r.cost?.credits ?? null;
  return {
    credits: each === null ? null : Math.round(each * p.items.length * 100) / 100,
    each,
    count: p.items.length,
    balance: bal.credits ?? null,
    workspace: conn.hf_workspace_name,
    model: p.items.length > 1 ? `${p.items[0].label.split(" · ").slice(1).join(" · ")} × ${p.items.length}장` : p.items[0].label,
    references: new Set(p.items.flatMap((i) => i.medias.map((m) => m.assetId))).size,
  };
}

/** Creates one job row per item, submits them as one batch. Returns the row ids. */
export async function start(projectId: string, userId: string, spec: GenSpec) {
  const { workspaceId, version, data } = await latestData(projectId);
  const p = await plan(projectId, spec, data);
  const conn = await getConnection(workspaceId);
  if (!conn?.access_token) throw new Error("Higgsfield 계정이 연결되지 않았습니다. 관리자가 ‘팀·사용량’에서 연결해 주세요.");
  const sb = supabaseAdmin();
  const { data: rows, error } = await sb
    .from("ai_jobs")
    .insert(
      p.items.map((it) => ({
        workspace_id: workspaceId,
        project_id: projectId,
        kind: p.kind,
        step: p.step,
        status: "running",
        input: { ...it.meta, label: it.label, references: it.medias.map((m) => m.assetId), workspace: conn.hf_workspace_name },
        based_on_version: version,
        created_by: userId,
      })),
    )
    .select("id");
  if (error || !rows?.length) throw new Error("작업을 등록하지 못했습니다.");
  const ids = rows.map((r) => r.id as string);

  const fail = async (rowIds: string[], message: string) =>
    sb.from("ai_jobs").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).in("id", rowIds);

  try {
    const { s, conn: c } = await openSession(workspaceId);
    const jobIds = await withWorkspace(s, c, async () => {
      const media = await importMedias(s, p.items.flatMap((i) => i.medias.map((m) => m.assetId)), p.padTo);
      const requests = p.items.map((it, index) => {
        const medias = it.medias.flatMap((m) => (media.has(m.assetId) ? [{ value: media.get(m.assetId)!, role: m.role }] : []));
        return { index, params: { ...it.params, ...(medias.length ? { medias } : {}), use_unlim: false } };
      });
      const res = await s.call(p.tool, { requests });
      const got = indexedJobIds(res, requests.length);
      if (got.every((x) => !x)) throw new Error("Higgsfield가 작업을 접수하지 않았습니다: " + JSON.stringify(res).slice(0, 300));
      return got;
    });
    await Promise.all(
      ids.map((rowId, i) =>
        jobIds[i]
          ? sb.from("ai_jobs").update({ output: { hfJobId: jobIds[i] } }).eq("id", rowId)
          : fail([rowId], "Higgsfield가 이 항목을 접수하지 않았습니다."),
      ),
    );
    return ids.filter((_, i) => jobIds[i]);
  } catch (e) {
    await fail(ids, e instanceof Error ? e.message : "실패");
    throw e;
  }
}

type Gen = { status?: string; results?: Record<string, unknown>; error?: string };

/** First https URL in the results (prefers raw/original, then video, then any). */
function resultUrl(results: Record<string, unknown> | undefined, prefer: string[]): string | undefined {
  if (!results) return;
  for (const k of prefer) {
    const v = results[k];
    if (typeof v === "string" && v.startsWith("https://")) return v;
    if (v && typeof v === "object" && typeof (v as { url?: string }).url === "string") return (v as { url: string }).url;
  }
  const any = JSON.stringify(results).match(/https:\/\/[^"]+/);
  return any?.[0];
}

const extOf = (mime: string) =>
  mime.includes("mp4") ? "mp4" : mime.includes("quicktime") ? "mov" : mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";

/** Checks the Higgsfield job once (server waits up to ~25s). Saves the result when done. Idempotent. */
type Opened = Awaited<ReturnType<typeof openSession>>;

/**
 * Pass `session` to reuse one MCP connection whose workspace the caller has
 * already selected (see pollUntilDone).
 */
export async function poll(rowId: string, session?: Opened): Promise<"running" | "done" | "failed"> {
  const sb = supabaseAdmin();
  const { data: row } = await sb.from("ai_jobs").select("*").eq("id", rowId).single();
  if (!row || row.status === "done" || row.status === "failed") return (row?.status as "done" | "failed") ?? "failed";
  const hfJobId = (row.output as { hfJobId?: string } | null)?.hfJobId;
  if (!hfJobId) return "running";

  const { s, conn } = session ?? (await openSession(row.workspace_id));
  const ask = () => s.call<{ generation?: Gen } & Gen>("job_status", { jobId: hfJobId, sync: true });
  const r = session ? await ask() : await withWorkspace(s, conn, ask);
  const g: Gen = r.generation ?? r;
  if (g.status && TERMINAL_FAIL.has(g.status)) {
    const reason = g.status === "nsfw" || g.status === "ip_detected" ? "Higgsfield 검수에서 걸렸습니다" : "Higgsfield 생성이 실패했습니다";
    await sb.from("ai_jobs").update({ status: "failed", error: `${reason} (${g.status}).`, finished_at: new Date().toISOString() }).eq("id", rowId);
    return "failed";
  }
  const isVideo = row.kind === "hf_video";
  const mainUrl = resultUrl(g.results, isVideo ? ["rawUrl", "video", "url", "minUrl"] : ["rawUrl", "url", "minUrl"]);
  if (g.status !== "completed" || !mainUrl) return "running";

  // claim the result atomically: only one poller (server loop or browser nudge) downloads and saves it
  const { data: claimed } = await sb
    .from("ai_jobs")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", rowId)
    .eq("status", "running")
    // a claim older than 5 minutes belongs to a poller that died mid-save: take it over
    .or(`claimed_at.is.null,claimed_at.lt.${new Date(Date.now() - 5 * 60_000).toISOString()}`)
    .select("id");
  if (!claimed?.length) {
    const { data: again } = await sb.from("ai_jobs").select("status").eq("id", rowId).single();
    return again?.status === "done" ? "done" : again?.status === "failed" ? "failed" : "running";
  }

  const base = `${row.workspace_id}/${row.project_id}`;
  const id = crypto.randomUUID();
  const main = await fetch(mainUrl);
  const mime = main.headers.get("content-type")?.split(";")[0] || (isVideo ? "video/mp4" : "image/png");
  const bytes = Buffer.from(await main.arrayBuffer());
  // pixel size for images (lets the app tell 3:4 results from older formats)
  const dims = isVideo ? null : await sharp(bytes).metadata().catch(() => null);
  const path = `${base}/${id}.${extOf(mime)}`;
  const up = await sb.storage.from("assets").upload(path, bytes, { contentType: mime });
  if (up.error) {
    await sb
      .from("ai_jobs")
      .update({
        status: "failed",
        error: `결과 파일을 저장하지 못했습니다(${Math.round(bytes.length / 1048576)}MB): ${up.error.message}. Higgsfield 생성 기록에는 남아 있습니다.`,
        finished_at: new Date().toISOString(),
      })
      .eq("id", rowId);
    return "failed";
  }

  // Images: keep Higgsfield's small version as the preview (also what Claude analyses).
  let previewPath: string | undefined;
  let previewMime: string | undefined;
  const minUrl = !isVideo ? resultUrl(g.results, ["minUrl"]) : undefined;
  if (minUrl && minUrl !== mainUrl) {
    const min = await fetch(minUrl);
    previewMime = min.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    previewPath = `${base}/${id}_preview.${extOf(previewMime)}`;
    const { error } = await sb.storage.from("assets").upload(previewPath, Buffer.from(await min.arrayBuffer()), { contentType: previewMime });
    if (error) previewPath = undefined;
  }

  const input = row.input as { label?: string };
  const when = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const { data: asset } = await sb
    .from("assets")
    .insert({
      id,
      workspace_id: row.workspace_id,
      project_id: row.project_id,
      kind: isVideo ? "video" : row.kind === "hf_scene" ? "base" : row.kind === "hf_sketch" ? "acting_ref" : "sheet",
      name: `${input.label ?? "Higgsfield"} ${when}.${extOf(mime)}`,
      storage_path: path,
      mime,
      size_bytes: bytes.length,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      meta: { ...(previewPath ? { previewPath, previewMime } : {}), higgsfieldJobId: hfJobId },
      created_by: row.created_by,
    })
    .select("id")
    .single();
  await sb
    .from("ai_jobs")
    .update({ status: "done", output: { hfJobId, assetId: asset?.id }, finished_at: new Date().toISOString() })
    .eq("id", rowId);
  return "done";
}

/**
 * Background loop right after submission (keeps going if the tab closes). Videos take longer.
 * All rows of one submission share one MCP connection and one workspace switch per round,
 * so parallel checks never flip the account-wide workspace selection against each other.
 */
export async function pollUntilDone(rowIds: string[], budgetMs = 280_000) {
  const until = Date.now() + budgetMs;
  let left = [...rowIds];
  let session: Opened | null = null;
  while (left.length && Date.now() < until) {
    try {
      if (!session) {
        const { data: row } = await supabaseAdmin().from("ai_jobs").select("workspace_id").eq("id", left[0]).single();
        if (!row) return;
        session = await openSession(row.workspace_id as string);
      }
      const opened: Opened = session;
      const states = await withWorkspace(opened.s, opened.conn, () =>
        Promise.all(left.map((id) => poll(id, opened).catch(() => "running" as const))),
      );
      left = left.filter((_, i) => states[i] === "running");
    } catch {
      session = null; // transient (expired session, network): reconnect next round
    }
    if (left.length) await new Promise((r) => setTimeout(r, 4000));
  }
}
