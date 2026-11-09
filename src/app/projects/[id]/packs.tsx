"use client";
import { useState } from "react";
import { continuityAnchor, imageAspectFor, shotsOf, timelineOrder } from "@/lib/domain/project";
import { composeImages, fetchAll, freshAssets, padImage, safeName, saveBlob, stamp, text, zipFiles, type PackFile } from "@/lib/export";
import { useEditor } from "./editor-context";

const two = (n: number) => String(n).padStart(2, "0");

type ExpressionItem = {
  expressionId: string;
  index: number;
  emotion: string;
  aspectRatio: string;
  references: { role: string; assetId: string; why: string }[];
  prompt: string;
};
type VideoPack = {
  version: number;
  references: { assetId: string; label: string; parts?: { assetId: string }[] }[];
  prompt: string;
  negativePrompt?: string;
  cameraMove: boolean;
  adjustments: { where: string; rule: string; before: string; after: string }[];
  overrides: string[];
};

async function getHandoff<T>(projectId: string, kind: "video" | "expressions"): Promise<T> {
  const res = await fetch(`/api/projects/${projectId}/handoff?kind=${kind}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "프롬프트를 만들지 못했습니다.");
  return body as T;
}

/** Busy label, progress and error for one download button. */
function useTask() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: (progress: (msg: string) => void) => Promise<void>) {
    setBusy("준비 중…");
    setError(null);
    try {
      await fn(setBusy);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run };
}

/* ───────────── Step 2: expression images by hand ───────────── */

/** One folder per expression: its reference images in attach order + the prompt. */
export function ExpressionPackButton() {
  const { doc, projectId } = useEditor();
  const { busy, error, run } = useTask();

  return (
    <div className="space-y-1">
      <button
        className="btn"
        disabled={!!busy}
        onClick={() =>
          run(async (progress) => {
            await doc.flush();
            const data = doc.data;
            const { items, version } = await getHandoff<{ items: ExpressionItem[]; version: number }>(projectId, "expressions");
            const rows = await freshAssets(items.flatMap((it) => it.references.map((r) => r.assetId)));
            const got = await fetchAll(rows, (d, t) => progress(`그림 받는 중 ${d}/${t}`));
            const bytesOf = new Map(rows.map((r, i) => [r.id, { bytes: got[i], ext: r.ext }]));
            const anchor = continuityAnchor(data);
            const first = timelineOrder(data)[0];
            const files: PackFile[] = [];
            for (const it of items) {
              const isAnchor = anchor ? anchor.id === it.expressionId : first?.id === it.expressionId;
              const dir = `${two(it.index + 1)}_${safeName(it.emotion || "표정", 20)}${isAnchor ? "_기준그림" : ""}`;
              it.references.forEach((r, k) => {
                const f = bytesOf.get(r.assetId);
                if (f?.bytes) files.push({ path: `${dir}/참고${k + 1}_${safeName(r.why, 24)}.${f.ext}`, data: f.bytes });
              });
              files.push(text(`${dir}/프롬프트.txt`, it.prompt));
            }
            const anchorNo = anchor ? data.expressions.findIndex((e) => e.id === anchor.id) + 1 : first ? data.expressions.findIndex((e) => e.id === first.id) + 1 : 1;
            files.push(
              text(
                "작업안내.txt",
                [
                  `${data.title || "작업"} — Higgsfield 표정 그림 수동 제작용 (v${version})`,
                  "",
                  "표정마다 폴더가 하나씩 있습니다. 폴더마다:",
                  "1. higgsfield.ai에서 그림 모델을 고릅니다 (Nano Banana 2.1 또는 GPT Image 2.5, 1K).",
                  "2. 폴더의 ‘참고1, 참고2 …’ 그림을 번호 순서대로 첨부합니다.",
                  `3. ‘프롬프트.txt’를 붙여넣고 화면 비율 ${imageAspectFor(data)}로 한 장 만듭니다.`,
                  "4. 결과 그림을 앱 2단계의 해당 표정 칸에 올립니다.",
                  "",
                  "표정 그림들은 컷 없는 한 쇼트의 순간들입니다.",
                  anchor
                    ? `‘_기준그림’ 폴더(${anchorNo}번 표정)가 연결 기준입니다. 다른 폴더에는 이 그림이 참고로 들어 있어, 같은 구도·크기·위치로 그려집니다.`
                    : `아직 연결 기준 그림이 없습니다. ‘_기준그림’ 폴더(${anchorNo}번 표정)를 먼저 만들어 앱에 올린 뒤 이 ZIP을 다시 받으면, 나머지 폴더에 기준 그림이 참고로 들어갑니다.`,
                ].join("\n"),
              ),
            );
            progress("ZIP 만드는 중…");
            saveBlob(await zipFiles(files), `${safeName(data.title || "작업")}_Higgsfield표정_v${version}_${stamp()}.zip`);
          })
        }
      >
        {busy ?? "표정 작업 파일 저장 (ZIP)"}
      </button>
      {error && <p className="notice notice-error">{error}</p>}
    </div>
  );
}

/* ───────────── Step 5: the video by hand ───────────── */

/** Reference images in attach order (padded to the video's shape), the prompt with the constraints, and instructions. */
export function HiggsfieldVideoPack() {
  const { doc, projectId } = useEditor();
  const { busy, error, run } = useTask();
  const v = doc.data.video;

  return (
    <section className="rounded-xl border border-line bg-[#f7f8fa] p-5 space-y-3" aria-labelledby="hf-pack">
      <h3 id="hf-pack" className="section-title">Higgsfield에서 직접 만들기용 파일 (ZIP)</h3>
      <p className="text-muted">
        참고 그림(첨부 순서대로, 영상 비율에 맞춰 흰 여백 처리), 영상 프롬프트(제약사항 포함), 작업 안내를 ZIP 하나로 저장합니다. higgsfield.ai에서 직접 만들 때 씁니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() =>
            run(async (progress) => {
              await doc.flush();
              const data = doc.data;
              const h = await getHandoff<VideoPack>(projectId, "video");
              const start = data.video.startFrameAssetId;
              const end = start ? data.video.endFrameAssetId : null;
              const slots: { assetId: string; label: string; parts?: string[] }[] = start
                ? [{ assetId: start, label: "시작 프레임" }, ...(end ? [{ assetId: end, label: "끝 프레임" }] : [])]
                : h.references.map((r) => ({ assetId: r.assetId, label: r.label.split(" — ")[0], parts: r.parts?.map((p) => p.assetId) }));
              const rows = await freshAssets(slots.flatMap((x) => x.parts ?? [x.assetId]));
              const byId = new Map(rows.map((r) => [r.id, r]));
              // every file to fetch (the parts of a combined image are fetched one by one, then joined)
              const flat = slots.flatMap((x, slot) => (x.parts ?? [x.assetId]).map((id) => ({ slot, row: byId.get(id), url: byId.get(id)?.url ?? "" })));
              const fetched = await fetchAll(flat, (d, t) => progress(`그림 받는 중 ${d}/${t}`));
              progress("영상 비율에 맞추는 중…");
              const files: PackFile[] = [];
              const listed: string[] = [];
              for (const [i, it] of slots.entries()) {
                const mine = flat.map((f, k) => ({ ...f, b: fetched[k] })).filter((f) => f.slot === i);
                if (!mine.length || mine.some((f) => !f.b || !f.row)) {
                  listed.push(`${i + 1}. ${it.label} — (파일을 받지 못함)`);
                  continue;
                }
                if (it.parts) {
                  const joined = await composeImages(mine.map((f) => f.b!), data.video.aspectRatio).catch(() => null);
                  if (!joined) {
                    listed.push(`${i + 1}. ${it.label} — (그림을 합치지 못함)`);
                    continue;
                  }
                  const name = `${two(i + 1)}_${safeName(it.label)}.png`;
                  files.push({ path: name, data: joined });
                  listed.push(`${i + 1}. ${name} (이어지는 컷을 왼쪽부터 나란히 붙인 그림)`);
                  continue;
                }
                const { b, row } = mine[0];
                const padded = row!.mime.startsWith("image/") ? await padImage(b!, data.video.aspectRatio).catch(() => null) : null;
                const name = `${two(i + 1)}_${safeName(it.label)}.${padded ? "png" : row!.ext}`;
                files.push({ path: name, data: padded ?? b! });
                listed.push(`${i + 1}. ${name}`);
              }
              files.push(text("프롬프트.txt", h.prompt));
              if (h.negativePrompt) files.push(text("네거티브프롬프트.txt", h.negativePrompt));
              files.push(
                text(
                  "작업안내.txt",
                  [
                    `${data.title || "작업"} — Higgsfield 영상 수동 제작용 (v${h.version})`,
                    "",
                    `1. higgsfield.ai에서 영상 모델을 고릅니다 (Kling 4.0 또는 Seedance 2.5 — 둘 다 최대 30초${Math.ceil(data.acting.duration) > 10 ? `; Gemini Omni Flash 1.2는 참고 그림·끝 프레임을 쓰면 최대 10초라 ${Math.ceil(data.acting.duration)}초 장면이 잘립니다` : ""}).`,
                    start
                      ? `2. 아래 그림을 시작 프레임(첫 장면)으로 첨부합니다.${end ? " 끝 프레임은 마지막 장면(end frame)으로 첨부합니다 (Kling 4.0·MiniMax H3)." : ""}`
                      : "2. 아래 그림을 번호 순서대로 참고 그림으로 첨부합니다. 번호가 프롬프트의 reference image 번호와 같아야 합니다.",
                    `   그림은 영상 비율(${data.video.aspectRatio})에 맞춰 흰 여백을 붙였습니다. 인물이 늘어나거나 찌그러지지 않게 하려는 것이니 원본 대신 이 파일을 쓰세요.`,
                    `3. ‘프롬프트.txt’를 그대로 붙여넣습니다 (${h.prompt.length.toLocaleString("ko-KR")}자, 맨 끝에 스튜디오 제약사항 포함).`,
                    "   네거티브 프롬프트 칸이 있으면(Kling 등) ‘네거티브프롬프트.txt’를 그 칸에 넣고, creativity/relevance는 relevance 쪽으로 올리세요.",
                    `4. 길이 ${Math.ceil(data.acting.duration)}초${
                      data.acting.duration % 1 ? ` (액팅 ${data.acting.duration}초를 올림 — Higgsfield는 초 단위)` : ""
                    }, 화면 비율 ${data.video.aspectRatio}로 생성합니다. ${
                      shotsOf(data).length > 1 ? `컷 분할 ${shotsOf(data).length}쇼트입니다 (프롬프트가 컷 위치를 지시).` : "컷 없는 한 쇼트입니다."
                    }`,
                    "5. 완성된 MP4를 앱의 5단계 ‘생성한 영상’에 올립니다.",
                    "",
                    start ? "시작·끝 프레임:" : "참고 그림 순서:",
                    ...listed,
                    "",
                    `카메라: ${
                      h.overrides.some((o) => o.startsWith("카메라"))
                        ? "추가 연출을 따름"
                        : h.cameraMove
                          ? "움직임 있음 (핸드헬드)"
                          : "움직임 없음 (정지 화면)"
                    }`,
                    ...(h.adjustments.length
                      ? ["", "제약사항과 맞추려고 프롬프트에서 자동으로 고친 부분:", ...h.adjustments.map((a) => `- ${a.where}: ${a.rule}`)]
                      : []),
                  ].join("\n"),
                ),
              );
              progress("ZIP 만드는 중…");
              saveBlob(await zipFiles(files), `${safeName(data.title || "작업")}_Higgsfield영상_v${h.version}_${stamp()}.zip`);
            })
          }
        >
          {busy ?? "Higgsfield용 파일 저장 (ZIP)"}
        </button>
        <a className="btn" href="https://higgsfield.ai" target="_blank" rel="noreferrer">
          higgsfield.ai 열기 ↗
        </a>
      </div>
      <p className="field-help">
        {v.aspectRatio} · {doc.data.acting.duration}초 · {v.startFrameAssetId ? "시작 프레임 방식" : "참고 그림 방식"}. 완성된 MP4는 아래 ‘생성한 영상’에 올리세요.
      </p>
      {error && <p className="notice notice-error">{error}</p>}
    </section>
  );
}
