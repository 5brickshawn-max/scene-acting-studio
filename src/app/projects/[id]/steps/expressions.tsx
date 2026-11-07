"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import {
  FACING,
  FACING_LABEL,
  FRAMINGS,
  FRAMING_CUT,
  FRAMING_LABEL,
  FRAMING_USE,
  GAZE,
  GAZE_LABEL,
  INTENSITY,
  INTENSITY_LABEL,
  PITCH,
  PITCH_LABEL,
  TILT,
  TILT_LABEL,
  MAX_EXPRESSIONS,
  MAX_VIDEO_SECONDS,
  MIN_EXPRESSIONS,
  directionIssues,
  setDuration,
  setExpressionCount,
  showsHands,
  imageIsStale,
  ratioLabel,
  castLabel,
  imageAspectFor,
  type Direction,
  type Expression,
  type Facing,
  type Framing,
  type StepIndex,
} from "@/lib/domain/project";
import { useEditor } from "../editor-context";
import type { AssetView } from "@/lib/types";
import { AiAction, CopyButton, Field, ImageSlot, PanelCrop, Seg } from "../ui";
import { PendingProposal } from "../proposals";
import { StepFrame } from "./step-frame";
import { HiggsfieldDirect } from "./higgsfield-direct";
import { ExpressionPackButton } from "../packs";
import { EnglishBar } from "../prompt-tools";

const FACING_SHORT: Record<Facing, string> = {
  left_profile: "◀ 옆",
  left_3q: "◀ 3/4",
  front: "정면",
  right_3q: "3/4 ▶",
  right_profile: "옆 ▶",
};
const ANGLE: Record<Facing, number> = { left_profile: 180, left_3q: 135, front: 90, right_3q: 45, right_profile: 0 };

/** Top-down sketch: viewer is at the bottom. Shows head vs body direction at a glance. */
function TopDown({ d }: { d: Direction }) {
  const rad = (a: number) => (a * Math.PI) / 180;
  const h = ANGLE[d.facing];
  const b = ANGLE[d.body];
  const nose = { x: 50 + Math.cos(rad(h)) * 22, y: 42 + Math.sin(rad(h)) * 22 };
  return (
    <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0" role="img" aria-label={`위에서 본 모습: 얼굴 ${FACING_LABEL[d.facing]}, 몸 ${FACING_LABEL[d.body]}`}>
      <rect x="0" y="0" width="100" height="100" rx="10" fill="#f4f6f0" />
      <g transform={`rotate(${b - 90} 50 52)`}>
        <ellipse cx="50" cy="52" rx="34" ry="13" fill="#d9e2cf" stroke="#7d9369" />
      </g>
      <circle cx="50" cy="42" r="15" fill="#fff" stroke="#26301f" strokeWidth="2" />
      <line x1="50" y1="42" x2={nose.x} y2={nose.y} stroke="#c2410c" strokeWidth="4" strokeLinecap="round" />
      <text x="50" y="97" textAnchor="middle" fontSize="10" fill="#4d5945">관객</text>
    </svg>
  );
}

