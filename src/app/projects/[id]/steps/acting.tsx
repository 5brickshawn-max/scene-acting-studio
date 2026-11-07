"use client";
import { useState } from "react";
import { castLabel, distributionPlans, round3, sameTiming, timelineIssues, type ProjectData, type StepIndex } from "@/lib/domain/project";
import { estimateSpeechSeconds } from "@/lib/domain/speech";
import { useEditor } from "../editor-context";
import { AiAction } from "../ui";
import { PendingProposal } from "../proposals";
import { StepFrame } from "./step-frame";

const COLORS = ["#f3dccb", "#dfe9d3", "#e6e0ef", "#f1e7cd", "#d6e6ea", "#f2d7dc", "#e3e3d0", "#dbe0f0"];

function MiniTimeline({ segments, duration, indexOf }: { segments: ProjectData["acting"]["segments"]; duration: number; indexOf: (id: string) => number }) {
  return (
    <div className="flex h-7 rounded-md overflow-hidden border border-line" aria-hidden>
      {segments.map((s) => {
        const i = indexOf(s.expressionId);
        return (
          <div key={s.expressionId} style={{ width: `${((s.end - s.start) / duration) * 100}%`, background: COLORS[i % COLORS.length] }}
            className="grid place-items-center text-[12px] font-semibold border-r border-white min-w-0 overflow-hidden">
            {i + 1}·{Math.round((s.end - s.start) * 10) / 10}
          </div>
        );
      })}
    </div>
  );
}

