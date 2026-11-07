"use client";
import { useState } from "react";
import {
  addCastMember,
  castLabel,
  castLetter,
  MAX_CAST,
  POSITION_LABEL,
  POSITIONS,
  removeCastMember,
  type CastMember,
  type StepIndex,
} from "@/lib/domain/project";
import { useEditor } from "../editor-context";
import { AiAction, Field, ImageSlot, Seg } from "../ui";
import { PendingProposal } from "../proposals";
import { StepFrame } from "./step-frame";

/** Step 1: the cast (1–4 characters in one shot) and the scene's shared art style. */
export function CharacterStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc, canEdit } = useEditor();
  const d = doc.data;
  const multi = d.cast.length > 1;
  const [active, setActive] = useState(d.cast[0].id);
  const current = d.cast.find((c) => c.id === active) ?? d.cast[0];

  const setMember = (id: string, patch: Partial<CastMember>) =>
    doc.edit(0, (x) => ({ ...x, cast: x.cast.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  return (
    <StepFrame
      step={0}
      title="장면과 출연진을 정하세요"
      intro="장면에 나오는 인물(1~4명)마다 기본 그림을 올리고 AI 분석으로 초안을 받은 뒤, 직접 다듬어 승인합니다. 그림체는 장면 전체가 함께 씁니다."
      onNavigate={onNavigate}
    >
      <div className="space-y-6">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="장면 이름" value={d.title} onChange={(v) => doc.edit(0, (x) => ({ ...x, title: v }))} />
          <div>
            <div className="field-label">출연진</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill">{d.cast.length}명</span>
              {canEdit && d.cast.length < MAX_CAST && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    const next = addCastMember(doc.data);
                    doc.edit(0, () => next);
                    setActive(next.cast[next.cast.length - 1].id);
                  }}
                >
                  + 인물 추가
                </button>
              )}
            </div>
            <p className="field-help">
              한 명이면 인물 연기 쇼트, 2명 이상이면 모든 인물이 한 화면에 나오는 장면이 됩니다(최대 {MAX_CAST}명).
            </p>
          </div>
        </div>

        {multi && (
          <div className="space-y-2">
            <div className="field-label">화면 배치 (보는 사람 기준, 쇼트 내내 유지)</div>
            <div className="flex rounded-lg border border-line bg-white p-3 gap-2" aria-label="화면 배치 미리보기">
              {POSITIONS.map((p) => {
                const here = d.cast.filter((c) => c.position === p);
                return (
                  <div key={p} className="flex-1 min-w-0 text-center">
                    <div className="text-[12px] text-muted">{POSITION_LABEL[p]}</div>
                    {here.map((c) => (
                      <div key={c.id} className="mt-1 truncate rounded-md bg-[#fffaf5] border border-[#f3c9ae] px-1 py-1 text-[13px] font-semibold">
                        {castLabel(d, c.id)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div role="tablist" aria-label="출연진" className="flex flex-wrap gap-2">
          {d.cast.map((c, i) => (
            <button
              key={c.id}
              role="tab"
              type="button"
              aria-selected={c.id === current.id}
              className={`btn btn-sm ${c.id === current.id ? "btn-dark" : ""}`}
              onClick={() => setActive(c.id)}
            >
              {castLetter(i)} · {c.name.trim() || "이름 없음"}
            </button>
          ))}
        </div>

        <PendingProposal step={0} />

        <CastCard
          key={current.id}
          member={current}
          index={d.cast.findIndex((c) => c.id === current.id)}
          multi={multi}
          onChange={(patch) => setMember(current.id, patch)}
          onRemove={
            canEdit && multi
              ? () => {
                  const rest = d.cast.filter((c) => c.id !== current.id);
                  if (!window.confirm(`${castLabel(d, current.id)}을(를) 출연진에서 뺄까요? 이 인물이 맡은 표정은 ${castLabel(d, rest[0].id)}에게 넘어갑니다.`)) return;
                  doc.edit(0, (x) => removeCastMember(x, current.id));
                  setActive(rest[0].id);
                }
              : undefined
          }
        />

        <Field
          label="그림체와 색감 (장면 공통)"
          multiline
          value={d.style}
          onChange={(v) => doc.edit(0, (x) => ({ ...x, style: v }))}
          help={multi ? "모든 인물이 같은 그림체로 그려집니다. 인물마다 그림체가 다르면 영상에서 한 장면처럼 보이지 않습니다." : undefined}
        />
      </div>
    </StepFrame>
  );
}

function CastCard(props: {
  member: CastMember;
  index: number;
  multi: boolean;
  onChange: (patch: Partial<CastMember>) => void;
  onRemove?: () => void;
}) {
  const { canEdit } = useEditor();
  const c = props.member;
  const set = props.onChange;
  const letter = castLetter(props.index);

  return (
    <section className="rounded-xl border border-line p-4 sm:p-5 space-y-5" aria-label={`${letter} 캐릭터`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="section-title">{props.multi ? `${letter} 캐릭터` : "캐릭터"}</h3>
        {props.onRemove && (
          <button type="button" className="btn btn-sm btn-ghost ml-auto" onClick={props.onRemove}>
            출연진에서 빼기
          </button>
        )}
      </div>
      <div className="grid lg:grid-cols-[minmax(0,360px)_1fr] gap-8">
        <div className="space-y-6">
          <ImageSlot
            label="기본 그림"
            kind="base"
            assetId={c.baseAssetId}
            tall
            emptyText="이 인물의 기준이 되는 그림을 올리세요. 이후 모든 단계가 이 그림을 기준으로 합니다."
            onChange={(id) => set({ baseAssetId: id })}
          />
          <div className="space-y-2">
            <div className="field-label">추가 디자인 참고 (선택)</div>
            {c.designRefAssetIds.map((id, i) => (
              <ImageSlot
                key={id}
                label={`디자인 참고 ${i + 1}`}
                kind="design_ref"
                assetId={id}
                removable
                emptyText=""
                onChange={(nid) =>
                  set({
                    designRefAssetIds: nid ? c.designRefAssetIds.map((x) => (x === id ? nid : x)) : c.designRefAssetIds.filter((x) => x !== id),
                  })
                }
              />
            ))}
            {c.designRefAssetIds.length < (props.multi ? 1 : 3) && (
              <ImageSlot
                label={c.designRefAssetIds.length ? "참고 그림 더 추가" : "참고 그림"}
                kind="design_ref"
                assetId={null}
                emptyText={
                  props.multi
                    ? "여러 인물 장면은 생성 모델이 받는 그림 수에 한도가 있어 인물당 한 장까지 받습니다."
                    : "옆모습, 뒷모습, 소품 같은 추가 디자인을 올리면 분석이 더 정확해집니다."
                }
                onChange={(id) => id && set({ designRefAssetIds: [...c.designRefAssetIds, id] })}
              />
            )}
          </div>
        </div>

        <div className="space-y-6">
          <AiAction
            kind="analyze_character"
            step={0}
            characterId={c.id}
            label="AI로 기본 그림 분석"
            disabled={!c.baseAssetId}
            disabledReason="먼저 기본 그림을 올리세요."
            description={props.multi ? "이 인물의 설명 초안과 확인 질문을 제안합니다." : "네 가지 설명 초안과 확인 질문을 제안합니다."}
          />

          <Field label="이름" value={c.name} onChange={(v) => set({ name: v })} help={props.multi ? "프롬프트에서 인물을 구분하는 이름입니다. 다른 인물과 겹치지 않게 쓰세요." : undefined} />
          {props.multi && (
            <Seg label="화면 위치" value={c.position} options={POSITIONS} labels={POSITION_LABEL} onChange={(v) => set({ position: v })} />
          )}
          <Field
            label="꼭 유지할 특징"
            multiline
            rows={5}
            value={c.locks}
            onChange={(v) => set({ locks: v })}
            help={
              props.multi
                ? "표정이 바뀌어도 절대 변하면 안 되는 것. 다른 인물과 구별되는 요소를 앞에 두고, 번호를 붙여 짧게 나열하세요."
                : "표정이 바뀌어도 절대 변하면 안 되는 것. 번호를 붙여 짧게 나열하세요."
            }
          />
          <Field label="외형과 얼굴 특징" multiline value={c.appearance} onChange={(v) => set({ appearance: v })} />
          <Field label="의상과 장신구" multiline value={c.outfit} onChange={(v) => set({ outfit: v })} />

          {c.questions.length > 0 && (
            <div className="space-y-3">
              <h3 className="section-title">AI 확인 질문</h3>
              <p className="field-help">답을 적어두면 다음 단계의 AI가 그대로 반영합니다.</p>
              {c.questions.map((q, i) => (
                <div key={i} className="rounded-lg border border-line p-3 space-y-2">
                  <div className="flex gap-2 items-start">
                    <p className="flex-1 font-medium">{q.question}</p>
                    {canEdit && (
                      <button className="btn btn-sm btn-ghost" onClick={() => set({ questions: c.questions.filter((_, j) => j !== i) })} aria-label="질문 삭제">
                        삭제
                      </button>
                    )}
                  </div>
                  <input
                    className="input"
                    placeholder="답변"
                    aria-label={`질문 ${i + 1} 답변`}
                    value={q.answer}
                    disabled={!canEdit}
                    onChange={(e) => set({ questions: c.questions.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) })}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
