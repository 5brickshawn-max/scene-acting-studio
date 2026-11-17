"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProjectData } from "@/lib/domain/project";
import { defaultResult, junction } from "@/lib/domain/sequence";
import type { AssetView } from "@/lib/types";

type Scene = { id: string; name: string; data: ProjectData };

const STEP_NAMES = ["출연진", "표정", "대사", "액팅", "영상"];
const fmt = (s: number) => `${Math.round(s * 10) / 10}초`;
/** a signed storage URL that downloads with a file name instead of playing */
const downloadUrl = (a: AssetView) => `${a.url}${a.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(a.name)}`;

export function SequenceView(props: {
  projectId: string;
  canEdit: boolean;
  rootId: string;
  scenes: Scene[];
  branches: { afterId: string; scenes: { id: string; name: string }[] }[];
  assets: AssetView[];
  merges: AssetView[];
}) {
  const router = useRouter();
  const assets = new Map(props.assets.map((a) => [a.id, a]));
  // which result video each scene adds (default: its newest one; "" = leave the scene out)
  const [pick, setPick] = useState<Record<string, string>>(() => Object.fromEntries(props.scenes.map((s) => [s.id, defaultResult(s.data) ?? ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; duration: number } | null>(null);

  const parts = props.scenes.filter((s) => pick[s.id]).map((s) => ({ projectId: s.id, assetId: pick[s.id] }));
  const missing = props.scenes.filter((s) => !pick[s.id]);
  const roughSeconds = props.scenes.filter((s) => pick[s.id]).reduce((a, s) => a + s.data.acting.duration, 0);
  const here = props.scenes.find((s) => s.id === props.projectId) ?? props.scenes[0];

  async function call(action: string, body: object, what: string) {
    setBusy(what);
    setError(null);
    const res = await fetch(`/api/projects/${props.projectId}/sequence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(out.error ?? "실패했습니다.");
      return null;
    }
    return out;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href={`/projects/${props.projectId}`} className="text-[14px] text-muted underline">
            ← {here.name}(으)로 돌아가기
          </Link>
          <h1 className="text-2xl font-bold">시퀀스 · {props.scenes[0].name}</h1>
          <p className="text-muted">
            ‘다음 장면 만들기’로 이어진 장면 {props.scenes.length}개 · 고른 영상 합계 약 {fmt(roughSeconds)}. 장면마다 넣을 결과 영상을 고르고, 맨 아래에서 한 편으로 합칩니다.
          </p>
        </div>
      </div>

      {props.scenes.length === 1 && (
        <p className="notice notice-info">
          아직 이 장면 하나뿐입니다. 장면 화면 위쪽의 ‘다음 장면 만들기’로 이어지는 장면을 만들면 여기에 순서대로 나타납니다.
        </p>
      )}

      <ol className="space-y-3">
        {props.scenes.map((s, i) => {
          const prev = i > 0 ? props.scenes[i - 1] : null;
          const j = prev ? junction(prev.data, s.data) : null;
          const chosen = pick[s.id] ? assets.get(pick[s.id]) : undefined;
          const start = s.data.video.startFrameAssetId ? assets.get(s.data.video.startFrameAssetId) : undefined;
          const branch = props.branches.find((b) => b.afterId === s.id);
          return (
            <li key={s.id} className="space-y-3">
              {prev && j && (
                <div className="ml-6 border-l-2 border-line-strong pl-4 py-1 space-y-2 text-[14px]">
                  <div className="font-semibold text-muted">↓ {prev.name}에서 이어짐</div>
                  {j.endChanged ? (
                    <div className="notice notice-warn space-y-2">
                      <p>
                        이 장면을 만든 뒤 앞 장면의 끝이 바뀌었습니다. 지금 앞 장면은 이렇게 끝납니다: <strong>{j.endNow}</strong>
                      </p>
                      {props.canEdit && (
                        <button
                          className="btn btn-sm"
                          disabled={Boolean(busy)}
                          onClick={async () => {
                            if (await call("refresh_end", { projectId: s.id }, `end-${s.id}`)) router.refresh();
                          }}
                        >
                          {busy === `end-${s.id}` ? "가져오는 중…" : "끝 상태 다시 가져오기"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted">앞 장면의 끝 상태에서 시작하도록 설계됩니다: {s.data.previous?.endState || "(기록 없음)"}</p>
                  )}
                  {start ? (
                    <div className="flex items-center gap-3">
                      <img src={start.previewUrl} alt="" className="h-16 rounded border border-line" />
                      <span className="text-muted">끊김 없이 이어 가기: 이 장면 영상은 이 시작 프레임에서 시작합니다(5단계 ‘시작 프레임’).</span>
                    </div>
                  ) : null}
                  {props.canEdit && pick[prev.id] && (
                    <div className="space-y-1">
                      <button
                        className="btn btn-sm"
                        disabled={Boolean(busy)}
                        onClick={async () => {
                          if (await call("lastframe", { fromAssetId: pick[prev.id], toProjectId: s.id }, `frame-${s.id}`)) router.refresh();
                        }}
                      >
                        {busy === `frame-${s.id}` ? "마지막 프레임 가져오는 중…" : start ? "앞 영상 마지막 프레임으로 다시 바꾸기" : "끊김 없이 이어 가기 — 앞 영상의 마지막 프레임을 시작 프레임으로"}
                      </button>
                      <p className="field-help">
                        같은 쇼트가 장면을 넘어 이어질 때만 쓰세요. 시작 프레임이 있으면 이 장면 영상은 참고 그림 대신 그 프레임에서 시작하는 방식으로 만들어집니다(컷으로 넘어가는 장면은 필요 없음).
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-line bg-white p-4 grid md:grid-cols-[1fr_320px] gap-4">
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid place-items-center size-8 rounded-full bg-[#26301f] text-white font-bold">{i + 1}</span>
                    <Link href={`/projects/${s.id}`} className="font-semibold text-lg underline truncate">
                      {s.name}
                    </Link>
                    {s.id === props.projectId && <span className="pill pill-accent">지금 장면</span>}
                  </div>
                  <p className="text-[14px] text-muted">
                    {s.data.mode === "storyboard" ? `스토리보드 · 컷 ${s.data.expressions.length}개` : `인물 ${s.data.cast.length}명`} · {fmt(s.data.acting.duration)} · 승인{" "}
                    {s.data.approvedThrough >= 0 ? `${STEP_NAMES[Math.min(4, s.data.approvedThrough)]}까지` : "전"}
                  </p>
                  {s.data.video.resultAssetIds.length ? (
                    <label className="block space-y-1">
                      <span className="field-label">이 장면에서 넣을 영상</span>
                      <select className="input" value={pick[s.id]} onChange={(e) => setPick((p) => ({ ...p, [s.id]: e.target.value }))}>
                        {[...s.data.video.resultAssetIds].reverse().map((id, k) => (
                          <option key={id} value={id}>
                            {k === 0 ? "최신 · " : ""}
                            {assets.get(id)?.name ?? "결과 영상"}
                          </option>
                        ))}
                        <option value="">넣지 않음</option>
                      </select>
                    </label>
                  ) : (
                    <p className="notice notice-warn text-[14px]">아직 결과 영상이 없습니다. 이 장면의 5단계에서 영상을 만들면 여기에서 고를 수 있습니다.</p>
                  )}
                  {branch && (
                    <p className="text-[13px] text-muted">
                      이 장면 다음에 만든 다른 갈래: {branch.scenes.map((b) => b.name).join(", ")} — 시퀀스에는 가장 최근에 고친 장면이 이어집니다.
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-line bg-black/5 grid place-items-center overflow-hidden min-h-32">
                  {chosen ? <video src={chosen.url} controls preload="metadata" className="w-full max-h-56" /> : <span className="text-[13px] text-muted">영상 없음</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <section className="rounded-xl border-2 border-[#c6dfbf] bg-[#f7fbf5] p-5 space-y-3">
        <h2 className="section-title">한 편으로 합치기</h2>
        <p className="text-[14px] text-muted">
          고른 영상 {parts.length}개를 순서대로 이어 MP4 한 편으로 만듭니다(화면 비율 {props.scenes[0].data.video.aspectRatio}, 크기가 다른 영상은 늘이지 않고 여백을 붙여 맞춤, 소리 없는 영상은 무음으로 채움).
          {missing.length > 0 && ` 영상이 없거나 ‘넣지 않음’인 장면 ${missing.length}개(${missing.map((s) => s.name).join(", ")})는 빠집니다.`}
        </p>
        {props.canEdit && (
          <button
            className="btn btn-dark"
            disabled={Boolean(busy) || parts.length === 0}
            onClick={async () => {
              const out = await call("merge", { parts }, "merge");
              if (out) {
                setMade({ url: out.url, duration: out.duration });
                router.refresh();
              }
            }}
          >
            {busy === "merge" ? `합치는 중… (영상 ${parts.length}개, 1~2분)` : `한 편으로 합치기 (영상 ${parts.length}개, 약 ${fmt(roughSeconds)})`}
          </button>
        )}
        {error && <p className="notice notice-error">{error}</p>}
        {made && (
          <div className="space-y-2">
            <p className="notice notice-ok">합쳤습니다 · {fmt(made.duration)}. 아래 ‘합본 기록’에 저장되었습니다.</p>
            <video src={made.url} controls className="w-full max-w-[720px] rounded border border-line" />
          </div>
        )}
        {props.merges.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold">합본 기록</h3>
            <ul className="space-y-3">
              {props.merges.map((m) => (
                <li key={m.id} className="rounded-lg border border-line bg-white p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[14px] font-semibold break-all">{m.name}</span>
                    <a className="btn btn-sm btn-primary" href={downloadUrl(m)}>
                      내려받기
                    </a>
                  </div>
                  <video src={m.url} controls preload="metadata" className="w-full max-w-[720px] rounded" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </section>
  );
}
