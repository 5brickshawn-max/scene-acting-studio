import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canEdit, getCtx } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { loadScene, loadSequence } from "@/lib/sequence-server";
import { sceneEndState } from "@/lib/domain/project";
import { joinVideos, lastFrame, sequenceSize } from "@/lib/video-merge";

// joining a minute of video re-encodes it: allow the long limit
export const maxDuration = 800;

const Body = z.discriminatedUnion("action", [
  /** join the chosen result videos, in sequence order, into one MP4 */
  z.object({ action: z.literal("merge"), parts: z.array(z.object({ projectId: z.string().max(64), assetId: z.string().max(64) })).min(1).max(40) }),
  /** the last frame of a video becomes the next scene's start frame (a seamless join) */
  z.object({ action: z.literal("lastframe"), fromAssetId: z.string().max(64), toProjectId: z.string().max(64) }),
  /** take again where the scene before now ends */
  z.object({ action: z.literal("refresh_end"), projectId: z.string().max(64) }),
  /** a plain cut between the scenes: a start frame taken from the scene before is let go */
  z.object({ action: z.literal("join_cut"), projectId: z.string().max(64) }),
]);

const when = () => new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await getCtx();
  if (!ctx) return NextResponse.json({ error: "작업함 권한이 없습니다." }, { status: 403 });
  if (!canEdit(ctx.role)) return NextResponse.json({ error: "검토자는 시퀀스를 바꿀 수 없습니다." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const body = parsed.data;
  const user = await supabaseServer();
  const seq = await loadSequence(user, ctx.workspaceId, id);
  if (!seq) return NextResponse.json({ error: "장면을 찾을 수 없습니다." }, { status: 404 });
  const inSeq = new Map(seq.scenes.map((s) => [s.id, s]));
  const admin = supabaseAdmin();

  /** a video asset of this workspace, downloaded to a temp file */
  async function fetchVideo(assetId: string, dir: string, n: number) {
    const { data: a } = await admin.from("assets").select("workspace_id, storage_path, mime, deleted_at").eq("id", assetId).single();
    if (!a || a.workspace_id !== ctx!.workspaceId || a.deleted_at || !String(a.mime).startsWith("video/")) throw new Error("영상 파일을 찾을 수 없습니다.");
    const { data: file, error } = await admin.storage.from("assets").download(a.storage_path);
    if (error || !file) throw new Error(`영상을 내려받지 못했습니다: ${error?.message ?? ""}`);
    const p = path.join(dir, `in${n}.mp4`);
    await fs.writeFile(p, Buffer.from(await file.arrayBuffer()));
    return p;
  }

  /** store a file as an asset of a project */
  async function store(projectId: string, file: string, kind: string, name: string, mime: string, meta: object, dims?: { width: number; height: number }) {
    const assetId = crypto.randomUUID();
    const ext = mime === "video/mp4" ? "mp4" : "png";
    const storagePath = `${ctx!.workspaceId}/${projectId}/${assetId}.${ext}`;
    const bytes = await fs.readFile(file);
    const up = await admin.storage.from("assets").upload(storagePath, bytes, { contentType: mime });
    if (up.error) throw new Error(`파일을 저장하지 못했습니다(${Math.round(bytes.length / 1048576)}MB): ${up.error.message}`);
    const { error } = await admin.from("assets").insert({
      id: assetId,
      workspace_id: ctx!.workspaceId,
      project_id: projectId,
      kind,
      name,
      storage_path: storagePath,
      mime,
      size_bytes: bytes.length,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      meta,
      created_by: ctx!.userId,
    });
    if (error) throw new Error(`자료를 등록하지 못했습니다: ${error.message}`);
    const { data: signed } = await admin.storage.from("assets").createSignedUrl(storagePath, 60 * 60 * 6);
    return { assetId, url: signed?.signedUrl ?? "" };
  }

  /** save one field change into a scene as a new version (the team's own save path, with its edit check) */
  async function saveScene(projectId: string, change: (d: NonNullable<ReturnType<typeof inSeq.get>>["data"]) => typeof d, note: string) {
    const s = await loadScene(user, ctx!.workspaceId, projectId);
    if (!s) throw new Error("장면을 찾을 수 없습니다.");
    const { error } = await user.rpc("save_project", { p_project_id: projectId, p_expected_version: s.version, p_data: change(s.data), p_kind: "save", p_note: note });
    if (error) throw new Error(error.message.includes("version_conflict") ? "그 장면이 방금 다른 곳에서 저장되었습니다. 새로고침 후 다시 시도하세요." : error.message);
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seq-"));
  try {
    if (body.action === "merge") {
      const parts = body.parts.filter((p) => inSeq.get(p.projectId)?.data.video.resultAssetIds.includes(p.assetId));
      if (parts.length !== body.parts.length) return NextResponse.json({ error: "이 시퀀스의 결과 영상만 합칠 수 있습니다." }, { status: 400 });
      const files: string[] = [];
      for (const [n, p] of parts.entries()) files.push(await fetchVideo(p.assetId, dir, n));
      const size = sequenceSize(inSeq.get(seq.rootId)!.data.video.aspectRatio);
      const out = path.join(dir, "joined.mp4");
      const made = await joinVideos(files, out, size);
      const root = inSeq.get(seq.rootId)!;
      const saved = await store(
        seq.rootId,
        out,
        "video",
        `시퀀스 합본 · ${root.name} 외 ${parts.length - 1}장면 · ${Math.round(made.duration * 10) / 10}초 · ${when()}.mp4`,
        "video/mp4",
        { sequence: { parts, duration: made.duration } },
        { width: made.width, height: made.height },
      );
      return NextResponse.json({ ...saved, duration: made.duration });
    }

    if (body.action === "lastframe") {
      const to = inSeq.get(body.toProjectId);
      const index = seq.scenes.findIndex((s) => s.id === body.toProjectId);
      const before = index > 0 ? seq.scenes[index - 1] : null;
      if (!to || !before || !before.data.video.resultAssetIds.includes(body.fromAssetId))
        return NextResponse.json({ error: "바로 앞 장면의 결과 영상에서만 가져올 수 있습니다." }, { status: 400 });
      const file = await fetchVideo(body.fromAssetId, dir, 0);
      const png = path.join(dir, "last.png");
      await lastFrame(file, png);
      const saved = await store(body.toProjectId, png, "design_ref", `앞 장면 마지막 프레임 · ${before.name} · ${when()}.png`, "image/png", {
        lastFrameOf: body.fromAssetId,
      });
      await saveScene(
        body.toProjectId,
        (d) => ({
          ...d,
          previous: d.previous ? { ...d.previous, join: "seamless" as const } : d.previous,
          video: { ...d.video, startFrameAssetId: saved.assetId },
        }),
        "시퀀스: 끊김 없이 이어 가기 (앞 장면 마지막 프레임을 시작 프레임으로)",
      );
      return NextResponse.json(saved);
    }

    if (body.action === "join_cut") {
      const scene = inSeq.get(body.projectId);
      if (!scene?.data.previous) return NextResponse.json({ error: "앞 장면이 없습니다." }, { status: 400 });
      // only a start frame made from the scene before goes; one the team set for another reason stays
      const start = scene.data.video.startFrameAssetId;
      const { data: a } = start ? await admin.from("assets").select("meta").eq("id", start).single() : { data: null };
      const fromBefore = Boolean((a?.meta as { lastFrameOf?: string } | null)?.lastFrameOf);
      await saveScene(
        body.projectId,
        (d) => ({
          ...d,
          previous: d.previous ? { ...d.previous, join: "cut" as const } : d.previous,
          video: fromBefore ? { ...d.video, startFrameAssetId: null } : d.video,
        }),
        "시퀀스: 컷 편집(하드 컷)으로 넘어가기",
      );
      return NextResponse.json({ cleared: fromBefore });
    }

    // refresh_end
    const index = seq.scenes.findIndex((s) => s.id === body.projectId);
    const before = index > 0 ? seq.scenes[index - 1] : null;
    if (!before) return NextResponse.json({ error: "앞 장면이 없습니다." }, { status: 400 });
    const endState = sceneEndState(before.data);
    await saveScene(
      body.projectId,
      (d) => ({ ...d, previous: d.previous ? { ...d.previous, name: before.name, endState } : d.previous }),
      "시퀀스: 앞 장면 끝 상태 다시 가져오기",
    );
    return NextResponse.json({ endState });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "실패했습니다." }, { status: 500 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
