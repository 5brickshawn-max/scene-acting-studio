"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { fetchAsset } from "@/lib/upload";
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  videoDuration,
  videoMaxDuration,
  defaultResolution,
  type ImageModelKey,
  type VideoModelKey,
} from "@/lib/higgsfield/models";
import type { JobView } from "@/lib/types";
import { FRAMING_LABEL, castLabel, continuityAnchor, imageAspectFor, imageIsStale, timelineOrder, type Framing } from "@/lib/domain/project";
import { useEditor } from "../editor-context";

type Quote = { credits: number | null; each?: number | null; count?: number; balance: number | null; workspace: string | null; model: string; references: number };
type Spec =
  | { target: "expressions"; model: string; expressionIds?: string[]; fixes?: Record<string, string> }
  | { target: "sketch"; model: string; expressionIds?: string[] }
  | { target: "video"; model: string; resolution: string }
  | { target: "finalize"; draftRowId: string }
  | { target: "frame"; model: string; expressionId: string; shot: Framing; slot: "start" | "end" }
  | { target: "scene"; model: string };

const fmtCredits = (n: number | null) => (n === null ? "?" : Math.floor(n).toLocaleString("ko-KR"));

/** Shared quote → generate → poll logic for one kind of Higgsfield job. */
function useHfJobs(kind: "hf_expr" | "hf_video" | "hf_frame" | "hf_scene" | "hf_sketch") {
  const { projectId, doc, jobs, assets, addAsset } = useEditor();
  const [quote, setQuote] = useState<{ spec: Spec; q: Quote } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = jobs.jobs.filter((j) => j.kind === kind);
  const running = mine.filter((j) => j.status === "running" || j.status === "queued");
  const pending = mine.filter((j) => j.status === "done" && j.applied_version === null);
  const lastFailed = mine[0]?.status === "failed" ? mine[0] : null;

  // Load result assets for preview (each one once, even while the request is in flight).
  const requested = useRef(new Set<string>());
  const pendingAssetIds = pending
    .map((j) => (j.output as { assetId?: string } | null)?.assetId)
    .filter((id): id is string => Boolean(id))
    .join(",");
  useEffect(() => {
    for (const id of pendingAssetIds ? pendingAssetIds.split(",") : []) {
      if (assets.has(id) || requested.current.has(id)) continue;
      requested.current.add(id);
      fetchAsset(id).then((a) => a && addAsset(a));
    }
  }, [pendingAssetIds, assets, addAsset]);

  // The server keeps checking a job for ~5 minutes after it starts. Videos can take longer:
  // after that, check each still-running job from here once a minute.
  // (Keyed by a string so the 2.5s job polling does not restart the timer.)
  const runningKey = running.map((r) => `${r.id}@${r.created_at}`).join(",");
  const refresh = jobs.refresh;
  useEffect(() => {
    if (!runningKey) return;
    const list = runningKey.split(",").map((x) => {
      const [id, at] = x.split("@");
      return { id, at: Date.parse(at) };
    });
    const t = setInterval(async () => {
      const stale = list.filter((r) => Date.now() - r.at > 5 * 60_000);
      if (!stale.length) return;
      await Promise.all(stale.map((r) => fetch(`/api/projects/${projectId}/higgsfield?job=${r.id}`).catch(() => null)));
      await refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [runningKey, projectId, refresh]);

  async function call(action: "quote" | "generate", spec: Spec) {
    setBusy(true);
    setError(null);
    await doc.flush();
    const res = await fetch(`/api/projects/${projectId}/higgsfield`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, spec }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? "실패했습니다.");
      return null;
    }
    return body;
  }

  return {
    running,
    pending,
    lastFailed,
    busy,
    error,
    quote,
    cancelQuote: () => setQuote(null),
    askQuote: async (spec: Spec) => {
      const q = await call("quote", spec);
      if (q) setQuote({ spec, q });
    },
    /** returns whether the generation was accepted */
    confirm: async () => {
      if (!quote) return false;
      const r = await call("generate", quote.spec);
      setQuote(null);
      if (r) await jobs.refresh();
      return Boolean(r);
    },
    /** generate without a new cost check (the next step of a sequence the team already confirmed) */
    generate: async (spec: Spec) => {
      const r = await call("generate", spec);
      if (r) await jobs.refresh();
      return Boolean(r);
    },
  };
}

function QuoteBox({
  h,
  onConfirmed,
  onCancel,
  note,
}: {
  h: ReturnType<typeof useHfJobs>;
  onConfirmed?: () => void;
  onCancel?: () => void;
  /** extra line under the price (e.g. a sequence charged once per panel) */
  note?: string | null;
}) {
  if (!h.quote) return null;
  const { q } = h.quote;
  const short = q.credits !== null && q.balance !== null && q.credits > q.balance;
  return (
    <div className="rounded-lg border border-line bg-white p-4 space-y-3" role="alertdialog" aria-label="생성 확인">
      <p>
        <strong>{q.model}</strong> · 참고 그림 {q.references}장
        <br />
        <strong className="text-[17px]">{fmtCredits(q.credits)} 크레딧</strong>
        {q.count && q.count > 1 ? ` (장당 ${q.each ?? "?"})` : ""} 사용 · {q.workspace} (남은 크레딧 {fmtCredits(q.balance)})
      </p>
      {note && <p className="field-help">{note}</p>}
      {short && <p className="notice notice-error">크레딧이 부족합니다. 팀·사용량에서 다른 워크스페이스를 고르세요.</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={h.busy || short} onClick={() => void h.confirm().then((ok) => ok && onConfirmed?.())}>
          {h.busy ? "보내는 중…" : "생성하기"}
        </button>
        <button
          className="btn"
          onClick={() => {
            h.cancelQuote();
            onCancel?.();
          }}
        >
          취소
        </button>
      </div>
    </div>
  );
}

function Status({ h, typical }: { h: ReturnType<typeof useHfJobs>; typical: string }) {
  return (
    <>
      {h.running.length > 0 && (
        <p className="notice notice-info" aria-live="polite">
          Higgsfield에서 생성 중입니다 ({h.running.length}건, 보통 {typical}). 창을 닫아도 계속되며, 끝나면 여기 결과가 나타납니다.
        </p>
      )}
      {h.lastFailed && h.running.length === 0 && <p className="notice notice-error">{h.lastFailed.error ?? "생성에 실패했습니다."}</p>}
      {h.error && <p className="notice notice-error">{h.error}</p>}
    </>
  );
}

function ResultActions({ job, primary, onPrimary, extra }: { job: JobView; primary: string; onPrimary: () => void; extra?: React.ReactNode }) {
  const { jobs, doc, canEdit } = useEditor();
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <button
        className="btn btn-primary"
        onClick={async () => {
          onPrimary();
          await jobs.markApplied(job.id, doc.version);
        }}
      >
        {primary}
      </button>
      {extra}
      <button className="btn" onClick={() => jobs.markApplied(job.id, 0)}>사용하지 않음</button>
    </div>
  );
}

const jobLabel = (j: JobView) => (j.input as { label?: string }).label ?? "Higgsfield";
const jobAssetId = (j: JobView) => (j.output as { assetId?: string } | null)?.assetId;

/* ───────────── Step 1: the opening scene drawn from the scenario ───────────── */

/**
 * 첫 장면 생성: when the team has no scene picture, draw the opening moment from the scenario and the
 * character material, and use the result as the scene reference picture.
 */
export function SceneImageGenerator({ onUse }: { onUse: (assetId: string) => void }) {
  const { doc, canEdit, assets } = useEditor();
  const h = useHfJobs("hf_scene");
  const [model, setModel] = useState<ImageModelKey>("gpt_image_2_6");
  const d = doc.data;
  const ready = canEdit && !h.busy && !h.quote && Boolean(d.expressionSetup.scene.trim() || d.opening.trim());
  const current = d.baseAssetId ? assets.get(d.baseAssetId) : undefined;
  return (
    <section className="rounded-xl border-2 border-[#c6dfbf] bg-[#f7fbf5] p-4 space-y-3" aria-label="첫 장면 생성">
      <p className="text-[14px] text-muted">
        시나리오·첫 장면 묘사·인물 자료로 이 장면의 첫 순간을 그립니다. 고른 그림이 <strong className="text-ink">장면 기준 그림</strong>이 되어 이후 모든 그림과
        영상의 인물·그림체 기준이 됩니다. Higgsfield 구독 크레딧이 차감됩니다.
      </p>
      <div role="group" aria-label="이미지 모델">
        <div className="text-[13px] font-semibold mb-1 text-muted">생성 모델</div>
        <div className="seg">
          {(Object.keys(IMAGE_MODELS) as ImageModelKey[]).map((k) => (
            <button key={k} aria-pressed={model === k} disabled={!canEdit || !!h.quote} onClick={() => setModel(k)}>
              {IMAGE_MODELS[k].label}
            </button>
          ))}
        </div>
      </div>
      {!h.quote && (
        <button className="btn btn-dark" disabled={!ready} onClick={() => h.askQuote({ target: "scene", model })}>
          {h.busy ? "비용 확인 중…" : current ? "첫 장면 다시 생성" : "비용 확인 후 첫 장면 생성"}
        </button>
      )}
      {!d.expressionSetup.scene.trim() && !d.opening.trim() && <p className="field-help">먼저 씬 시놉시스·시나리오나 첫 장면 묘사를 쓰세요.</p>}
      <QuoteBox h={h} />
      <Status h={h} typical="20초~1분" />
      {h.pending.length > 0 && (
        <ol className="grid sm:grid-cols-2 gap-3">
          {h.pending.map((j) => {
            const a = assets.get(jobAssetId(j) ?? "");
            return (
              <li key={j.id} className="rounded-lg border-2 border-[#f3c9ae] bg-[#fffaf5] p-2 space-y-2">
                <div className="text-[13px] font-semibold">새 결과 · {jobLabel(j)}</div>
                {a ? (
                  <a href={a.url} target="_blank" rel="noreferrer">
                    <img src={a.previewUrl} alt="생성한 첫 장면" className="w-full object-contain checker rounded" />
                  </a>
                ) : (
                  <p className="text-[13px] text-muted">불러오는 중…</p>
                )}
                {a && <ResultActions job={j} primary="이 그림을 장면 기준 그림으로 사용" onPrimary={() => onUse(a.id)} />}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ───────────── Step 2 (storyboard): rough sketches ───────────── */

/**
 * 러프 콘티: simple black-line sketches on white for every panel in one go. Each result goes straight into
 * its panel's 러프 스케치 slot (newest wins); a panel can then be redone alone or replaced by hand.
 */
export function SketchGenerator() {
  const { doc, canEdit, jobs } = useEditor();
  const h = useHfJobs("hf_sketch");
  const [model, setModel] = useState<ImageModelKey>("gpt_image_2_6");
  const exps = doc.data.expressions;
  const ready = canEdit && !h.busy && !h.quote;
  const drawable = exps.filter((e) => e.action.trim() || e.camera.trim());
  const missing = drawable.filter((e) => !e.sketchAssetId).map((e) => e.id);
  const ask = (ids?: string[]) => h.askQuote({ target: "sketch", model, expressionIds: ids });

  // finished sketches go into their panels by themselves (oldest first, so the newest one stays)
  const applied = useRef(new Set<string>());
  const { markApplied } = jobs;
  const version = doc.version;
  useEffect(() => {
    if (!canEdit) return;
    const ready = [...h.pending].reverse().filter((j) => jobAssetId(j) && !applied.current.has(j.id));
    if (!ready.length) return;
    ready.forEach((j) => applied.current.add(j.id));
    doc.edit(1, (x) => {
      let expressions = x.expressions;
      for (const j of ready) {
        const id = (j.input as { expressionId?: string }).expressionId;
        expressions = expressions.map((e) => (e.id === id ? { ...e, sketchAssetId: jobAssetId(j)! } : e));
      }
      return { ...x, expressions };
    });
    ready.forEach((j) => void markApplied(j.id, version));
  }, [h.pending, canEdit, doc, markApplied, version]);

  const runningFor = (id: string) => h.running.some((j) => (j.input as { expressionId?: string }).expressionId === id);

  return (
    <div className="rounded-lg border border-line bg-[#f7fbf5] p-4 space-y-3" aria-labelledby="hf-sketch">
      <div>
        <div id="hf-sketch" className="font-semibold">러프 콘티 바로 생성 (Higgsfield)</div>
        <p className="field-help">
          컷마다 장면 묘사·카메라대로 <strong>흰 배경에 단순한 선으로만</strong> 그린 러프 콘티를 한 번에 만들어 각 컷의 ‘러프 스케치’ 칸에 넣습니다. 마음에 안
          드는 컷은 카드에서 그 컷만 다시 생성하거나 직접 그린 그림으로 바꾸세요. 컷 그림은 이 구도를 따릅니다. 구독 크레딧이 차감됩니다(품질 낮음으로 저렴하게).
        </p>
      </div>
      <div role="group" aria-label="러프 콘티 모델" className="seg">
        {(Object.keys(IMAGE_MODELS) as ImageModelKey[]).map((k) => (
          <button key={k} aria-pressed={model === k} disabled={!canEdit || !!h.quote} onClick={() => setModel(k)}>
            {IMAGE_MODELS[k].label.split(" · ")[0]}
          </button>
        ))}
      </div>
      {!h.quote && (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-dark" disabled={!ready || !drawable.length} onClick={() => ask(drawable.map((e) => e.id))}>
            {h.busy ? "비용 확인 중…" : `러프 콘티 전부 생성 (${drawable.length}컷)`}
          </button>
          {missing.length > 0 && missing.length < drawable.length && (
            <button className="btn btn-sm" disabled={!ready} onClick={() => ask(missing)}>
              스케치 없는 컷만 ({missing.length}컷)
            </button>
          )}
        </div>
      )}
      {!drawable.length && <p className="field-help">컷마다 장면 묘사나 카메라를 먼저 쓰세요(②의 AI 콘티 설계).</p>}
      {drawable.length < exps.length && drawable.length > 0 && (
        <p className="field-help">장면 묘사·카메라가 비어 있는 컷 {exps.length - drawable.length}개는 건너뜁니다.</p>
      )}
      <QuoteBox h={h} />
      <Status h={h} typical="20초~1분" />
      {h.running.length > 0 && <p className="field-help" aria-live="polite">생성 중: {exps.filter((e) => runningFor(e.id)).map((e) => `${exps.indexOf(e) + 1}번`).join(", ")} 컷</p>}
    </div>
  );
}

/** One panel's "redo this sketch" button (shares the sketch jobs with SketchGenerator). */
export function SketchRedoButton({ expressionId, hasSketch }: { expressionId: string; hasSketch: boolean }) {
  const { canEdit, doc } = useEditor();
  const h = useHfJobs("hf_sketch");
  const e = doc.data.expressions.find((x) => x.id === expressionId);
  if (!canEdit || !e || !(e.action.trim() || e.camera.trim())) return null;
  const running = h.running.some((j) => (j.input as { expressionId?: string }).expressionId === expressionId);
  if (running) return <p className="text-[13px] text-muted" aria-live="polite">러프 콘티 생성 중…</p>;
  return (
    <div className="space-y-2">
      {!h.quote && (
        <button className="btn btn-sm" disabled={h.busy} onClick={() => h.askQuote({ target: "sketch", model: "gpt_image_2_6", expressionIds: [expressionId] })}>
          {h.busy ? "비용 확인 중…" : hasSketch ? "러프 콘티 다시 생성" : "러프 콘티 생성"}
        </button>
      )}
      <QuoteBox h={h} />
      {h.error && <p className="notice notice-error">{h.error}</p>}
    </div>
  );
}

/* ───────────── Step 2: one image per expression ───────────── */

export function HiggsfieldDirect({
  onUse,
}: {
  onUse: (expressionId: string, assetId: string, framing: Framing | null, aspect: string | null) => void;
}) {
  const { doc, canEdit, assets, jobs, askAi } = useEditor();
  const h = useHfJobs("hf_expr");
  const [model, setModel] = useState<ImageModelKey>("nano_banana_2_1");
  // ① → ②: once the anchor image is chosen, the cost check for the rest opens by itself
  const [chain, setChain] = useState(false);
  const data = doc.data;
  const exps = data.expressions;
  const framing = data.expressionSetup.framing;
  const aspect = imageAspectFor(data);
  const multi = data.cast.length > 1;
  const aspectCss = aspect.replace(":", "/");
  // The continuity anchor (연결 기준 그림): every other expression is drawn to match it.
  const anchor = continuityAnchor(data);
  const first = timelineOrder(data)[0];
  const numberOf = (id: string) => exps.findIndex((e) => e.id === id) + 1;
  // To (re)make next to the anchor: no image yet, or made at another shot size / aspect ratio.
  const redo = exps.filter((e) => e.id !== anchor?.id && (!e.imageAssetId || imageIsStale(e, framing, aspect))).map((e) => e.id);
  const others = exps.filter((e) => e.id !== anchor?.id).map((e) => e.id);
  const ready = canEdit && !h.busy && !h.quote && Boolean(doc.data.baseAssetId);
  const ask = (ids?: string[]) => h.askQuote({ target: "expressions", model, expressionIds: ids });
  const pendingFor = (id: string) => h.pending.filter((j) => (j.input as { expressionId?: string }).expressionId === id);
  const runningFor = (id: string) => h.running.some((j) => (j.input as { expressionId?: string }).expressionId === id);
  const stale = exps.filter((e) => imageIsStale(e, framing, aspect)).length;

  // the newest AI picture review: its notes per panel, for panels whose image has not been redrawn since
  const review = jobs.jobs.find((j) => j.kind === "check_sheet" && j.status === "done");
  const reviewFix = (() => {
    const out = review?.output as { issues?: { panel: number | null; severity: "high" | "low"; message: string }[] } | null;
    const by = new Map<string, { text: string[]; high: boolean }>();
    for (const i of out?.issues ?? []) {
      const e = i.panel ? exps[i.panel - 1] : undefined;
      if (!e) continue;
      const img = e.imageAssetId ? assets.get(e.imageAssetId) : undefined;
      if (img && review && Date.parse(img.createdAt) > Date.parse(review.created_at)) continue;
      const cur = by.get(e.id) ?? { text: [], high: false };
      cur.text.push(i.message);
      cur.high ||= i.severity === "high";
      by.set(e.id, cur);
    }
    const list = exps.filter((e) => by.has(e.id)).map((e) => ({ id: e.id, text: by.get(e.id)!.text.join(" / "), high: by.get(e.id)!.high }));
    return { list, ids: list.map((r) => r.id), high: list.filter((r) => r.high).map((r) => r.id), fixes: Object.fromEntries(list.map((r) => [r.id, r.text])) };
  })();
  const askFix = (ids: string[]) =>
    h.askQuote({ target: "expressions", model, expressionIds: ids, fixes: Object.fromEntries(ids.map((id) => [id, reviewFix.fixes[id]])) });

  // 연결성 우선 (storyboard): panels drawn one at a time in timeline order, each seeing the panel before it
  const story = data.mode === "storyboard";
  const order = data.acting.segments.map((sg) => sg.expressionId).filter((id) => exps.some((e) => e.id === id));
  const [seq, setSeq] = useState<{ queue: string[]; current: string; since: number } | null>(null);
  const [seqNote, setSeqNote] = useState<string | null>(null);
  // the sequence waits for the cost check of its first panel to be confirmed
  const [seqStart, setSeqStart] = useState<string | null>(null);
  const startSeq = (from: string) => {
    setSeqNote(null);
    setSeqStart(from);
    void ask([from]);
  };
  const seqConfirmed = () => {
    if (!seqStart) return;
    const at = order.indexOf(seqStart);
    setSeq({ queue: order.slice(at + 1), current: seqStart, since: Date.now() - 30_000 });
    setSeqStart(null);
  };
  useEffect(() => {
    if (!seq || !canEdit) return;
    const mine = h.pending.filter((j) => (j.input as { expressionId?: string }).expressionId === seq.current && Date.parse(j.created_at) >= seq.since);
    const failed = jobs.jobs.find(
      (j) => j.kind === "hf_expr" && j.status === "failed" && (j.input as { expressionId?: string }).expressionId === seq.current && Date.parse(j.created_at) >= seq.since,
    );
    if (failed) {
      setSeq(null);
      setSeqNote(`${numberOf(seq.current)}번 컷 생성이 실패해 차례 생성을 멈췄습니다: ${failed.error ?? ""}`);
      return;
    }
    const done = mine.find((j) => jobAssetId(j));
    if (!done) return;
    const made = done.input as { framing?: Framing; aspect?: string };
    onUse(seq.current, jobAssetId(done)!, made.framing ?? null, made.aspect ?? null);
    void jobs.markApplied(done.id, doc.version);
    const [next, ...rest] = seq.queue;
    if (!next) {
      setSeq(null);
      setSeqNote("모든 컷을 차례로 생성해 적용했습니다. 마음에 안 드는 컷은 그 컷만 다시 생성하세요(앞뒤 컷을 보고 다시 그립니다).");
      return;
    }
    setSeq({ queue: rest, current: next, since: Date.now() - 5_000 });
    // the image just used is saved first (generate flushes the document), so the next panel sees it
    void h.generate({ target: "expressions", model, expressionIds: [next] }).then((ok) => {
      if (!ok) {
        setSeq(null);
        setSeqNote(`${numberOf(next)}번 컷을 요청하지 못해 차례 생성을 멈췄습니다.`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h.pending, jobs.jobs, seq, canEdit]);

  const askRef = useRef(ask);
  askRef.current = ask;
  const redoKey = redo.join(",");
  useEffect(() => {
    if (!chain || !anchor || !redoKey || !ready) return;
    setChain(false);
    void askRef.current(redoKey.split(","));
  }, [chain, anchor, redoKey, ready]);

  /** The newest new result of each expression, to take them all at once. */
  const newest = exps.flatMap((e) => {
    const r = pendingFor(e.id);
    return r.length && jobAssetId(r[0]) ? [{ e, j: r[0] }] : [];
  });
  function takeAllNew() {
    for (const { e, j } of newest) {
      const made = j.input as { framing?: Framing; aspect?: string };
      onUse(e.id, jobAssetId(j)!, made.framing ?? null, made.aspect ?? null);
      void jobs.markApplied(j.id, doc.version);
    }
  }

  // When a full new set is in place (every expression drawn at the current shot and 3:4, nothing
  // pending), the image check (표정 그림 검사) runs by itself once, so a gesture or direction that
  // differs from the design is caught before the video.
  const lastCheck = jobs.jobs.find((j) => j.kind === "check_sheet");
  const images = exps.map((e) => (e.imageAssetId ? assets.get(e.imageAssetId) : undefined));
  const newestImage = Math.max(0, ...images.map((a) => (a ? Date.parse(a.createdAt) : 0)));
  const setKey = exps.map((e) => e.imageAssetId ?? "").join(",");
  const checkDue =
    canEdit &&
    exps.length > 0 &&
    images.every(Boolean) &&
    !stale &&
    !h.running.length &&
    !h.pending.length &&
    lastCheck?.status !== "queued" &&
    lastCheck?.status !== "running" &&
    (!lastCheck || Date.parse(lastCheck.created_at) < newestImage);
  const autoChecked = useRef(new Set<string>());
  const [autoRefused, setAutoRefused] = useState(false);
  useEffect(() => {
    if (!checkDue || autoChecked.current.has(setKey)) return;
    autoChecked.current.add(setKey);
    void askAi("check_sheet", 1).then((id) => setAutoRefused(!id));
  }, [checkDue, setKey, askAi]);

  return (
    <section className="rounded-xl border-2 border-[#c6dfbf] bg-[#f7fbf5] p-5 space-y-4" aria-labelledby="hf-direct">
      <div>
        <h3 id="hf-direct" className="section-title">{data.mode === "storyboard" ? "Higgsfield로 컷 그림 생성" : "Higgsfield로 표정 그림 생성"}</h3>
        <p className="text-muted">
          {data.mode === "storyboard" ? (
            <>
              컷마다 <strong className="text-ink">그 순간 화면 전체를 {aspect} 완성 그림 한 장으로</strong> 1K로 그립니다(장면 기준 그림의 인물·그림체·세계 유지, 러프 스케치가 있으면 그 구도).
            </>
          ) : multi ? (
            <>
              표정마다 <strong className="text-ink">출연진 {data.cast.length}명이 모두 들어간 {aspect} 장면 그림을 한 장씩</strong> 1K로 그립니다({FRAMING_LABEL[framing]}·흰 배경·눈높이·인물 위치 고정).
            </>
          ) : (
            <>
              표정마다 <strong className="text-ink">세로 {aspect} 그림을 한 장씩 따로</strong> 1K로 그립니다({FRAMING_LABEL[framing]}·흰 배경·눈높이).
            </>
          )}{" "}
          영상(5단계)에는 이 그림들이 각각 참고 그림으로 첨부됩니다.
          Higgsfield <strong className="text-ink">구독 크레딧</strong>이 차감되고, 결과는 표정별로 확인 후 사용합니다.
        </p>
      </div>

      {anchor ? (
        <p className="notice notice-info">
          <strong>연결 기준 그림: {numberOf(anchor.id)}번 표정.</strong> 다른 표정은 이 그림과 같은 카메라 거리·인물 크기·위치로 그려서, 영상에서 컷 없는 한
          쇼트처럼 이어집니다. 기준 그림을 바꾸면 나머지 표정도 다시 생성하세요.
        </p>
      ) : (
        first && (
          <p className="notice notice-info">
            {stale > 0 && <strong>표정 그림 {stale}장이 지금 규칙({aspect}·{FRAMING_LABEL[framing]})과 다릅니다. </strong>}
            표정 그림이 한 쇼트처럼 이어지도록, 먼저 타임라인 첫 표정({numberOf(first.id)}번)을 <strong>연결 기준 그림</strong>으로 만들고 ‘이 그림 사용’을
            누르세요. 그러면 나머지 표정을 기준 그림에 맞춰 그리는 비용 확인이 바로 열립니다.
          </p>
        )
      )}

      <div role="group" aria-label="이미지 모델">
        <div className="text-[13px] font-semibold mb-1 text-muted">생성 모델</div>
        <div className="seg">
          {(Object.keys(IMAGE_MODELS) as ImageModelKey[]).map((k) => (
            <button key={k} aria-pressed={model === k} disabled={!canEdit || !!h.quote} onClick={() => setModel(k)}>
              {IMAGE_MODELS[k].label}
            </button>
          ))}
        </div>
      </div>

      {canEdit && !h.quote && !seq && reviewFix.ids.length > 0 && (
        <div className="rounded-lg border-2 border-[#f3c9ae] bg-[#fffaf5] p-3 space-y-2">
          <div className="font-semibold">AI 그림 검사에서 지적된 {data.mode === "storyboard" ? "컷" : "표정"}을 지적 내용대로 다시 생성</div>
          <ul className="text-[14px] space-y-1">
            {reviewFix.list.map((r) => (
              <li key={r.id}>
                <strong>{numberOf(r.id)}번</strong>
                {r.high ? <span className="pill pill-warn ml-1">심각</span> : null} {r.text.slice(0, 160)}
                {r.text.length > 160 ? "…" : ""}
              </li>
            ))}
          </ul>
          <p className="field-help">
            검사 내용이 그 {data.mode === "storyboard" ? "컷" : "표정"}의 프롬프트에 ‘고칠 점’으로 들어가고, 바로 앞 컷 그림과 연결 상태를 보고 다시 그립니다. 결과는 카드에서 골라 사용하세요.
            검사 뒤에 이미 다시 만든 그림은 빠집니다.
          </p>
          <div className="flex flex-wrap gap-2">
            {reviewFix.high.length > 0 && (
              <button className="btn btn-dark" disabled={!ready} onClick={() => askFix(reviewFix.high)}>
                {h.busy ? "비용 확인 중…" : `심각한 지적만 다시 생성 (${reviewFix.high.length}장)`}
              </button>
            )}
            <button className={reviewFix.high.length ? "btn btn-sm" : "btn btn-dark"} disabled={!ready} onClick={() => askFix(reviewFix.ids)}>
              지적된 것 모두 다시 생성 ({reviewFix.ids.length}장)
            </button>
          </div>
        </div>
      )}
      {story && !h.quote && !seq && order.length > 1 && (
        <div className="rounded-lg border border-line bg-white p-3 space-y-2">
          <div className="font-semibold">연결성 우선: 앞 컷부터 한 장씩 차례로 생성</div>
          <p className="field-help">
            컷마다 바로 앞 컷의 완성 그림을 보고 그려서 의상·소품·화면 좌우·위치·빛이 이어집니다. 한 장씩 차례로 만들어 시간이 더 걸리고(컷당 약 20초~1분), 결과는
            자동으로 컷에 적용됩니다. 비용은 첫 컷 기준으로 확인하며, 컷 수만큼 차감됩니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-dark" disabled={!ready} onClick={() => startSeq(order[0])}>
              {h.busy && seqStart ? "비용 확인 중…" : `처음부터 차례로 생성 (${order.length}컷)`}
            </button>
            {(() => {
              const firstMissing = order.find((id) => !exps.find((e) => e.id === id)?.imageAssetId);
              return firstMissing && firstMissing !== order[0] ? (
                <button className="btn btn-sm" disabled={!ready} onClick={() => startSeq(firstMissing)}>
                  그림 없는 {numberOf(firstMissing)}번 컷부터 이어서 ({order.length - order.indexOf(firstMissing)}컷)
                </button>
              ) : null;
            })()}
          </div>
        </div>
      )}
      {seq && (
        <div className="notice notice-info flex flex-wrap items-center gap-2" aria-live="polite">
          <span>
            차례 생성 중: {numberOf(seq.current)}번 컷{seq.queue.length ? ` → 남은 ${seq.queue.length}컷` : " (마지막)"}
          </span>
          <button className="btn btn-sm" onClick={() => setSeq(null)}>
            여기서 멈추기
          </button>
        </div>
      )}
      {seqNote && <p className="notice notice-info">{seqNote}</p>}
      {!h.quote && !seq && (
        <div className="flex flex-wrap items-center gap-2">
          {!anchor && first ? (
            <>
              <button
                className="btn btn-dark"
                disabled={!ready}
                onClick={() => {
                  setChain(true);
                  void ask([first.id]);
                }}
              >
                {h.busy ? "비용 확인 중…" : `① 기준 그림 먼저 생성 (${numberOf(first.id)}번 표정)`}
              </button>
              <button className="btn btn-sm btn-ghost" disabled={!ready} onClick={() => ask()}>
                기준 없이 {exps.length}장 한 번에 생성
              </button>
            </>
          ) : (
            others.length > 0 && (
              <>
                <button className="btn btn-dark" disabled={!ready} onClick={() => ask(redo.length ? redo : others)}>
                  {h.busy
                    ? "비용 확인 중…"
                    : redo.length
                      ? `② 나머지 표정 생성 — 기준 그림에 맞춤 (${redo.length}장)`
                      : `나머지 표정 모두 다시 생성 — 기준 그림에 맞춤 (${others.length}장)`}
                </button>
                {redo.length > 0 && redo.length < others.length && (
                  <button className="btn btn-sm" disabled={!ready} onClick={() => ask(others)}>
                    나머지 모두 다시 ({others.length}장)
                  </button>
                )}
              </>
            )
          )}
        </div>
      )}
      <QuoteBox
        h={h}
        onConfirmed={seqConfirmed}
        onCancel={() => setSeqStart(null)}
        note={seqStart ? `차례 생성: 첫 컷 비용입니다. ${order.length - order.indexOf(seqStart)}컷을 차례로 만들어 약 ${order.length - order.indexOf(seqStart)}배가 차감됩니다.` : null}
      />
      <Status h={h} typical="20초~1분" />
      {canEdit && newest.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={takeAllNew}>
            새 결과 모두 사용 ({newest.length}장)
          </button>
          <span className="field-help">표정마다 가장 최근 결과를 씁니다. 하나씩 고르려면 아래 카드에서 고르세요.</span>
        </div>
      )}
      {checkDue && !autoRefused && <p className="field-help">새 그림이 모두 준비되어 ‘AI로 그림 검사’를 자동으로 시작합니다.</p>}
      {autoRefused && (
        <p className="notice notice-error">
          그림 검사를 자동으로 시작하지 못했습니다: {jobs.requestError ?? "요청이 거절되었습니다."} 아래 ‘그림 검사’ 버튼으로 다시 시도할 수 있습니다.
        </p>
      )}

      <ol className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {exps.map((e, i) => {
          const current = e.imageAssetId ? assets.get(e.imageAssetId) : undefined;
          const results = pendingFor(e.id);
          return (
            <li key={e.id} className="rounded-lg border border-line bg-white p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="grid place-items-center size-7 rounded-full bg-[#26301f] text-white text-[13px] font-bold">{i + 1}</span>
                <span className="font-semibold truncate">{e.emotion || "감정 미정"}</span>
              </div>
              {multi && <div className="text-[13px] text-muted truncate">{castLabel(data, e.characterId)}</div>}
              {anchor?.id === e.id && <span className="pill pill-ok">연결 기준 그림</span>}
              {current && imageIsStale(e, framing, aspect) && <span className="pill pill-warn">구도·비율이 다름 · 다시 생성 권장</span>}
              <div className="rounded border border-line checker grid place-items-center overflow-hidden" style={{ aspectRatio: aspectCss }}>
                {current ? (
                  <img src={current.previewUrl} alt={`${i + 1}번 표정 그림`} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[13px] text-muted">아직 그림 없음</span>
                )}
              </div>
              {runningFor(e.id) && <p className="text-[13px] text-muted" aria-live="polite">생성 중…</p>}
              {results.map((j) => {
                const a = assets.get(jobAssetId(j) ?? "");
                return (
                  <div key={j.id} className="rounded border-2 border-[#f3c9ae] p-2 space-y-2 bg-[#fffaf5]">
                    <div className="text-[13px] font-semibold">새 결과 · {jobLabel(j).split(" · ").slice(1).join(" · ")}</div>
                    {a ? (
                      <a href={a.url} target="_blank" rel="noreferrer">
                        <img src={a.previewUrl} alt="새로 생성한 표정 그림" className="w-full object-contain checker rounded" style={{ aspectRatio: aspectCss }} />
                      </a>
                    ) : (
                      <p className="text-[13px] text-muted">불러오는 중…</p>
                    )}
                    <ResultActions
                      job={j}
                      primary="이 그림 사용"
                      onPrimary={() => {
                        const made = j.input as { framing?: Framing; aspect?: string };
                        onUse(e.id, jobAssetId(j)!, made.framing ?? null, made.aspect ?? null);
                      }}
                    />
                  </div>
                );
              })}
              {canEdit && !runningFor(e.id) && (
                <button className="btn btn-sm w-full" disabled={!ready} onClick={() => ask([e.id])}>
                  {current ? "이 표정만 다시 생성" : "이 표정만 생성"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <p className="field-help">사용하지 않은 결과도 자료함에 남습니다. 모델을 바꿔 같은 표정을 다시 생성해 비교할 수 있습니다.</p>
    </section>
  );
}

/* ───────────── Step 5: start and end frames ───────────── */

const SHOTS: Framing[] = ["close_up", "bust", "medium"];

/**
 * 시작·끝 프레임 그림: one expression's moment redrawn at the video's aspect ratio and a chosen shot
 * size. Two frames (e.g. 1번 클로즈업 → 4번 바스트) set a camera move more reliably than words.
 */
export function FrameMaker({ onUse }: { onUse: (slot: "start" | "end", assetId: string) => void }) {
  const { doc, canEdit, assets } = useEditor();
  const h = useHfJobs("hf_frame");
  const [model, setModel] = useState<ImageModelKey>("nano_banana_2_1");
  const data = doc.data;
  const order = timelineOrder(data);
  const n = (id: string) => data.expressions.findIndex((e) => e.id === id) + 1;
  const [pick, setPick] = useState<Record<"start" | "end", { id: string; shot: Framing }>>({
    start: { id: order[0]?.id ?? "", shot: "close_up" },
    end: { id: order[order.length - 1]?.id ?? "", shot: "bust" },
  });
  const ready = canEdit && !h.busy && !h.quote && Boolean(data.baseAssetId);

  return (
    <div className="rounded-lg border border-line p-4 space-y-3">
      <div className="font-semibold">프레임 그림 만들기 (Higgsfield 구독 크레딧)</div>
      <p className="field-help">
        표정 그림의 순간을 영상 비율({data.video.aspectRatio})과 고른 구도로 다시 그립니다. 예: 시작 = 1번 표정 클로즈업, 끝 = 마지막 표정 바스트 → 카메라가
        클로즈업에서 바스트로 물러나는 영상.
      </p>
      <div role="group" aria-label="이미지 모델" className="seg">
        {(Object.keys(IMAGE_MODELS) as ImageModelKey[]).map((k) => (
          <button key={k} type="button" aria-pressed={model === k} disabled={!canEdit || !!h.quote} onClick={() => setModel(k)}>
            {IMAGE_MODELS[k].label}
          </button>
        ))}
      </div>
      {(["start", "end"] as const).map((slot) => (
        <div key={slot} className="flex flex-wrap items-end gap-2">
          <label className="text-[13px] font-semibold text-muted">
            {slot === "start" ? "시작" : "끝"} 프레임 표정
            <select
              className="input mt-1 w-56"
              value={pick[slot].id}
              disabled={!canEdit}
              onChange={(ev) => setPick((p) => ({ ...p, [slot]: { ...p[slot], id: ev.target.value } }))}
            >
              {order.map((e) => (
                <option key={e.id} value={e.id}>
                  {n(e.id)}번 · {e.emotion || "표정"}
                </option>
              ))}
            </select>
          </label>
          <div className="seg" role="group" aria-label={`${slot === "start" ? "시작" : "끝"} 프레임 구도`}>
            {SHOTS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={pick[slot].shot === s}
                disabled={!canEdit}
                onClick={() => setPick((p) => ({ ...p, [slot]: { ...p[slot], shot: s } }))}
              >
                {FRAMING_LABEL[s]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!ready || !pick[slot].id}
            onClick={() => h.askQuote({ target: "frame", model, expressionId: pick[slot].id, shot: pick[slot].shot, slot })}
          >
            {slot === "start" ? "시작" : "끝"} 프레임 만들기
          </button>
        </div>
      ))}
      <QuoteBox h={h} />
      <Status h={h} typical="20초~1분" />
      {h.pending.map((j) => {
        const a = assets.get(jobAssetId(j) ?? "");
        const slot = (j.input as { slot?: "start" | "end" }).slot ?? "start";
        return (
          <div key={j.id} className="rounded-lg border-2 border-[#f3c9ae] bg-[#fffaf5] p-3 space-y-2">
            <div className="text-[13px] font-semibold">새 프레임 · {jobLabel(j)}</div>
            {a ? <img src={a.previewUrl} alt="새로 만든 프레임" className="w-full max-h-72 object-contain checker rounded" /> : <p className="text-muted">불러오는 중…</p>}
            <ResultActions job={j} primary={slot === "start" ? "시작 프레임으로 사용" : "끝 프레임으로 사용"} onPrimary={() => onUse(slot, jobAssetId(j)!)} />
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── Step 5: video ───────────── */

export function HiggsfieldVideo({
  onAdd,
  beforeRender,
}: {
  onAdd: (assetId: string) => void;
  /** shown right before the render button (the pre-render conflict check), given the chosen model */
  beforeRender?: (model: VideoModelKey) => React.ReactNode;
}) {
  const { doc, canEdit, assets, jobs } = useEditor();
  const h = useHfJobs("hf_video");
  // the prompt is about to change (영어 정리): render after it arrives
  const englishJob = jobs.jobs.find((j) => j.kind === "write_english");
  const englishBusy =
    englishJob?.status === "queued" || englishJob?.status === "running" || (englishJob?.status === "done" && englishJob.applied_version === null);
  // Every finished video goes straight into "생성한 영상" (so the team and the review link see it);
  // only a draft keeps its card, for the 1080p step.
  const added = useRef(new Set<string>());
  const results = doc.data.video.resultAssetIds;
  const { markApplied } = jobs;
  useEffect(() => {
    if (!canEdit) return;
    for (const j of h.pending) {
      const id = jobAssetId(j);
      if (!id || added.current.has(j.id)) continue;
      added.current.add(j.id);
      if (!results.includes(id)) onAdd(id);
      if (!(j.input as { draft?: boolean }).draft) void markApplied(j.id, doc.version);
    }
  }, [h.pending, results, canEdit, onAdd, markApplied, doc.version]);
  const [model, setModel] = useState<VideoModelKey>("kling4_0");
  const vm = VIDEO_MODELS[model];
  const [resolution, setResolution] = useState(defaultResolution(vm));
  const res = vm.resolutions.find((r) => r.key === resolution) ? resolution : defaultResolution(vm);
  const acting = doc.data.acting.duration;
  const input = { start: Boolean(doc.data.video.startFrameAssetId), end: Boolean(doc.data.video.startFrameAssetId && doc.data.video.endFrameAssetId) };
  const duration = videoDuration(vm, acting, input);

  return (
    <section className="rounded-xl border-2 border-[#c6dfbf] bg-[#f7fbf5] p-5 space-y-4" aria-labelledby="hf-video">
      <div>
        <h3 id="hf-video" className="section-title">Higgsfield로 영상 바로 생성</h3>
        <p className="text-muted">
          승인된 출연진·표정·대사·액팅으로 영상을 만듭니다. Higgsfield <strong className="text-ink">구독 크레딧</strong>이 차감됩니다.
        </p>
      </div>

      <div role="group" aria-label="영상 모델">
        <div className="text-[13px] font-semibold mb-1 text-muted">생성 모델</div>
        <div className="seg">
          {(Object.keys(VIDEO_MODELS) as VideoModelKey[]).map((k) => (
            <button
              key={k}
              aria-pressed={model === k}
              disabled={!canEdit || !!h.quote}
              onClick={() => {
                setModel(k);
                setResolution(defaultResolution(VIDEO_MODELS[k]));
              }}
            >
              {VIDEO_MODELS[k].label}
            </button>
          ))}
        </div>
        <p className="field-help">{vm.note}</p>
      </div>

      <div role="group" aria-label="해상도">
        <div className="text-[13px] font-semibold mb-1 text-muted">해상도</div>
        <div className="seg">
          {vm.resolutions.map((r) => (
            <button key={r.key} aria-pressed={res === r.key} disabled={!canEdit || !!h.quote} onClick={() => setResolution(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[14px]">
        길이 <strong>{duration}초</strong>
        {duration !== Math.ceil(acting) && (
          <span className="text-warn"> — 액팅 타임라인은 {acting}초지만 이 모델은 지금 방식으로 {vm.minDuration}~{videoMaxDuration(vm, input)}초만 지원해 {duration}초로 맞춥니다.</span>
        )}
        {" · "}비율 {doc.data.video.aspectRatio} ·{" "}
        {doc.data.video.startFrameAssetId
          ? doc.data.video.endFrameAssetId
            ? vm.endRole
              ? "시작·끝 프레임 사용"
              : "시작 프레임 사용 (이 모델은 끝 프레임을 받지 않음)"
            : "시작 프레임 사용"
          : "기본 그림·표정 그림들을 참고 그림으로 사용"}
      </p>

      {beforeRender?.(model)}

      {!h.quote && (
        <button
          className="btn btn-dark"
          disabled={!canEdit || h.busy || englishBusy || !doc.data.baseAssetId}
          onClick={() => h.askQuote({ target: "video", model, resolution: res })}
        >
          {h.busy ? "비용 확인 중…" : englishBusy ? "영어 정리 중… (끝나면 생성할 수 있습니다)" : "비용 확인 후 생성"}
        </button>
      )}
      <QuoteBox h={h} />
      <Status h={h} typical="1~5분" />

      {h.pending
        .filter((j) => (j.input as { draft?: boolean }).draft || !canEdit)
        .map((j) => {
          const a = assets.get(jobAssetId(j) ?? "");
          const isDraft = Boolean((j.input as { draft?: boolean }).draft);
          return (
            <div key={j.id} className="rounded-lg border border-line bg-white p-4 space-y-3">
              <div className="font-semibold">생성 결과 · {jobLabel(j)}</div>
              {a ? <video src={a.url} controls preload="metadata" className="w-full max-h-96 bg-black rounded" /> : <p className="text-muted">불러오는 중…</p>}
              {isDraft && canEdit && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" disabled={h.busy || !!h.quote} onClick={() => h.askQuote({ target: "finalize", draftRowId: j.id })}>
                    1080p로 확정
                  </button>
                  <button className="btn" onClick={() => jobs.markApplied(j.id, doc.version)}>
                    확정하지 않고 닫기
                  </button>
                </div>
              )}
              {isDraft && (
                <p className="field-help">
                  드래프트는 아래 ‘생성한 영상’에도 들어가 있습니다. 생성 후 7일 안에 같은 연기 그대로 1080p로 확정할 수 있고, 확정본도 ‘생성한 영상’에 자동으로 들어갑니다.
                </p>
              )}
            </div>
          );
        })}
    </section>
  );
}