export function ActingStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc, canEdit } = useEditor();
  const { data } = doc;
  const { duration, segments } = data.acting;
  const indexOf = (id: string) => data.expressions.findIndex((e) => e.id === id);
  const setActing = (fn: (a: typeof data.acting) => typeof data.acting) => doc.edit(3, (d) => ({ ...d, acting: fn(d.acting) }));

  /** Changing a segment's end moves the next segment's start so the timeline stays contiguous. */
  function setEnd(i: number, end: number) {
    setActing((a) => {
      const segs = a.segments.map((s) => ({ ...s }));
      const max = (segs[i + 1]?.end ?? a.duration) - 0.1;
      segs[i].end = round3(Math.min(max, Math.max(segs[i].start + 0.1, end)));
      if (segs[i + 1]) segs[i + 1].start = segs[i].end;
      return { ...a, segments: segs };
    });
  }
  function move(i: number, dir: -1 | 1) {
    setActing((a) => {
      const j = i + dir;
      if (j < 0 || j >= a.segments.length) return a;
      const order = a.segments.map((s) => s.expressionId);
      [order[i], order[j]] = [order[j], order[i]];
      const lengths = a.segments.map((s) => s.end - s.start);
      [lengths[i], lengths[j]] = [lengths[j], lengths[i]];
      let t = 0;
      return {
        ...a,
        segments: order.map((id, k) => {
          const seg = { ...a.segments.find((s) => s.expressionId === id)!, start: round3(t), end: k === order.length - 1 ? a.duration : round3(t + lengths[k]) };
          t = seg.end;
          return seg;
        }),
      };
    });
  }

  const issues = timelineIssues(data);

  return (
    <StepFrame
      step={3}
      title="시간 분배를 정하세요"
      intro={`전체 ${duration}초(2단계에서 정함) 안에서 표정 순서와 길이를 나눕니다. 여러 분배 안을 눌러 비교해 보세요.`}
      onNavigate={onNavigate}
    >
      <section className="space-y-3" aria-labelledby="plans-title">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 id="plans-title" className="section-title">분배 안</h3>
          <span className="text-muted text-[14px]">전체 {duration}초 고정 · 현재 순서 기준 · 바꾸려면 2단계에서 길이를 조정하세요</span>
        </div>
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {distributionPlans(data).map((p) => {
            const current = sameTiming(p.segments, segments);
            return (
              <li key={p.key}>
                <button
                  type="button"
                  disabled={!canEdit || current}
                  onClick={() => setActing((a) => ({ ...a, segments: p.segments }))}
                  className={`w-full text-left rounded-xl border p-3 space-y-2 ${current ? "border-accent bg-[#fff1e8]" : "border-line bg-white hover:border-line-strong"}`}
                  aria-pressed={current}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.label}</span>
                    {current && <span className="pill pill-accent">적용됨</span>}
                  </div>
                  <MiniTimeline segments={p.segments} duration={duration} indexOf={indexOf} />
                  <div className="text-[13px] text-muted">{p.description}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <AiAction kind="plan_acting" step={3} label="AI로 분배 설계" description="표정 흐름과 대사를 보고 순서와 시간 분배를 제안합니다. 전체 길이는 바꾸지 않습니다." />
      <PendingProposal step={3} />

      <h3 className="section-title">세부 조정</h3>
      <div aria-label="타임라인" className="flex h-12 rounded-lg overflow-hidden border border-line">
        {segments.map((s) => {
          const i = indexOf(s.expressionId);
          const w = duration > 0 ? ((s.end - s.start) / duration) * 100 : 0;
          return (
            <div key={s.expressionId} style={{ width: `${Math.max(0, w)}%`, background: COLORS[i % COLORS.length] }}
              className="grid place-items-center text-[13px] font-semibold border-r border-white min-w-0 overflow-hidden" title={`${i + 1}번 ${s.start}–${s.end}초`}>
              {i + 1}
            </div>
          );
        })}
      </div>

      <ol className="space-y-3">
        {segments.map((s, i) => {
          const ei = indexOf(s.expressionId);
          const e = data.expressions[ei];
          const line = data.dialogue.lines.find((l) => l.expressionId === s.expressionId)?.line ?? "";
          const need = estimateSpeechSeconds(line);
          const len = s.end - s.start;
          return (
            <li key={s.expressionId} className="rounded-xl border border-line p-4 grid md:grid-cols-[1fr_auto] gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid place-items-center size-7 rounded-full text-[13px] font-bold" style={{ background: COLORS[ei % COLORS.length] }}>{ei + 1}</span>
                  <span className="font-semibold">
                    {e && data.cast.length > 1 ? `${castLabel(data, e.characterId)} · ` : ""}
                    {e?.emotion || "감정 미정"}
                  </span>
                  {line && <span className="text-muted">“{line}”</span>}
                </div>
                {line && need > len && <p className="notice notice-warn">대사에 약 {need}초가 필요한데 구간은 {round3(len)}초입니다.</p>}
                <div>
                  <label className="text-[13px] font-semibold text-muted block mb-1" htmlFor={`tr-${s.expressionId}`}>다음 표정으로 넘어가는 연기</label>
                  <input id={`tr-${s.expressionId}`} className="input" value={s.transition} disabled={!canEdit}
                    onChange={(ev) => setActing((a) => ({ ...a, segments: a.segments.map((x) => (x.expressionId === s.expressionId ? { ...x, transition: ev.target.value } : x)) }))}
                    placeholder="예: 잠깐 망설인 뒤 눈을 크게 뜬다" />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <div className="text-[13px] font-semibold text-muted mb-1">시작</div>
                  <div className="input w-24 bg-[#f4f5f1]">{s.start}초</div>
                </div>
                <div>
                  <label className="text-[13px] font-semibold text-muted block mb-1" htmlFor={`end-${s.expressionId}`}>끝</label>
                  <EndField id={`end-${s.expressionId}`} value={s.end} disabled={!canEdit || i === segments.length - 1} onCommit={(v) => setEnd(i, v)} />
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <button className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="앞으로">↑</button>
                    <button className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === segments.length - 1} aria-label="뒤로">↓</button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {issues.length > 0 && <p className="field-help">타임라인 문제는 아래 ‘승인 전 확인’에 표시됩니다.</p>}
    </StepFrame>
  );
}

/**
 * The end time of a segment. Typed freely and applied on blur / Enter: clamping on every key made the field
 * jump back (clearing it to type a new number snapped it to start + 0.1).
 */
function EndField(props: { id: string; value: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(props.value));
  const [focused, setFocused] = useState(false);
  return (
    <input
      id={props.id}
      type="number"
      step="0.1"
      className="input w-24"
      value={focused ? text : String(props.value)}
      disabled={props.disabled}
      onFocus={() => {
        setText(String(props.value));
        setFocused(true);
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const v = Number(text);
        if (text.trim() && Number.isFinite(v)) props.onCommit(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
