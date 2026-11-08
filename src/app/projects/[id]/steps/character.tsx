"use client";
import { useState } from "react";
import {
  addCastMember,
  castLabel,
  castLetter,
  maxCastFor,
  MAX_DESIGN_REFS,
  POSITION_LABEL,
  POSITIONS,
  removeCastMember,
  SCENE_MODE_HELP,
  SCENE_MODE_LABEL,
  SCENE_MODES,
  type CastMember,
  type StepIndex,
} from "@/lib/domain/project";
import { useEditor } from "../editor-context";
import { AiAction, Field, ImageSlot, Seg } from "../ui";
import { PendingProposal } from "../proposals";
import { StepFrame } from "./step-frame";
import { SceneImageGenerator } from "./higgsfield-direct";

/** Step 1: the cast (1–4 characters in one shot) and the scene's shared art style. */
export function CharacterStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc, canEdit } = useEditor();
  const d = doc.data;
  const story = d.mode === "storyboard";
  // in storyboard mode positions change from panel to panel: no fixed blocking
  const multi = d.cast.length > 1 && !story;
  const group = d.cast.length > 1;
  const [active, setActive] = useState(d.cast[0].id);
  // the scene picture: drawn from the scenario (default when there is none yet) or uploaded.
  // A generated picture keeps the "generate" tab open when the step is opened again.
  const { assets } = useEditor();
  const baseIsGenerated = Boolean(d.baseAssetId && assets.get(d.baseAssetId)?.name.startsWith("첫 장면"));
  const [source, setSource] = useState<"generate" | "upload">(!d.baseAssetId || baseIsGenerated ? "generate" : "upload");
  const current = d.cast.find((c) => c.id === active) ?? d.cast[0];

  const max = maxCastFor(d.mode);
  const addMember = () => {
    const next = addCastMember(doc.data);
    doc.edit(0, () => next);
    setActive(next.cast[next.cast.length - 1].id);
  };
  const removeMember = (id: string) => {
    if (d.cast.length <= 1) return;
    const rest = d.cast.filter((c) => c.id !== id);
    if (!window.confirm(`${castLabel(d, id)}을(를) 빼까요? 이 인물이 중심인 표정·컷은 ${castLabel(d, rest[0].id)}에게 넘어갑니다.`)) return;
    doc.edit(0, (x) => removeCastMember(x, id));
    if (active === id) setActive(rest[0].id);
  };
  const setMember = (id: string, patch: Partial<CastMember>) =>
    doc.edit(0, (x) => ({ ...x, cast: x.cast.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  return (
    <StepFrame
      step={0}
      title="장면과 출연진을 정하세요"
      intro={
        story
          ? "씬 시놉시스·시나리오를 쓰고, 장면 기준 그림을 올리거나 시나리오로 첫 장면을 생성합니다. 이름이 있는 주요 인물과 군중을 정한 뒤, 2단계에서 콘티처럼 컷 단위로 장면을 만듭니다."
          : "씬 시놉시스·시나리오를 쓰고, 장면 기준 그림을 올리거나 시나리오로 첫 장면을 생성합니다. 모든 인물의 모습·크기·그림체가 이 그림 한 장에서 나옵니다."
      }
      onNavigate={onNavigate}
    >
      <div className="space-y-6">
        <div>
          <Seg
            label="통제 방식"
            value={d.mode}
            options={SCENE_MODES}
            labels={SCENE_MODE_LABEL}
            onChange={(v) => doc.edit(0, (x) => ({ ...x, mode: v, expressionSetup: { ...x.expressionSetup, framing: v === "storyboard" || x.cast.length > 1 ? "medium" : x.expressionSetup.framing } }))}
          />
          <p className="field-help">{SCENE_MODE_HELP[d.mode]} 바꿔도 지금까지 쓴 내용은 남습니다.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="장면 이름" value={d.title} onChange={(v) => doc.edit(0, (x) => ({ ...x, title: v }))} />
          <div>
            <div className="field-label">{story ? "주요 인물 (이름이 있는 인물)" : "출연진"}</div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="인물 수">
              <button
                type="button"
                className="btn btn-sm min-w-10"
                aria-label="마지막 인물 빼기"
                disabled={!canEdit || d.cast.length <= 1}
                onClick={() => removeMember(d.cast[d.cast.length - 1].id)}
              >
                −
              </button>
              <span className="pill min-w-14 justify-center" aria-live="polite">
                {d.cast.length}명
              </span>
              <button
                type="button"
                className="btn btn-sm min-w-10"
                aria-label="인물 추가"
                disabled={!canEdit || d.cast.length >= max}
                title={d.cast.length >= max ? `이 방식은 최대 ${max}명입니다` : undefined}
                onClick={addMember}
              >
                +
              </button>
              <span className="text-[13px] text-muted">최대 {max}명</span>
            </div>
            <p className="field-help">
              {story
                ? `대사를 하거나 이름으로 부를 인물만 등록합니다(최대 ${maxCastFor("storyboard")}명). 군중·배경 인물은 아래에 글로 적습니다.`
                : `한 명이면 인물 연기 쇼트, 2명 이상이면 모든 인물이 한 화면에 나오는 장면이 됩니다(최대 ${maxCastFor("cast")}명).`}
              {!story && d.cast.length > maxCastFor("cast") && (
                <span className="block notice notice-warn mt-2">
                  인물별 연기 방식은 최대 {maxCastFor("cast")}명입니다. 지금 {d.cast.length}명이라 승인할 수 없습니다. 아래 인물 이름 옆의 × 로 줄이거나, 스토리보드 방식으로 바꾸세요.
                  {canEdit && (
                    <button
                      type="button"
                      className="btn btn-sm ml-2 mt-1"
                      onClick={() => doc.edit(0, (x) => ({ ...x, mode: "storyboard", expressionSetup: { ...x.expressionSetup, framing: "medium" } }))}
                    >
                      스토리보드 방식으로 바꾸기
                    </button>
                  )}
                </span>
              )}
            </p>
          </div>
        </div>

        <section className="space-y-3" aria-labelledby="synopsis-title">
          <h3 id="synopsis-title" className="section-title">① 씬 시놉시스·시나리오 (기준)</h3>
          <Field
            label="씬 시놉시스·시나리오 (기초 대사 포함)"
            multiline
            rows={7}
            value={d.expressionSetup.scene}
            onChange={(v) => doc.edit(0, (x) => ({ ...x, expressionSetup: { ...x.expressionSetup, scene: v } }))}
            placeholder={
              "예: 해 질 녘 시장 광장. 횃불을 든 군중이 술렁이는 가운데 칼리엘라가 걸어 나오고, 브람이 칼자루를 쥔 채 앞을 막아선다.\n" +
              "칼리엘라 : “Step aside.”\n" +
              "브람 : “Not one step further!”"
            }
            help="이 장면의 기준입니다. 대사 앞에 말하는 인물 이름을 붙이세요(‘이름 : …’). 2단계 설계와 3단계 대사가 이 글을 따릅니다."
          />
          <AiAction
            kind="compose_scene"
            step={0}
            label="AI로 씬 구성"
            disabled={!d.expressionSetup.scene.trim() && !d.baseAssetId}
            disabledReason="먼저 씬 시놉시스·시나리오를 쓰세요."
            description={`시나리오와 인물 자료(있으면 그림까지)로 주요 인물(최대 ${maxCastFor(d.mode)}명)·외형·의상·그림체${story ? "·군중" : ""}·첫 장면을 구성합니다.`}
          />
          <PendingProposal step={0} kinds={["compose_scene"]} />
        </section>

        <section className="space-y-3" aria-labelledby="base-title">
          <h3 id="base-title" className="section-title">② 장면 기준 그림</h3>
          <Seg
            label="기준 그림을 어떻게 정할까요"
            value={source}
            options={["generate", "upload"] as const}
            labels={{ generate: "시나리오로 첫 장면 생성", upload: "그림 올리기" }}
            onChange={setSource}
          />
          <div className="grid lg:grid-cols-[minmax(0,420px)_1fr] gap-6">
            <div className="space-y-3">
              <ImageSlot
                label={story ? "장면 기준 그림 (주요 인물·분위기·세계)" : multi ? "장면 기준 그림 (출연진 전원이 함께)" : "기본 그림"}
                kind="base"
                assetId={d.baseAssetId}
                tall={!multi && !story}
                emptyText={
                  source === "generate"
                    ? "오른쪽에서 첫 장면을 생성해 고르면 여기에 들어갑니다."
                    : story
                      ? "주요 인물과 장면의 분위기·세계가 담긴 그림 한 장을 올리세요. 인물의 모습과 그림체가 이 그림에서 나옵니다."
                      : multi
                        ? "출연진이 모두 함께 그려진 그림 한 장을 올리세요. 인물의 모습·키 차이·그림체가 모두 이 그림에서 나옵니다. 아래 화면 위치를 이 그림 속 위치와 맞추세요."
                        : "캐릭터의 기준이 되는 그림을 올리세요. 이후 모든 단계가 이 그림을 기준으로 합니다."
                }
                onChange={(id) => doc.edit(0, (x) => ({ ...x, baseAssetId: id }))}
              />
              <div className="space-y-2">
                <div className="field-label">추가 참고 그림 (선택)</div>
                {d.designRefAssetIds.map((id, i) => (
                  <ImageSlot
                    key={id}
                    label={`추가 참고 ${i + 1}`}
                    kind="design_ref"
                    assetId={id}
                    removable
                    emptyText=""
                    onChange={(nid) =>
                      doc.edit(0, (x) => ({
                        ...x,
                        designRefAssetIds: nid ? x.designRefAssetIds.map((y) => (y === id ? nid : y)) : x.designRefAssetIds.filter((y) => y !== id),
                      }))
                    }
                  />
                ))}
                {d.designRefAssetIds.length < MAX_DESIGN_REFS && (
                  <ImageSlot
                    label={d.designRefAssetIds.length ? `참고 그림 더 추가 (${d.designRefAssetIds.length}/${MAX_DESIGN_REFS})` : `참고 그림 (최대 ${MAX_DESIGN_REFS}장)`}
                    kind="design_ref"
                    assetId={null}
                    emptyText="배경·소품·분위기 참고처럼 장면 전체에 쓸 그림이 있으면 올리세요. 인물별 자료는 아래 인물 카드에 올립니다."
                    onChange={(id) => id && doc.edit(0, (x) => ({ ...x, designRefAssetIds: [...x.designRefAssetIds, id] }))}
                  />
                )}
              </div>
            </div>
            <div className="space-y-4">
              {source === "generate" ? (
                <>
                  <Field
                    label="첫 장면 묘사"
                    multiline
                    rows={4}
                    value={d.opening}
                    onChange={(v) => doc.edit(0, (x) => ({ ...x, opening: v }))}
                    placeholder="예: 해 질 녘 시장 광장, 횃불을 든 군중 사이로 칼리엘라가 화면 왼쪽에서 걸어 나오고, 오른쪽의 브람이 칼자루를 쥐고 그녀를 노려본다."
                    help="‘AI로 씬 구성’이 채워 줍니다. 모든 주요 인물의 얼굴이 보이는 순간이 좋습니다(이후 모든 그림의 인물 기준이 됨). 비우면 시나리오 앞부분을 씁니다."
                  />
                  <SceneImageGenerator onUse={(id) => doc.edit(0, (x) => ({ ...x, baseAssetId: id }))} />
                </>
              ) : (
                <>
                  <AiAction
                    kind="analyze_character"
                    step={0}
                    label={group || story ? "AI로 장면 기준 그림 분석" : "AI로 기본 그림 분석"}
                    disabled={!d.baseAssetId}
                    disabledReason={group || story ? "먼저 장면 기준 그림을 올리세요." : "먼저 기본 그림을 올리세요."}
                    description={
                      group
                        ? `그림 속 ${d.cast.length}명을 이름·위치로 찾아 인물마다 설명 초안과 확인 질문을 제안합니다. 먼저 아래에 이름과 위치를 적어 두세요.`
                        : "인물 설명(특징·외형·의상)과 그림체 초안, 확인 질문을 제안합니다."
                    }
                  />
                  <PendingProposal step={0} except={["compose_scene"]} />
                </>
              )}
            </div>
          </div>
        </section>

        {multi && (
          <div className="space-y-2">
            <div className="field-label">화면 배치 (보는 사람 기준, 장면 기준 그림 속 위치와 같게, 쇼트 내내 유지)</div>
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

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="출연진" className="flex flex-wrap gap-2">
            {d.cast.map((c, i) => (
              <span key={c.id} className="inline-flex items-center">
                <button
                  role="tab"
                  type="button"
                  aria-selected={c.id === current.id}
                  className={`btn btn-sm ${c.id === current.id ? "btn-dark" : ""} ${canEdit && group ? "rounded-r-none" : ""}`}
                  onClick={() => setActive(c.id)}
                >
                  {castLetter(i)} · {c.name.trim() || "이름 없음"}
                </button>
                {canEdit && group && (
                  <button
                    type="button"
                    className="btn btn-sm rounded-l-none border-l-0 px-2"
                    aria-label={`${castLabel(d, c.id)} 빼기`}
                    title="이 인물 빼기"
                    onClick={() => removeMember(c.id)}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {canEdit && d.cast.length < max && (
            <button type="button" className="btn btn-sm" onClick={addMember}>
              + 인물 추가
            </button>
          )}
        </div>

        <CastCard
          key={current.id}
          member={current}
          index={d.cast.findIndex((c) => c.id === current.id)}
          multi={group}
          positions={group}
          story={story}
          onChange={(patch) => setMember(current.id, patch)}
          onRemove={canEdit && group ? () => removeMember(current.id) : undefined}
        />

        {story && (
          <Field
            label="군중·배경 인물 (선택)"
            multiline
            rows={3}
            value={d.extras}
            onChange={(v) => doc.edit(0, (x) => ({ ...x, extras: v }))}
            placeholder="예: 시장 광장을 가득 메운 상인과 구경꾼 수십 명. 갈색·베이지 계열의 소박한 옷, 몇몇은 횃불을 든다."
            help="이름 없는 인물들을 한 번만 적어 두면 모든 컷과 영상에 같은 모습으로 들어갑니다."
          />
        )}
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
  /** fixed screen positions (character-by-character mode with several characters) */
  positions: boolean;
  story: boolean;
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
      <div className="space-y-6">
          <Field label="이름" value={c.name} onChange={(v) => set({ name: v })} help={props.multi ? "프롬프트에서 인물을 구분하는 이름입니다. 다른 인물과 겹치지 않게 쓰세요." : undefined} />
          <div className="max-w-xs">
            <ImageSlot
              label="이 인물 참고 자료 (선택)"
              kind="design_ref"
              assetId={c.refAssetId}
              removable
              emptyText="캐릭터 시트·설정화가 있으면 올리세요. ‘AI로 씬 구성’과 첫 장면 생성에 쓰입니다."
              onChange={(id) => set({ refAssetId: id })}
            />
          </div>
          {props.positions && (
            <Seg label={props.story ? "장면 기준 그림 속 위치 (누가 누구인지 찾는 데 씀)" : "화면 위치"} value={c.position} options={POSITIONS} labels={POSITION_LABEL} onChange={(v) => set({ position: v })} />
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
    </section>
  );
}
