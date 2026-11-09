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
  shotsOf,
  imageAspectFor,
  performancesOf,
  setLead,
  updatePerformance,
  type Performance,
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
import { HiggsfieldDirect, SketchGenerator, SketchRedoButton } from "./higgsfield-direct";
import { ExpressionPackButton } from "../packs";
import { EnglishBar } from "../prompt-tools";
import { guideIssues } from "@/lib/domain/check";
import { ACTION_ORDER_KO, HU_ITEMS_KO, MAX_PRINCIPLES, PRINCIPLES } from "@/lib/domain/principles";

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

function DirectionEditor({
  e,
  warnings,
  onChange,
}: {
  /** `id` makes the form ids unique (beat id + character id) */
  e: { id: string; direction: Direction; directionStatus: Expression["directionStatus"] };
  warnings: string[];
  onChange: (d: Direction, confirm: boolean) => void;
}) {
  const { canEdit } = useEditor();
  const d = e.direction;
  const set = (patch: Partial<Direction>) => onChange({ ...d, ...patch }, false);
  const warn = warnings.map((message) => ({ message }));
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
        씬 시놉시스·시나리오 (1단계와 같은 글 — 여기서 고쳐도 됨)
      </label>
      <textarea
        id="scene"
        className="textarea"
        rows={5}
        value={scene}
        disabled={!canEdit}
        // the scenario is step 1's source text: editing it here re-opens step 1 too, as editing it there does
        onChange={(e) => doc.edit(0, (d) => ({ ...d, expressionSetup: { ...d.expressionSetup, scene: e.target.value } }))}
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
        장면 상황과 기초 대사를 적으면, 아래 ‘{doc.data.mode === "storyboard" ? "AI로 콘티 설계’가 이 장면을 컷으로 나눠" : "AI로 표정 설계’가 이 장면을 연기하는 표정을"} 순서대로 설계합니다(대사마다 {doc.data.mode === "storyboard" ? "컷" : "표정"} 배정).
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

/** 2-3 priority animation principles for one beat (the team's field guide), as toggle chips. */
function PrincipleChips({ e, onChange }: { e: Expression; onChange: (keys: string[]) => void }) {
  const { canEdit } = useEditor();
  const on = new Set(e.principles);
  return (
    <div role="group" aria-label="우선 원칙">
      <div className="text-[13px] font-semibold mb-1 text-muted">우선 애니메이션 원칙 (2~3개 · 영상 프롬프트에 움직임으로 들어감)</div>
      <div className="flex flex-wrap gap-1">
        {PRINCIPLES.map((p) => {
          const pressed = on.has(p.key);
          return (
            <button
              key={p.key}
              type="button"
              className={`btn btn-sm ${pressed ? "btn-dark" : ""}`}
              aria-pressed={pressed}
              title={`${p.ko} — ${p.check}`}
              disabled={!canEdit || (!pressed && on.size >= MAX_PRINCIPLES)}
              onClick={() => onChange(pressed ? e.principles.filter((k) => k !== p.key) : [...e.principles, p.key])}
            >
              {p.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The field guides' checks for this step (camera moves, vague words, hook-ups) and a short summary of the guides. */
function GuidePanel() {
  const { doc } = useEditor();
  const items = guideIssues(doc.data);
  return (
    <div className="rounded-lg border border-line bg-white p-3 space-y-2" aria-label="가이드 점검">
      <div className="font-semibold">애니메이션 원칙·연속성 점검</div>
      {items.length ? (
        <ul className="space-y-1 text-[14px]">
          {items.map((i, k) => (
            <li key={k} className="notice notice-warn">
              <strong>{i.area}</strong> · {i.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-ok">카메라 이동·표현·연결 상태에서 걸리는 곳이 없습니다.</p>
      )}
      <details>
        <summary className="cursor-pointer text-[14px] font-semibold">가이드 요약 (8가지 원칙 · 연속성)</summary>
        <div className="mt-2 space-y-2 text-[14px]">
          <p>
            한 컷에 <strong>핵심 행동 하나</strong>, 우선 원칙 <strong>2~3개</strong>. 동작은 <strong>{ACTION_ORDER_KO}</strong> 순서로 관찰할 수 있게 쓰고, 시선·얼굴·몸
            방향은 따로, 좌우에는 기준(화면 기준 / 몸 기준)을 붙입니다. 카메라는 <strong>고정 또는 한 가지 이동</strong>, 시작·끝 구도를 적습니다.
          </p>
          <ul className="list-disc pl-5">
            {PRINCIPLES.map((p) => (
              <li key={p.key}>
                <strong>{p.ko}</strong> — {p.check}
              </li>
            ))}
          </ul>
          <p>
            <strong>연결 상태(HU)</strong>: 컷마다 ‘시작 / 끝’을 적고, 다음 컷의 시작 = 앞 컷의 끝. 기록할 것: {HU_ITEMS_KO}. 움직이는 중에 컷이 바뀌면 같은 동작의 다음
            단계부터, 멈춘 상태면 같은 자세를 새 시점으로. 검토 순서: 방향과 위치 → 시선 → 접촉과 행동 단계 → 속도.
          </p>
        </div>
      </details>
    </div>
  );
}

function ExpressionCard({ e, index }: { e: Expression; index: number }) {
  const { doc, assets } = useEditor();
  const s = doc.data.expressionSetup;
  const update = (patch: Partial<Expression>) =>
    doc.edit(1, (d) => ({ ...d, expressions: d.expressions.map((x) => (x.id === e.id ? { ...x, ...patch } : x)) }));
  const change = (fn: (x: Expression) => Expression) =>
    doc.edit(1, (d) => ({ ...d, expressions: d.expressions.map((x) => (x.id === e.id ? fn(x) : x)) }));
  const ref = s.refAssetId ? assets.get(s.refAssetId) : undefined;
  const sheet = s.sheetAssetId ? assets.get(s.sheetAssetId) : undefined;
  const own = e.imageAssetId ? assets.get(e.imageAssetId) : undefined;
  const d = doc.data;
  const multi = d.cast.length > 1;
  const aspect = imageAspectFor(d).replace(":", "/");
  const warningsFor = (label: string) =>
    directionIssues(e, index, d)
      .filter((i) => i.level === "warn" && i.message.startsWith(label))
      .map((i) => i.message);

  return (
    <article className={`rounded-xl border border-line p-4 space-y-3 ${multi ? "xl:col-span-2" : ""}`} aria-label={`${index + 1}번 표정`}>
      <div className="flex items-center gap-2">
        <span className="grid place-items-center size-8 rounded-full bg-[#26301f] text-white font-bold">{index + 1}</span>
        <span className="font-semibold truncate">
          {multi
            ? performancesOf(d, e)
                .map((p) => `${d.cast.find((c) => c.id === p.characterId)?.name || "인물"} ${p.emotion || "?"}`)
                .join(" · ")
            : e.emotion || "감정 미정"}
        </span>
      </div>
      {(ref || sheet || own) && (
        <div className={`grid gap-2 ${multi ? "grid-cols-[1fr_2fr]" : "grid-cols-2"}`}>
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
            <figcaption className="text-[13px] text-muted mt-1">{own ? (multi ? "장면 그림" : "표정 그림") : sheet ? "이전 방식 시트의 칸" : "표정 그림 없음"}</figcaption>
          </figure>
        </div>
      )}
      {multi ? (
        <>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <label className="field-label" htmlFor={`actor-${e.id}`}>중심 인물 (대사가 있으면 이 인물이 말함)</label>
              <select id={`actor-${e.id}`} className="select" value={e.characterId} onChange={(ev) => change((x) => setLead(x, ev.target.value))}>
                {d.cast.map((c) => (
                  <option key={c.id} value={c.id}>{castLabel(d, c.id)}</option>
                ))}
              </select>
            </div>
            {ref && <PanelSelect e={e} cells={s.refColumns * s.refRows} onChange={(panel) => update({ panel })} />}
          </div>
          <Field label="이 순간 (메모)" multiline rows={2} value={e.notes} onChange={(v) => update({ notes: v })} placeholder="예: 대사 1 ‘Come closer’를 말하는 순간, 브람은 한발 물러선다" />
          <div className={`grid lg:grid-cols-2 gap-3 ${d.cast.length >= 3 ? "2xl:grid-cols-3" : ""}`}>
            {performancesOf(d, e).map((p) => (
              <PerformanceEditor
                key={p.characterId}
                id={`${e.id}-${p.characterId}`}
                title={`${castLabel(d, p.characterId)}${p.lead ? " · 중심" : ""}`}
                p={p}
                framing={s.framing}
                warnings={warningsFor(`${index + 1}번 표정 ${castLabel(d, p.characterId)}`)}
                onChange={(patch) => change((x) => updatePerformance(x, p.characterId, patch))}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <Field label="감정" value={e.emotion} onChange={(v) => update({ emotion: v })} placeholder="예: 능청스러운 비웃음" />
            {ref && <PanelSelect e={e} cells={s.refColumns * s.refRows} onChange={(panel) => update({ panel })} />}
          </div>
          <Seg label="강도" value={e.intensity} options={INTENSITY} labels={INTENSITY_LABEL} onChange={(v) => update({ intensity: v })} />
          {showsHands(s.framing) && (
            <Field
              label="팔·손 동작"
              multiline
              rows={2}
              value={e.gesture}
              onChange={(v) => update({ gesture: v })}
              placeholder={s.framing === "bust" ? "예: 왼손 손끝으로 입가를 가리고, 오른손은 땋은 머리를 만지작거림" : "예: 팔짱을 끼고 한쪽 어깨를 으쓱 올림"}
              help="비워두면 그림 모델이 감정에 맞는 동작을 고릅니다."
            />
          )}
          <details className="rounded-lg border border-line">
            <summary className="cursor-pointer p-3 text-[14px]">
              <span className="font-semibold">세부 연기 (눈썹·눈·입·메모)</span>
              {(e.brows || e.eyes || e.mouth) && <span className="block text-muted truncate">{[e.brows, e.eyes, e.mouth].filter(Boolean).join(" / ")}</span>}
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
          <PrincipleChips e={e} onChange={(principles) => update({ principles })} />
          <DirectionEditor
            e={e}
            warnings={warningsFor(`${index + 1}번 표정`)}
            onChange={(direction, confirm) => update({ direction, directionStatus: confirm ? "confirmed" : "manual" })}
          />
        </>
      )}
    </article>
  );
}

function PanelSelect({ e, cells, onChange }: { e: Expression; cells: number; onChange: (panel: number | null) => void }) {
  return (
    <div>
      <label className="field-label" htmlFor={`panel-${e.id}`}>참고 칸</label>
      <select id={`panel-${e.id}`} className="select" value={e.panel ?? ""} onChange={(ev) => onChange(ev.target.value ? Number(ev.target.value) : null)}>
        <option value="">없음</option>
        {Array.from({ length: cells }, (_, i) => (
          <option key={i} value={i + 1}>{i + 1}</option>
        ))}
      </select>
    </div>
  );
}

/** One character's acting in a group beat: emotion, strength, arms and hands, face details and direction. */
function PerformanceEditor(props: {
  id: string;
  title: string;
  p: Performance & { lead: boolean };
  framing: Framing;
  warnings: string[];
  onChange: (patch: Partial<Omit<Performance, "characterId">>) => void;
}) {
  const { p, onChange } = props;
  return (
    <section className={`rounded-lg border p-3 space-y-3 ${p.lead ? "border-accent bg-[#fffaf5]" : "border-line"}`} aria-label={props.title}>
      <h4 className="font-semibold">{props.title}</h4>
      <Field label="감정" value={p.emotion} onChange={(v) => onChange({ emotion: v })} placeholder={p.lead ? "예: 불같은 분노" : "예: 놀라서 움찔함"} />
      <Seg label="강도" value={p.intensity} options={INTENSITY} labels={INTENSITY_LABEL} onChange={(v) => onChange({ intensity: v })} />
      {showsHands(props.framing) && (
        <Field label="팔·손 동작" multiline rows={2} value={p.gesture} onChange={(v) => onChange({ gesture: v })} help="비워두면 그림 모델이 감정에 맞는 동작을 고릅니다." />
      )}
      <details className="rounded-lg border border-line bg-white">
        <summary className="cursor-pointer p-3 text-[14px]">
          <span className="font-semibold">얼굴 연기 (눈썹·눈·입)</span>
          {(p.brows || p.eyes || p.mouth) && <span className="block text-muted truncate">{[p.brows, p.eyes, p.mouth].filter(Boolean).join(" / ")}</span>}
        </summary>
        <div className="px-3 pb-3 grid sm:grid-cols-3 gap-2">
          <Field label="눈썹" multiline rows={2} value={p.brows} onChange={(v) => onChange({ brows: v })} />
          <Field label="눈" multiline rows={2} value={p.eyes} onChange={(v) => onChange({ eyes: v })} />
          <Field label="입" multiline rows={2} value={p.mouth} onChange={(v) => onChange({ mouth: v })} placeholder={p.lead ? "" : "말하지 않으면 다문 입"} />
        </div>
      </details>
      <DirectionEditor
        e={{ id: props.id, direction: p.direction, directionStatus: p.directionStatus }}
        warnings={props.warnings}
        onChange={(direction, confirm) => onChange({ direction, directionStatus: confirm ? "confirmed" : "manual" })}
      />
    </section>
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
        {doc.data.mode === "storyboard" ? "컷" : "표정"} {doc.data.expressions.length}개 · 하나당 평균 {per}초. 대사(3단계)는 이 시간 안에서 쓰고, 액팅(4단계)에서는 이 시간을 어떻게 나눌지만 정합니다.
        영상 모델 한도: Kling 4.0·Seedance 2.5 최대 30초, Gemini Omni Flash 1.2 최대 15초(참고 그림·끝 프레임 사용 시 10초), MiniMax H3 최대 15초.
      </p>
    </div>
  );
}

export function ExpressionStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc } = useEditor();
  return doc.data.mode === "storyboard" ? <StoryboardStep onNavigate={onNavigate} /> : <CastExpressionStep onNavigate={onNavigate} />;
}

/* ───────────── Storyboard mode: panels (콘티) ───────────── */

function useImageSetter() {
  const { doc } = useEditor();
  return (expressionId: string, assetId: string, framing: Framing | null, aspect: string | null) =>
    doc.edit(1, (d) => ({
      ...d,
      expressions: d.expressions.map((x) => (x.id === expressionId ? { ...x, imageAssetId: assetId, imageFraming: framing, imageAspect: aspect } : x)),
    }));
}

function StoryboardStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc, canEdit } = useEditor();
  const d = doc.data;
  const s = d.expressionSetup;
  const setImage = useImageSetter();
  return (
    <StepFrame
      step={1}
      title="콘티를 만드세요"
      intro="장면을 컷으로 나누고, 컷마다 그 순간 화면 전체(장면 묘사·카메라)를 정해 한 장씩 그립니다. 러프 스케치를 올리면 그 구도를 따릅니다. 컷들은 영상에서 컷 없는 한 쇼트로 이어집니다."
      onNavigate={onNavigate}
    >
      <section className="space-y-4">
        <h3 className="section-title">① 컷 수·영상 길이·화면 비율</h3>
        <div>
          <div className="field-label">컷 수</div>
          <div className="seg">
            {Array.from({ length: MAX_EXPRESSIONS - MIN_EXPRESSIONS + 1 }, (_, i) => i + MIN_EXPRESSIONS).map((n) => (
              <button key={n} aria-pressed={s.count === n} disabled={!canEdit} onClick={() => doc.edit(1, (x) => setExpressionCount(x, n))}>
                {n}컷
              </button>
            ))}
          </div>
        </div>
        <DurationField />
        <div>
          <Seg
            label="화면 비율 (컷 그림과 영상이 함께 씀)"
            value={d.video.aspectRatio}
            options={["16:9", "9:16"] as const}
            labels={{ "16:9": "가로 16:9", "9:16": "세로 9:16" }}
            onChange={(v) => doc.edit(1, (x) => ({ ...x, video: { ...x.video, aspectRatio: v } }))}
          />
          <p className="field-help">컷 그림은 영상과 같은 비율로 그려, 영상에 그대로 참고 그림으로 들어갑니다.</p>
        </div>
        <SceneField />
        <Field
          label="모든 컷에 공통 연출 지시 (선택)"
          multiline
          rows={2}
          value={s.instruction}
          onChange={(v) => doc.edit(1, (x) => ({ ...x, expressionSetup: { ...x.expressionSetup, instruction: v } }))}
          placeholder="예: 해 질 녘 역광, 먼지가 날리는 분위기"
        />
      </section>

      <section className="space-y-4">
        <h3 className="section-title">② AI 콘티 설계</h3>
        <AiAction
          kind="design_expressions"
          step={1}
          label={s.scene.trim() ? "시나리오에 맞춰 AI로 콘티 설계" : "AI로 콘티 설계"}
          disabled={!d.baseAssetId}
          disabledReason="1단계에서 장면 기준 그림을 먼저 올리세요."
          description={`시나리오 전체를 컷 ${s.count}개·${d.acting.duration}초에 담아 제목·장면 묘사·카메라·연결·말하는 인물을 제안합니다. 러프 스케치를 올린 컷은 그 구도를 따릅니다.`}
        />
        <div className="rounded-lg border border-line bg-[#f7f8fa] p-3 space-y-2">
          <p className="text-[14px]">
            컷 수나 영상 길이를 바꾸면 지금 컷 내용은 그대로 남습니다(컷 수를 줄이면 <strong>뒤쪽 컷이 빠집니다</strong>). 시나리오 전체를 지금 컷 수·길이로 새로 나누려면
            처음부터 다시 설계하세요. 그 뒤 대사(3단계)·타임라인(4단계)도 다시 맞추는 것이 좋습니다.
          </p>
          <AiAction
            kind="design_expressions"
            step={1}
            label={`컷 ${s.count}개·${d.acting.duration}초로 처음부터 다시 설계`}
            instruction={`[처음부터 다시] 지금 컷 수 ${s.count}개와 영상 길이 ${d.acting.duration}초에 맞춰 시나리오 전체를 다시 나눠 주세요.`}
            disabled={!d.baseAssetId}
            disabledReason="1단계에서 장면 기준 그림을 먼저 올리세요."
          />
        </div>
        <PendingProposal step={1} except={["check_sheet"]} />
        <Field
          label="장면 연결 규칙 (모든 컷이 지킴: 180도 축·화면 좌우, 장소 지리, 빛 방향, 의상·소품 변화, 동선)"
          multiline
          rows={4}
          value={s.continuity}
          onChange={(v) => doc.edit(1, (x) => ({ ...x, expressionSetup: { ...x.expressionSetup, continuity: v } }))}
          placeholder={"AI 콘티 설계가 채워 줍니다. 예:\n1) 아스파샤는 늘 화면 왼쪽, 샤르휘나는 오른쪽 — 서로 마주 봄\n2) 성문은 화면 왼쪽, 사막은 오른쪽\n3) 해는 화면 오른쪽 낮은 곳(역광)\n4) 3번 컷에서 숄을 건넴 → 4번 컷부터 샤르휘나가 숄을 듦"}
          help="컷 그림과 영상 프롬프트에 함께 들어가, 컷과 컷·쇼트와 쇼트 사이의 의상·위치·방향·빛이 어긋나지 않게 합니다."
        />
      </section>

      <section className="space-y-4">
        <h3 className="section-title">③ 컷 카드</h3>
        <ShotStrip />
        <GuidePanel />
        <SketchGenerator />
        <ol className="grid xl:grid-cols-2 gap-4">
          {d.expressions.map((e, i) => (
            <PanelCard key={e.id} e={e} index={i} />
          ))}
        </ol>
      </section>

      <EnglishBar />

      <HiggsfieldDirect onUse={setImage} />

      <details className="rounded-xl border border-line">
        <summary className="cursor-pointer p-4 font-semibold">수동으로 만들기·직접 올리기 (컷별 프롬프트 · ZIP 다운로드)</summary>
        <div className="px-1 pb-1">
          <HiggsfieldHandoff />
        </div>
      </details>

      <section className="space-y-4">
        <h3 className="section-title">④ 컷 그림 검사</h3>
        <AiAction
          kind="check_sheet"
          step={1}
          label="AI로 컷 그림 검사"
          disabled={!d.expressions.some((e) => e.imageAssetId)}
          disabledReason="컷 그림을 생성하거나 올리면 검사할 수 있습니다."
          description="장면 묘사대로인지, 주요 인물이 섞이지 않았는지, 컷끼리 한 쇼트처럼 이어지는지 확인합니다."
        />
        <PendingProposal step={1} kinds={["check_sheet"]} />
      </section>
    </StepFrame>
  );
}

/** The scene's shot structure at a glance: panels joined by camera moves (→) or split by cuts (|). */
function ShotStrip() {
  const { doc } = useEditor();
  const d = doc.data;
  const shots = shotsOf(d);
  const no = (id: string) => d.expressions.findIndex((e) => e.id === id) + 1;
  return (
    <div className="rounded-lg border border-line bg-white p-3 space-y-1" aria-label="쇼트 구성">
      <div className="flex flex-wrap items-center gap-1 text-[14px]">
        {shots.map((sh, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            {i > 0 && <span className="px-1 font-bold text-accent" title="컷 분할">✂</span>}
            <span className="rounded-md border border-line bg-[#f7f8fa] px-2 py-1">
              <span className="text-[12px] text-muted mr-1">쇼트 {i + 1}</span>
              {sh.map((id, k) => (
                <span key={id}>
                  {k > 0 && <span className="text-muted"> → </span>}
                  {no(id)}
                </span>
              ))}
            </span>
          </span>
        ))}
      </div>
      <p className="field-help">
        {shots.length > 1
          ? `컷 분할 ${shots.length - 1}곳, 쇼트 ${shots.length}개. ✂ 에서 화면이 끊기고 새 쇼트가 시작되며, → 는 같은 쇼트 안에서 카메라가 이어서 움직입니다.`
          : "지금은 모든 컷이 카메라 이동으로 이어지는 한 쇼트입니다. 컷 카드의 ‘앞 컷과의 연결’에서 컷 분할을 고를 수 있습니다."}
      </p>
    </div>
  );
}

/** One storyboard panel: title, the whole moment, the camera, who speaks, a rough sketch and the panel image. */
function PanelCard({ e, index }: { e: Expression; index: number }) {
  const { doc, assets } = useEditor();
  const d = doc.data;
  const update = (patch: Partial<Expression>) =>
    doc.edit(1, (x) => ({ ...x, expressions: x.expressions.map((y) => (y.id === e.id ? { ...y, ...patch } : y)) }));
  const own = e.imageAssetId ? assets.get(e.imageAssetId) : undefined;
  const aspect = d.video.aspectRatio.replace(":", "/");
  return (
    <li className="rounded-xl border border-line p-4 space-y-3" aria-label={`${index + 1}번 컷`}>
      <div className="flex items-center gap-2">
        <span className="grid place-items-center size-8 rounded-full bg-[#26301f] text-white font-bold">{index + 1}</span>
        <span className="font-semibold truncate">{e.emotion || "제목 없음"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <ImageSlot
            label="러프 스케치 (선택)"
            kind="acting_ref"
            assetId={e.sketchAssetId}
            removable
            emptyText="콘티 칸을 올리거나 위 ‘러프 콘티 바로 생성’으로 만들면 구도·자세·카메라를 따릅니다 (선 그림체는 따르지 않음)."
            onChange={(id) => update({ sketchAssetId: id })}
          />
          <SketchRedoButton expressionId={e.id} hasSketch={Boolean(e.sketchAssetId)} />
        </div>
        <figure>
          <div className="field-label">컷 그림</div>
          <div className="rounded-lg border border-line checker grid place-items-center overflow-hidden" style={{ aspectRatio: aspect }}>
            {own ? <img src={own.previewUrl} alt={`${index + 1}번 컷 그림`} className="w-full h-full object-contain" /> : <span className="text-[13px] text-muted p-2 text-center">아래 Higgsfield에서 생성</span>}
          </div>
        </figure>
      </div>
      <Field label="컷 제목" value={e.emotion} onChange={(v) => update({ emotion: v })} placeholder="예: 군중이 갈라지며 칼리엘라 등장" />
      <Field
        label="장면 묘사 (이 순간 화면 전체)"
        multiline
        rows={4}
        value={e.action}
        onChange={(v) => update({ action: v })}
        placeholder="예: 횃불을 든 군중이 좌우로 갈라지고, 그 사이로 칼리엘라가 걸어 나온다. 브람은 오른쪽 앞에서 칼자루를 쥔 채 그녀를 노려본다."
      />
      {index > 0 && (
        <div>
          <Seg
            label="앞 컷과의 연결"
            value={e.link}
            options={["continuous", "cut"] as const}
            labels={{ continuous: "→ 이어짐 (카메라 이동)", cut: "✂ 컷 분할 (새 쇼트)" }}
            onChange={(v) =>
              doc.edit(1, (x) => ({ ...x, expressions: x.expressions.map((y) => (y.id === e.id ? { ...y, link: v } : y)) }))
            }
          />
        </div>
      )}
      <Field
        label="카메라"
        value={e.camera}
        onChange={(v) => update({ camera: v })}
        placeholder={e.link === "cut" && index > 0 ? "예: 입술 특대 클로즈업, 고정" : "예: 와이드 로우앵글에서 칼리엘라 쪽으로 천천히 다가감"}
      />
      <Field
        label="연결 상태 HU (시작 → 끝: 화면 위치·시선·몸 기준 손·발 접지·소품·동작 단계·감정·빛)"
        multiline
        rows={3}
        value={e.continuity}
        onChange={(v) => update({ continuity: v })}
        placeholder={"예: 시작: 칼리엘라 화면 왼쪽, 오른쪽의 브람을 봄, 횃불은 인물의 오른손. / 끝: 칼리엘라가 한 걸음 다가서 멈춤, 횃불 그대로 오른손, 해는 화면 오른쪽 뒤.\n다음 컷의 시작은 이 컷의 끝과 같아야 합니다."}
      />
      <PrincipleChips e={e} onChange={(principles) => update({ principles })} />
      {d.cast.length > 1 && (
        <div>
          <label className="field-label" htmlFor={`speaker-${e.id}`}>말하는 인물 (이 컷에 대사가 있을 때)</label>
          <select id={`speaker-${e.id}`} className="select" value={e.characterId} onChange={(ev) => update({ characterId: ev.target.value })}>
            {d.cast.map((c) => (
              <option key={c.id} value={c.id}>{castLabel(d, c.id)}</option>
            ))}
          </select>
        </div>
      )}
      <Field label="메모 (팀용, 프롬프트에는 들어가지 않음)" value={e.notes} onChange={(v) => update({ notes: v })} />
    </li>
  );
}

function CastExpressionStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc, canEdit } = useEditor();
  const s = doc.data.expressionSetup;
  const setSetup = (patch: Partial<typeof s>) => doc.edit(1, (d) => ({ ...d, expressionSetup: { ...d.expressionSetup, ...patch } }));
  // every character's direction counts (the approval check looks at all of them)
  const unconfirmed = doc.data.expressions.reduce((n, e) => n + performancesOf(doc.data, e).filter((p) => p.directionStatus === "ai").length, 0);

  return (
    <StepFrame
      step={1}
      title="표정을 설계하세요"
      intro={
        doc.data.cast.length > 1
          ? "구도를 고르고 표정(비트)마다 모든 인물의 감정·연기·방향을 함께 정한 뒤, 표정마다 모든 인물이 들어간 장면 그림을 한 장씩 만듭니다."
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
          label={s.scene.trim() ? "시나리오에 맞춰 AI로 표정 설계" : "AI로 표정 설계"}
          disabled={!doc.data.baseAssetId}
          disabledReason={doc.data.cast.length > 1 ? "1단계에서 장면 기준 그림을 먼저 올리세요." : "1단계에서 기본 그림을 먼저 올리세요."}
          instruction={s.instruction}
          description={`${
            s.scene.trim()
              ? `시나리오의 장면을 연기하는 표정 ${s.count}개를 순서대로 설계합니다${s.refAssetId ? " (참고 시트에서 장면에 맞는 칸을 골라 분석)" : ""}.`
              : s.refAssetId
                ? "참고 시트의 각 칸을 따로 관찰해 감정과 방향을 제안합니다."
                : doc.data.cast.length > 1
                  ? "장면의 표정(비트)마다 중심 인물과 모든 인물의 연기를 함께 제안합니다."
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
        <GuidePanel />
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
