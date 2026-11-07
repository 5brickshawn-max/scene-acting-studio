/**
 * Everything a read-only review shows, loaded with the service role after the
 * review link has been verified. Server only.
 *
 * Deliberately left out: team members' emails and user ids.
 */
import { supabaseAdmin } from "@/lib/supabase/server";
import { parseProjectData, type ProjectData } from "@/lib/domain/project";
import { buildExpressionHandoffs, buildVideoHandoff, type ExpressionHandoff, type VideoHandoff } from "@/lib/domain/handoff";
import { reviewLinksCancelledAt, verifyReviewToken } from "@/lib/review-link";

/** Signed file links stay valid this long; reloading the review makes fresh ones. */
const URL_TTL = 60 * 60 * 2;

export type ReviewAsset = {
  id: string;
  kind: string;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;
  previewUrl: string;
};

export type ReviewJob = {
  id: string;
  kind: string;
  step: number;
  status: string;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  input: unknown;
  output: unknown;
};

export type ReviewBundle = {
  project: { id: string; name: string; version: number; updatedAt: string };
  link: { expiresAt: number };
  data: ProjectData;
  /** every file the project uses or produced, by asset id */
  assets: Record<string, ReviewAsset>;
  /** the exact prompts the app sends to Higgsfield for the saved version */
  prompts: { expressions: ExpressionHandoff[]; video: VideoHandoff };
  jobs: ReviewJob[];
  comments: { step: number; target: string; body: string; resolved: boolean; createdAt: string }[];
  versions: { version: number; kind: string; note: string | null; createdAt: string }[];
};

export type ReviewResult = { ok: true; bundle: ReviewBundle } | { ok: false; reason: "invalid" | "expired" | "cancelled" | "missing" };

function referencedAssetIds(d: ProjectData): string[] {
  return [
    d.baseAssetId,
    ...d.designRefAssetIds,
    d.expressionSetup.refAssetId,
    d.expressionSetup.sheetAssetId,
    ...d.expressions.map((e) => e.imageAssetId),
    d.video.startFrameAssetId,
    d.video.endFrameAssetId,
    ...d.video.resultAssetIds,
  ].filter((x): x is string => Boolean(x));
}

export async function openReview(token: string): Promise<ReviewResult> {
  const check = verifyReviewToken(token);
  if (!check.ok) return check;
  const { projectId, issuedAt, expiresAt } = check.claims;
  const sb = supabaseAdmin();

  const { data: project } = await sb
    .from("projects")
    .select("id, workspace_id, name, current_version, updated_at")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, reason: "missing" };
  if (issuedAt <= (await reviewLinksCancelledAt(sb, project.workspace_id, project.id))) return { ok: false, reason: "cancelled" };

  const [{ data: ver }, { data: jobs }, { data: comments }, { data: versions }] = await Promise.all([
    sb.from("project_versions").select("data").eq("project_id", projectId).eq("version", project.current_version).maybeSingle(),
    sb
      .from("ai_jobs")
      .select("id, kind, step, status, input, output, error, created_at, finished_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(40),
    sb.from("review_comments").select("step, target, body, resolved, created_at").eq("project_id", projectId).order("created_at"),
    sb
      .from("project_versions")
      .select("version, kind, note, created_at")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(30),
  ]);
  const data = parseProjectData(ver?.data);

  // This project's files plus any reused from other projects (same workspace only).
  const cols = "id, kind, name, mime, width, height, storage_path, meta, created_at";
  const refIds = referencedAssetIds(data);
  const [{ data: own }, { data: reused }] = await Promise.all([
    sb.from("assets").select(cols).eq("project_id", projectId).is("deleted_at", null),
    refIds.length
      ? sb.from("assets").select(cols).in("id", refIds).eq("workspace_id", project.workspace_id)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const rows = [...(own ?? []), ...(reused ?? []).filter((r) => !(own ?? []).some((o) => o.id === r.id))];
  const previewOf = (r: { meta: unknown }) => (r.meta as { previewPath?: string } | null)?.previewPath;
  const paths = rows.flatMap((r) => [r.storage_path as string, previewOf(r)].filter((x): x is string => Boolean(x)));
  // File links never outlive the review link itself.
  const ttl = Math.max(60, Math.min(URL_TTL, Math.floor((expiresAt - Date.now()) / 1000)));
  const { data: signed } = paths.length ? await sb.storage.from("assets").createSignedUrls(paths, ttl) : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const assets: Record<string, ReviewAsset> = {};
  for (const r of rows) {
    const url = urlOf.get(r.storage_path) ?? "";
    const preview = previewOf(r);
    assets[r.id] = {
      id: r.id,
      kind: r.kind,
      name: r.name,
      mime: r.mime,
      width: r.width,
      height: r.height,
      createdAt: r.created_at,
      url,
      previewUrl: (preview && urlOf.get(preview)) || url,
    };
  }

  return {
    ok: true,
    bundle: {
      project: { id: project.id, name: project.name, version: project.current_version, updatedAt: project.updated_at },
      link: { expiresAt },
      data,
      assets,
      prompts: {
        expressions: buildExpressionHandoffs(data),
        video: buildVideoHandoff(data, data.video.startFrameAssetId ? "start_frame" : "references"),
      },
      jobs: (jobs ?? []).map((j) => ({
        id: j.id,
        kind: j.kind,
        step: j.step,
        status: j.status,
        createdAt: j.created_at,
        finishedAt: j.finished_at,
        error: j.error,
        input: j.input,
        output: j.output,
      })),
      comments: (comments ?? []).map((c) => ({ step: c.step, target: c.target, body: c.body, resolved: c.resolved, createdAt: c.created_at })),
      versions: (versions ?? []).map((v) => ({ version: v.version, kind: v.kind, note: v.note, createdAt: v.created_at })),
    },
  };
}

export const REVIEW_FAIL_MESSAGE: Record<Exclude<ReviewResult, { ok: true }>["reason"], string> = {
  invalid: "올바른 검토용 링크가 아닙니다. 링크 전체를 복사했는지 확인하세요.",
  expired: "검토용 링크의 사용 기간이 끝났습니다. 작업 화면에서 새 링크를 만드세요.",
  cancelled: "이 검토용 링크는 끊긴 링크입니다. 작업 화면에서 새 링크를 만드세요.",
  missing: "이 링크의 작업을 찾을 수 없습니다. 삭제되었을 수 있습니다.",
};