function DirectionEditor({ e, index, onChange }: { e: Expression; index: number; onChange: (d: Direction, confirm: boolean) => void }) {
  const { canEdit } = useEditor();
  const d = e.direction;
  const set = (patch: Partial<Direction>) => onChange({ ...d, ...patch }, false);
  const warn = directionIssues(e, index).filter((i) => i.level === "warn");
  return (
    <div className={`rounded-lg border p-3 space-y-3 ${e.directionStatus === "ai" ? "border-[#ecd6a6] bg-[#fffbf1]" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">방향</span>
        <span className="text-[13px] text-muted">왼쪽·오른쪽은 모두 보는 사람(화면) 기준</span>
        {e.directionStatus === "ai" ? (
          <span className="pill pill-warn ml-auto">AI 추정 · 확인 필요</span>
        ) : (
          <span className="pill pill-ok ml-auto">확인됨</span>
        )}
      </div>
      <div className="flex gap-3 items-start">
        <TopDown d={d} />
        <div className="space-y-2 min-w-0">
          <Seg label="얼굴이 향한 쪽" value={d.facing} options={FACING} labels={FACING_SHORT} onChange={(v) => set({ facing: v })} />
          <Seg label="몸(어깨)이 향한 쪽" value={d.body} options={FACING} labels={FACING_SHORT} onChange={(v) => set({ body: v })} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <Seg label="고개 위아래" value={d.pitch} options={PITCH} labels={PITCH_LABEL} onChange={(v) => set({ pitch: v })} />
        <Seg label="고개 기울임" value={d.tilt} options={TILT} labels={TILT_LABEL} onChange={(v) => set({ tilt: v })} />
      </div>
      <div>
        <label className="text-[13px] font-semibold text-muted block mb-1" htmlFor={`gaze-${e.id}`}>시선</label>
        <select id={`gaze-${e.id}`} className="select" value={d.gaze} disabled={!canEdit} onChange={(ev) => set({ gaze: ev.target.value as Direction["gaze"] })}>
          {GAZE.map((g) => <option key={g} value={g}>{GAZE_LABEL[g]}</option>)}
        </select>
      </div>
      {warn.map((w, i) => <p key={i} className="notice notice-warn">{w.message}</p>)}
      {e.directionStatus === "ai" && canEdit && (
        <button className="btn btn-primary btn-sm" onClick={() => onChange(d, true)}>
          그림과 비교했고 이 방향이 맞습니다
        </button>
      )}
    </div>
  );
}

/** The same figure seen through each shot size (9:16 window): shows where the frame cuts. */
const SKETCH_VIEW: Record<Framing, string> = { close_up: "31.4 16 37.1 66", bust: "23 10 54 96", medium: "9.5 6 81 144" };

function FramingSketch({ framing }: { framing: Framing }) {
  return (
    <svg viewBox={SKETCH_VIEW[framing]} className="w-[45px] h-[80px] shrink-0 rounded-md border border-line bg-white" aria-hidden>
      <path d="M24 72 Q50 60 76 72 L70 150 L30 150 Z" fill="#e3e9db" stroke="#26301f" strokeWidth="1.2" />
      <rect x="45" y="50" width="10" height="14" fill="#f3e4d6" stroke="#26301f" strokeWidth="1.2" />
      <circle cx="50" cy="38" r="16" fill="#f3e4d6" stroke="#26301f" strokeWidth="1.2" />
      <path d="M74 76 L80 112 L73 145" fill="none" stroke="#26301f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 76 L17 112 L37 92" fill="none" stroke="#c2410c" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="39" cy="90" r="4.5" fill="#c2410c" />
    </svg>
  );
}

/** 상황 설정·기초 대사: the scene the expressions act out, in order. */
function SceneField() {
  const { doc, canEdit } = useEditor();
  const scene = doc.data.expressionSetup.scene;
  return (
    <div>
      <label className="field-label" htmlFor="scene">
        상황 설정·기초 대사 (선택)
      </label>
      <textarea
        id="scene"
        className="textarea"
        rows={5}
        value={scene}
        disabled={!canEdit}
        onChange={(e) => doc.edit(1, (d) => ({ ...d, expressionSetup: { ...d.expressionSetup, scene: e.target.value } }))}
        placeholder={
          doc.data.cast.length > 1
            ? "예: 무너진 신전 앞, 칼리엘라와 브람이 칼끝을 겨눈 채 마주 선다. 바람에 머리카락이 흩날린다.\n" +
              "칼리엘라 : “Come closer, darling.”\n" +
              "브람 : “Don't you dare!”"
            : "예: 반투명 베일 너머로 보이는 스와르다의 이목구비. 베일이 숨결에 미세하게 흔들린다. 화면 전체가 황금과 보석의 과잉 — 아름답지만 숨 막히는 밀도.\n" +
              "스와르다 : “사람들은 나의 아름다움을 축복이라 불렀다.”\n" +
              "스와르다 : “하지만 그것은, 제국의 탐욕을 부르는 불씨였을 뿐.”"
        }
      />
      <p className="field-help">
        {doc.data.cast.length > 1 ? "여러 인물 장면은 대사 앞에 말하는 인물 이름을 적으면(예: “브람 : …”) AI가 그 인물에게 표정을 배정합니다. " : ""}
        장면 상황과 기초 대사를 적으면, 아래 ‘AI로 표정 설계’가 이 장면을 연기하는 표정을 순서대로 설계합니다(대사마다 표정 배정, 남는 표정은 대사 사이 반응).
        표정 참고 시트를 올렸다면 그 그림도 함께 분석해 장면에 맞는 칸을 고릅니다. 기초 대사는 3단계 대사 작성에 그대로 쓰입니다. 카메라 움직임·배경은 영상(5단계) 추가
        연출에 적어 주세요.
      </p>
    </div>
  );
}

/** Shot size for every expression image (portrait 3:4 for one character, the video's aspect for a group). */
function FramingPicker() {
  const { doc, canEdit } = useEditor();
  const f = doc.data.expressionSetup.framing;
  const multi = doc.data.cast.length > 1;
  const aspect = imageAspectFor(doc.data);
  const stale = doc.data.expressions.filter((e) => imageIsStale(e, f, aspect)).length;
  return (
    <div className="space-y-3">
      {multi && (
        <div>
          <Seg
            label="화면 비율 (장면 그림과 영상이 함께 씀)"
            value={doc.data.video.aspectRatio}
            options={["16:9", "9:16"] as const}
            labels={{ "16:9": "가로 16:9 (권장)", "9:16": "세로 9:16" }}
            onChange={(v) => doc.edit(1, (d) => ({ ...d, video: { ...d.video, aspectRatio: v } }))}
          />
          <p className="field-help">여러 인물 장면은 표정마다 모든 인물이 들어간 장면 그림을 영상과 같은 비율로 그립니다. 2~3명이면 가로가 인물을 담기 좋습니다.</p>
        </div>
      )}
      <div className="field-label" id="framing-label">
        표정 그림 구도 · {multi ? `장면 그림 ${aspect}` : `세로 ${aspect}`}
      </div>
      <div role="radiogroup" aria-labelledby="framing-label" className="grid sm:grid-cols-3 gap-2">
        {FRAMINGS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={f === k}
            disabled={!canEdit || (multi && k === "close_up")}
            title={multi && k === "close_up" ? "여러 인물은 클로즈업 한 화면에 담을 수 없습니다" : undefined}
            onClick={() => doc.edit(1, (d) => ({ ...d, expressionSetup: { ...d.expressionSetup, framing: k } }))}
            className={`flex gap-3 items-start text-left rounded-xl border p-3 disabled:opacity-45 disabled:cursor-not-allowed ${f === k ? "border-accent bg-[#fff1e8]" : "border-line bg-white hover:border-line-strong"}`}
          >
            <FramingSketch framing={k} />
            <span className="min-w-0">
              <span className="block font-semibold">{FRAMING_LABEL[k]}</span>
              <span className="block text-[13px]">{FRAMING_CUT[k]}</span>
              <span className="block text-[13px] text-muted">{FRAMING_USE[k]}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="field-help">
        {multi
          ? "여러 인물 장면은 바스트 샷(가슴선) 또는 미디엄 샷(허리선)으로 모든 인물을 같은 크기로 담습니다. 연기하는 인물의 팔·손 동작도 함께 그립니다."
          : showsHands(f)
            ? "바스트·미디엄 샷은 표정마다 감정에 맞는 팔·손 동작도 함께 설계하고 그립니다."
            : "클로즈업은 얼굴 연기에 집중하고 팔·손은 그리지 않습니다."}
      </p>
      {stale > 0 && (
        <p className="notice notice-warn">
          이미 만든 표정 그림 {stale}장은 다른 구도·비율로 만든 그림입니다. 아래 ‘Higgsfield로 표정 그림 생성’에서 다시 만드세요.
        </p>
      )}
    </div>
  );
}

function ExpressionCard({ e, index }: { e: Expression; index: number }) {
  const { doc, assets } = useEditor();
  const s = doc.data.expressionSetup;
  const update = (patch: Partial<Expression>) =>
    doc.edit(1, (d) => ({ ...d, expressions: d.expressions.map((x) => (x.id === e.id ? { ...x, ...patch } : x)) }));
  const ref = s.refAssetId ? assets.get(s.refAssetId) : undefined;
  const sheet = s.sheetAssetId ? assets.get(s.sheetAssetId) : undefined;
  const own = e.imageAssetId ? assets.get(e.imageAssetId) : undefined;
  const d = doc.data;
  const multi = d.cast.length > 1;
  const aspect = imageAspectFor(d).replace(":", "/");

  return (
    <article className="rounded-xl border border-line p-4 space-y-3" aria-label={`${index + 1}번 표정`}>
      <div className="flex items-center gap-2">
        <span className="grid place-items-center size-8 rounded-full bg-[#26301f] text-white font-bold">{index + 1}</span>
        <span className="font-semibold truncate">
          {multi ? `${castLabel(d, e.characterId)} · ` : ""}
          {e.emotion || "감정 미정"}
        </span>
      </div>
      {multi && (
        <div>
          <label className="field-label" htmlFor={`actor-${e.id}`}>연기하는 인물 (대사가 있으면 이 인물이 말함)</label>
          <select id={`actor-${e.id}`} className="select" value={e.characterId} onChange={(ev) => update({ characterId: ev.target.value })}>
            {d.cast.map((c) => (
              <option key={c.id} value={c.id}>{castLabel(d, c.id)}</option>
            ))}
          </select>
        </div>
      )}
      {(ref || sheet || own) && (
        <div className="grid grid-cols-2 gap-2">
          <figure>
            <PanelCrop asset={ref} cols={s.refColumns} rows={s.refRows} index={(e.panel ?? 0) - 1} label={`참고 시트 ${e.panel ?? "-"}번 칸`} />
            <figcaption className="text-[13px] text-muted mt-1">참고 {e.panel ? `${e.panel}번 칸` : "없음"}</figcaption>
          </figure>
          <figure>
            {own ? (
              <img src={own.previewUrl} alt={`${index + 1}번 표정 그림`} className="w-full max-h-80 object-contain rounded-lg border border-line checker" style={{ aspectRatio: aspect }} />
            ) : (
              <PanelCrop asset={sheet} cols={doc.data.expressions.length} rows={1} index={index} label={`생성 시트 ${index + 1}번 칸`} />
            )}
            <figcaption className="text-[13px] text-muted mt-1">{own ? "표정 그림" : sheet ? "이전 방식 시트의 칸" : "표정 그림 없음"}</figcaption>
          </figure>
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <Field label="감정" value={e.emotion} onChange={(v) => update({ emotion: v })} placeholder="예: 능청스러운 비웃음" />
        {ref && (
          <div>
            <label className="field-label" htmlFor={`panel-${e.id}`}>참고 칸</label>
            <select
              id={`panel-${e.id}`}
              className="select"
              value={e.panel ?? ""}
              onChange={(ev) => update({ panel: ev.target.value ? Number(ev.target.value) : null })}
            >
              <option value="">없음</option>
              {Array.from({ length: s.refColumns * s.refRows }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>
          </div>
        )}
      </div>
      <Seg label="강도" value={e.intensity} options={INTENSITY} labels={INTENSITY_LABEL} onChange={(v) => update({ intensity: v })} />
      {showsHands(s.framing) && (
        <Field
          label="팔·손 동작"
          multiline
          rows={2}
          value={e.gesture}
          onChange={(v) => update({ gesture: v })}
          placeholder={
            s.framing === "bust"
              ? "예: 왼손 손끝으로 입가를 가리고, 오른손은 땋은 머리를 만지작거림"
              : "예: 팔짱을 끼고 한쪽 어깨를 으쓱 올림"
          }
          help="비워두면 그림 모델이 감정에 맞는 동작을 고릅니다."
        />
      )}
      {multi && (
        <Field
          label="나머지 인물의 반응"
          multiline
          rows={2}
          value={e.others}
          onChange={(v) => update({ others: v })}
          placeholder={`예: ${d.cast.filter((c) => c.id !== e.characterId).map((c) => c.name || "상대").join(", ")}는 팔짱을 낀 채 눈썹을 치켜올리고 말하는 쪽을 본다`}
          help="비워두면 나머지 인물은 입을 다문 채 말하는 인물을 보며 자연스럽게 반응합니다."
        />
      )}
      <details className="rounded-lg border border-line">
        <summary className="cursor-pointer p-3 text-[14px]">
          <span className="font-semibold">세부 연기 (눈썹·눈·입·메모)</span>
          {(e.brows || e.eyes || e.mouth) && (
            <span className="block text-muted truncate">{[e.brows, e.eyes, e.mouth].filter(Boolean).join(" / ")}</span>
          )}
        </summary>
        <div className="px-3 pb-3 space-y-2">
          <div className="grid sm:grid-cols-3 gap-2">
            <Field label="눈썹" multiline rows={2} value={e.brows} onChange={(v) => update({ brows: v })} />
            <Field label="눈" multiline rows={2} value={e.eyes} onChange={(v) => update({ eyes: v })} />
            <Field label="입" multiline rows={2} value={e.mouth} onChange={(v) => update({ mouth: v })} />
          </div>
          <Field label="메모" multiline rows={2} value={e.notes} onChange={(v) => update({ notes: v })} />
        </div>
      </details>
      <DirectionEditor
        e={e}
        index={index}
        onChange={(direction, confirm) => update({ direction, directionStatus: confirm ? "confirmed" : "manual" })}
      />
    </article>
  );
}

type ExpressionHandoff = {
  expressionId: string;
  index: number;
  emotion: string;
  aspectRatio: string;
  references: { role: string; assetId: string; why: string }[];
  prompt: string;
};

/** Manual route: one prompt per expression to paste on higgsfield.ai, and an upload slot per expression. */
function HiggsfieldHandoff() {
  const { doc, projectId, assets } = useEditor();
  const [items, setItems] = useState<ExpressionHandoff[] | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A hand-made image follows the prompt above (the current framing); its aspect ratio is measured.
  const setImage = (id: string, assetId: string | null, asset?: AssetView) => {
    const known = asset?.width && asset.height ? ratioLabel(asset.width, asset.height) : null;
    doc.edit(1, (d) => ({
      ...d,
      expressions: d.expressions.map((x) =>
        x.id === id
          ? { ...x, imageAssetId: assetId, imageFraming: assetId ? d.expressionSetup.framing : null, imageAspect: assetId ? known : null }
          : x,
      ),
    }));
    // No stored size (e.g. picked from the library): read it from the image itself.
    if (assetId && !known && asset?.previewUrl)
      void measureAspect(asset.previewUrl).then((aspect) => {
        if (!aspect) return;
        doc.edit(1, (d) => ({
          ...d,
          expressions: d.expressions.map((x) => (x.id === id && x.imageAssetId === assetId ? { ...x, imageAspect: aspect } : x)),
        }));
      });
  };

  async function build() {
    setLoading(true);
    setError(null);
    await doc.flush();
    const res = await fetch(`/api/projects/${projectId}/handoff?kind=expressions`);
    const body = await res.json();
    setLoading(false);
    if (!res.ok) return setError(body.error ?? "만들지 못했습니다.");
    setItems(body.items);
    setVersion(body.version);
  }

  return (
    <section className="p-5 space-y-4">
      <p className="text-muted">
        다른 모델·설정으로 직접 만들 때 씁니다. 표정마다 프롬프트와 참고 그림을 higgsfield.ai에 넣어 한 장씩 만들고, 결과를 해당 표정 칸에 올리세요.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-dark" onClick={build} disabled={loading}>
          {loading ? "만드는 중…" : items ? "현재 내용으로 다시 만들기" : "표정별 프롬프트 만들기"}
        </button>
        <a className="btn" href="https://higgsfield.ai" target="_blank" rel="noreferrer">higgsfield.ai 열기 ↗</a>
        <ExpressionPackButton />
      </div>
      {error && <p className="notice notice-error">{error}</p>}
      {items && <p className="text-[14px]">v{version} 기준 · 화면 비율 {items[0]?.aspectRatio} · 표정마다 한 장씩</p>}
      <ol className="space-y-4">
        {doc.data.expressions.map((e, i) => {
          const it = items?.find((x) => x.expressionId === e.id);
          return (
            <li key={e.id} className="rounded-lg border border-line p-4 grid lg:grid-cols-[minmax(0,280px)_1fr] gap-4">
              <ImageSlot
                label={`${i + 1}번 ${e.emotion || "표정"} 그림`}
                kind="sheet"
                assetId={e.imageAssetId}
                removable
                emptyText="이 표정의 그림을 올리세요."
                onChange={(id, asset) => setImage(e.id, id, asset)}
              />
              {it ? (
                <div className="space-y-3 min-w-0">
                  <div>
                    <div className="field-label">참고 그림 — 이 순서대로 첨부</div>
                    <ol className="flex flex-wrap gap-2">
                      {it.references.map((r) => {
                        const a = assets.get(r.assetId);
                        return (
                          <li key={r.assetId} className="rounded border border-line w-32 overflow-hidden text-[13px]">
                            {a && <img src={a.previewUrl} alt="" className="w-full h-20 object-contain checker" />}
                            <div className="p-1">
                              <div className="font-semibold">{r.role}</div>
                              <div className="text-muted">{r.why}</div>
                              {a && <a className="underline" href={a.url} target="_blank" rel="noreferrer">원본</a>}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="field-label">프롬프트</span>
                      <CopyButton text={it.prompt} label="복사" />
                    </div>
                    <textarea className="textarea font-mono text-[13px]" rows={7} readOnly value={it.prompt} aria-label={`${i + 1}번 표정 프롬프트`} />
                  </div>
                </div>
              ) : (
                <p className="text-muted self-center">‘표정별 프롬프트 만들기’를 누르면 여기에 프롬프트가 나옵니다.</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Aspect ratio label ("3:4", "9:16", …) of an image, read in the browser. */
function measureAspect(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? ratioLabel(img.naturalWidth, img.naturalHeight) : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Total video length. Set here (with the expression count) so dialogue and timing are designed within it. */
function DurationField() {
  const { doc, canEdit } = useEditor();
  const d = doc.data.acting.duration;
  const [text, setText] = useState(String(d));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(d);
  const commit = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return setText(String(d));
    doc.edit(1, (x) => setDuration(x, v));
    setText(String(Math.min(MAX_VIDEO_SECONDS, Math.max(0.5, v))));
  };
  const per = Math.round((d / Math.max(1, doc.data.expressions.length)) * 10) / 10;
  return (
    <div>
      <label className="field-label" htmlFor="total-duration">영상 전체 길이 (초)</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="total-duration"
          type="number"
          step="0.5"
          min={0.5}
          max={MAX_VIDEO_SECONDS}
          className="input w-28"
          value={shown}
          disabled={!canEdit}
          onFocus={() => {
            setText(String(d));
            setFocused(true);
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setFocused(false);
            commit(Number(text));
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <div className="seg" role="group" aria-label="자주 쓰는 길이">
          {[5, 8, 10, 15, 30].map((v) => (
            <button key={v} type="button" aria-pressed={d === v} disabled={!canEdit} onClick={() => commit(v)}>
              {v}초
            </button>
          ))}
        </div>
      </div>
      <p className="field-help">
        표정 {doc.data.expressions.length}개 · 표정당 평균 {per}초. 대사(3단계)는 이 시간 안에서 쓰고, 액팅(4단계)에서는 이 시간을 어떻게 나눌지만 정합니다.
        영상 모델 한도: Kling 4.0·Seedance 2.5 최대 30초, MiniMax H3 최대 15초.
      </p>
    </div>
  );
}

export function ExpressionStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc, canEdit } = useEditor();
  const s = doc.data.expressionSetup;
  const setSetup = (patch: Partial<typeof s>) => doc.edit(1, (d) => ({ ...d, expressionSetup: { ...d.expressionSetup, ...patch } }));
  const unconfirmed = doc.data.expressions.filter((e) => e.directionStatus === "ai").length;

  return (
    <StepFrame
      step={1}
      title="표정을 설계하세요"
      intro={
        doc.data.cast.length > 1
          ? "구도를 고르고 표정(비트)마다 연기하는 인물·감정·방향을 확인한 뒤, 표정마다 모든 인물이 들어간 장면 그림을 한 장씩 만듭니다."
          : "구도를 고르고 표정과 방향을 확인한 뒤, 표정마다 세로 그림을 한 장씩 만듭니다."
      }
      onNavigate={onNavigate}
    >
      <section className="space-y-4">
        <h3 className="section-title">① 표정 개수·영상 길이·구도</h3>
        <div>
          <div className="field-label">만들 표정 개수</div>
          <div className="seg">
            {Array.from({ length: MAX_EXPRESSIONS - MIN_EXPRESSIONS + 1 }, (_, i) => i + MIN_EXPRESSIONS).map((n) => (
              <button
                key={n}
                aria-pressed={s.count === n}
                disabled={!canEdit}
                onClick={() => doc.edit(1, (d) => setExpressionCount(d, n))}
              >
                {n}개
              </button>
            ))}
          </div>
        </div>
        <DurationField />
        <FramingPicker />
        <SceneField />
        <details className="rounded-xl border border-line" open={!!s.refAssetId || !!s.instruction}>
          <summary className="cursor-pointer p-4 font-semibold">표정 참고 시트·연출 지시 (선택)</summary>
          <div className="px-4 pb-4">
        <div className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-6">
          <ImageSlot
            label="표정 참고 시트 (선택)"
            kind="expression_ref"
            assetId={s.refAssetId}
            removable
            emptyText="다른 캐릭터의 표정집처럼, 원하는 연기가 담긴 그림을 올리세요. 그림체는 가져오지 않고 연기만 참고합니다."
            onChange={(id) => setSetup({ refAssetId: id, styleWarning: null })}
          />
          <div className="space-y-4">
            {s.refAssetId && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label" htmlFor="ref-cols">참고 시트 가로 칸 수</label>
                  <input id="ref-cols" type="number" min={1} max={12} className="input" value={s.refColumns} disabled={!canEdit}
                    onChange={(e) => setSetup({ refColumns: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />
                </div>
                <div>
                  <label className="field-label" htmlFor="ref-rows">세로 줄 수</label>
                  <input id="ref-rows" type="number" min={1} max={6} className="input" value={s.refRows} disabled={!canEdit}
                    onChange={(e) => setSetup({ refRows: Math.max(1, Math.min(6, Number(e.target.value) || 1)) })} />
                </div>
              </div>
            )}
            <Seg
              label="참고 시트에서 가져올 것"
              value={s.transfer}
              options={["expression_only", "expression_and_pose"] as const}
              labels={{ expression_only: "표정만 (권장)", expression_and_pose: "표정과 고개 포즈" }}
              onChange={(v) => setSetup({ transfer: v })}
            />
            <Field
              label="연출 지시 (선택)"
              multiline
              rows={3}
              value={s.instruction}
              onChange={(v) => setSetup({ instruction: v })}
              placeholder="예: 감정은 은은하게, 3번은 더 당황스럽게"
            />
          </div>
        </div>
          </div>
        </details>
        {s.styleWarning && <p className="notice notice-warn">그림체 경고: {s.styleWarning} — 표정 시트를 만들 때 그림체가 섞이지 않았는지 꼭 확인하세요.</p>}
      </section>

      <section className="space-y-4">
        <h3 className="section-title">② AI 표정 설계</h3>
        <AiAction
          kind="design_expressions"
          step={1}
          label={s.scene.trim() ? "상황 설정에 맞춰 AI로 표정 설계" : "AI로 표정 설계"}
          disabled={doc.data.cast.some((c) => !c.baseAssetId)}
          disabledReason="1단계에서 모든 인물의 기본 그림을 먼저 올리세요."
          instruction={s.instruction}
          description={`${
            s.scene.trim()
              ? `상황 설정의 장면을 연기하는 표정 ${s.count}개를 순서대로 설계합니다${s.refAssetId ? " (참고 시트에서 장면에 맞는 칸을 골라 분석)" : ""}.`
              : s.refAssetId
                ? "참고 시트의 각 칸을 따로 관찰해 감정과 방향을 제안합니다."
                : doc.data.cast.length > 1
                  ? "인물들이 주고받는 장면의 표정(비트)과 연기하는 인물을 제안합니다."
                  : "캐릭터에 맞는 표정을 제안합니다."
          }${showsHands(s.framing) ? " 구도에 맞는 팔·손 동작도 표정마다 다르게 제안합니다." : ""}`}
        />
        <PendingProposal step={1} except={["check_sheet"]} />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="section-title">③ 표정 카드 확인</h3>
          {unconfirmed > 0 && <span className="pill pill-warn">방향 확인 필요 {unconfirmed}개</span>}
        </div>
        <div className="grid xl:grid-cols-2 gap-4">
          {doc.data.expressions.map((e, i) => <ExpressionCard key={e.id} e={e} index={i} />)}
        </div>
      </section>

      <EnglishBar />

      <HiggsfieldDirect
        onUse={(expressionId, assetId, framing, aspect) =>
          doc.edit(1, (d) => ({
            ...d,
            expressions: d.expressions.map((x) =>
              x.id === expressionId ? { ...x, imageAssetId: assetId, imageFraming: framing, imageAspect: aspect } : x,
            ),
          }))
        }
      />

      <details className="rounded-xl border border-line">
        <summary className="cursor-pointer p-4 font-semibold">수동으로 만들기·직접 올리기 (표정별 프롬프트 · ZIP 다운로드)</summary>
        <div className="px-1 pb-1">
          <HiggsfieldHandoff />
        </div>
      </details>

      <section className="space-y-4">
        <h3 className="section-title">④ 표정 그림 검사</h3>
        <AiAction
          kind="check_sheet"
          step={1}
          label="AI로 표정 그림 검사"
          disabled={!doc.data.expressions.some((e) => e.imageAssetId) && !s.sheetAssetId}
          disabledReason="표정 그림을 생성하거나 올리면 검사할 수 있습니다."
          description="표정·방향·고정 특징·그림체, 그리고 그림끼리 구도·크기가 이어지는지 확인합니다. 새 그림이 모두 준비되면 자동으로 한 번 검사합니다."
        />
        <PendingProposal step={1} kinds={["check_sheet"]} />
        {s.sheetAssetId && (
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-[14px] font-semibold">이전 방식: 한 장짜리 표정 시트</summary>
            <div className="mt-3 max-w-xl">
              <ImageSlot
                label="표정 시트"
                kind="sheet"
                assetId={s.sheetAssetId}
                removable
                emptyText=""
                onChange={(id) => setSetup({ sheetAssetId: id })}
              />
            </div>
          </details>
        )}
      </section>
    </StepFrame>
  );
}
