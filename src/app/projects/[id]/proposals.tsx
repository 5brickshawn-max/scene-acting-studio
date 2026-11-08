"use client";
import { useState } from "react";
import type { ActingOutT, CharacterOutT, DialogueOutT, ExpressionsOutT, SceneComposeOutT, SheetCheckOutT, StoryboardOutT } from "@/lib/ai/schemas";
import { JOB_LABEL, type JobKind } from "@/lib/ai/schemas";
import { composeStructure, applyActing, applyCharacter, applyComposition, applyDialogue, applyExpressions, applyStoryboard, type CharacterField, type ComposeField } from "@/lib/domain/apply";
import { castLabel, FACING_LABEL, GAZE_LABEL, INTENSITY_LABEL, MAX_SHOTS, maxCastFor, type ProjectData } from "@/lib/domain/project";
import type { JobView } from "@/lib/types";
import { useEditor } from "./editor-context";

/** The newest AI result for this step that nobody has applied or dismissed yet (optionally of some kinds only). */
export function usePendingProposal(step: number, show: (kind: string) => boolean = () => true): { job: JobView; proposal: unknown } | null {
  const { jobs, dismissed } = useEditor();
  for (const j of jobs.jobs) {
    if (j.step !== step || j.status !== "done" || j.applied_version !== null || dismissed.has(j.id)) continue;
    if (!show(j.kind)) continue;
    if (j.kind.startsWith("hf_")) continue; // Higgsfield results have their own card
    if (j.kind === "consult") {
      const p = (j.output as { proposal?: unknown } | null)?.proposal;
      if (p) return { job: j, proposal: p };
      continue;
    }
    return { job: j, proposal: j.output };
  }
  return null;
}

function ProposalShell(props: {
  job: JobView;
  title: string;
  summary?: string;
  children: React.ReactNode;
  onApply?: () => Promise<void>;
  applyLabel?: string;
  applyDisabled?: boolean;
}) {
  const { doc, dismiss, canEdit, jobs } = useEditor();
  const [busy, setBusy] = useState(false);
  const stale = props.job.based_on_version < doc.version;
  return (
    <section className="rounded-xl border-2 border-[#f3c9ae] bg-[#fffaf5] p-5 space-y-4" aria-label="AI 제안">
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill pill-accent">AI 제안 · 검토 대기</span>
        <h3 className="section-title">{props.title}</h3>
        <span className="text-[13px] text-muted">
          {JOB_LABEL[props.job.kind as JobKind]} · v{props.job.based_on_version} 기준
        </span>
      </div>
      {props.summary && <p>{props.summary}</p>}
      {stale && (
        <p className="notice notice-warn">
          이 제안은 v{props.job.based_on_version} 기준이고, 그 뒤에 내용이 바뀌었습니다(현재 v{doc.version}). 적용 전에 확인하세요.
        </p>
      )}
      {props.children}
      <div className="flex flex-wrap gap-2">
        {props.onApply && canEdit && (
          <button
            className="btn btn-primary"
            disabled={busy || props.applyDisabled}
            onClick={async () => {
              setBusy(true);
              await props.onApply!();
              setBusy(false);
            }}
          >
            {props.applyLabel ?? "선택한 내용 적용"}
          </button>
        )}
        <button
          className="btn"
          onClick={() => {
            dismiss(props.job.id);
            // applied_version 0 = reviewed and closed without applying (persists across reloads)
            if (canEdit) void jobs.markApplied(props.job.id, 0);
          }}
        >
          {props.onApply ? "적용하지 않고 닫기" : "닫기"}
        </button>
      </div>
      {props.onApply && <p className="field-help">적용하면 새 버전으로 저장됩니다. 단계 승인은 따로 진행합니다.</p>}
    </section>
  );
}

function useApply(job: JobView) {
  const { doc, jobs } = useEditor();
  return async (next: ProjectData, note: string) => {
    const v = await doc.commit(next, "ai_apply", note);
    if (v) await jobs.markApplied(job.id, v);
  };
}

/* ───────────── Step 1: character ───────────── */

const CHAR_FIELDS: { key: Exclude<CharacterField, "questions">; label: string }[] = [
  { key: "locks", label: "꼭 유지할 특징" },
  { key: "appearance", label: "외형과 얼굴" },
  { key: "outfit", label: "의상과 장신구" },
  { key: "style", label: "그림체와 색감 (장면 공통)" },
];

export function CharacterProposal({ job, out }: { job: JobView; out: CharacterOutT }) {
  const { doc } = useEditor();
  const apply = useApply(job);
  const d = doc.data;
  const multi = d.cast.length > 1;
  const [picked, setPicked] = useState<Set<CharacterField>>(
    new Set<CharacterField>(["locks", "appearance", "outfit", "style", "questions"]),
  );
  const toggle = (k: CharacterField) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const perCharacter = CHAR_FIELDS.filter((f) => f.key !== "style") as { key: "locks" | "appearance" | "outfit"; label: string }[];
  return (
    <ProposalShell
      job={job}
      title={multi ? `출연진 ${d.cast.length}명 설명` : "캐릭터 설명"}
      summary={out.summary}
      applyDisabled={picked.size === 0}
      onApply={() => apply(applyCharacter(doc.data, out, [...picked]), "AI 캐릭터 설명 적용")}
    >
      <div className="space-y-3">
        {perCharacter.map((f) => (
          <label key={f.key} className="flex gap-3 items-start rounded-lg bg-white border border-line p-3">
            <input type="checkbox" className="mt-1 size-5" checked={picked.has(f.key)} onChange={() => toggle(f.key)} />
            <span className="flex-1 space-y-2">
              <span className="font-semibold">{f.label}</span>
              {d.cast.map((c, i) => {
                const o = out.characters.find((x) => x.character === i + 1);
                if (!o) return null;
                return (
                  <span key={c.id} className="block">
                    {multi && <span className="block text-[13px] font-semibold">{castLabel(d, c.id)}</span>}
                    <span className="block whitespace-pre-wrap">{o[f.key]}</span>
                    {c[f.key] && c[f.key] !== o[f.key] && <span className="block text-[13px] text-muted mt-1">현재: {c[f.key]}</span>}
                  </span>
                );
              })}
            </span>
          </label>
        ))}
        <label className="flex gap-3 items-start rounded-lg bg-white border border-line p-3">
          <input type="checkbox" className="mt-1 size-5" checked={picked.has("style")} onChange={() => toggle("style")} />
          <span className="flex-1">
            <span className="font-semibold">그림체와 색감 (장면 공통)</span>
            <span className="block whitespace-pre-wrap">{out.style}</span>
            {d.style && d.style !== out.style && <span className="block text-[13px] text-muted mt-1">현재: {d.style}</span>}
          </span>
        </label>
        {out.characters.length < d.cast.length && (
          <p className="notice notice-warn">AI가 출연진 {d.cast.length}명 중 {out.characters.length}명만 찾았습니다. 이름·화면 위치가 그림과 맞는지 확인하세요.</p>
        )}
        {out.questions.length > 0 && (
          <label className="flex gap-3 items-start rounded-lg bg-white border border-line p-3">
            <input type="checkbox" className="mt-1 size-5" checked={picked.has("questions")} onChange={() => toggle("questions")} />
            <span>
              <span className="font-semibold">확인 질문 {out.questions.length}개 추가</span>
              <ul className="list-disc pl-5">
                {out.questions.map((q) => <li key={q}>{q}</li>)}
              </ul>
            </span>
          </label>
        )}
      </div>
    </ProposalShell>
  );
}

/** One pickable part of a composition (outside the proposal component: an inner component would remount on every render and drop focus). */
function ComposeRow({ k, title, children, picked, toggle }: { k: ComposeField; title: string; children: React.ReactNode; picked: Set<ComposeField>; toggle: (k: ComposeField) => void }) {
  return (
    <label className="flex gap-3 items-start rounded-lg bg-white border border-line p-3">
      <input type="checkbox" className="mt-1 size-5" checked={picked.has(k)} onChange={() => toggle(k)} />
      <span className="flex-1 space-y-1">
        <span className="font-semibold block">{title}</span>
        {children}
      </span>
    </label>
  );
}

/** 씬 구성: the named characters, style, crowd and opening the AI composed from the scenario. */
export function ComposeProposal({ job, out }: { job: JobView; out: SceneComposeOutT }) {
  const { doc } = useEditor();
  const apply = useApply(job);
  const d = doc.data;
  const story = d.mode === "storyboard";
  const max = maxCastFor(d.mode);
  const [picked, setPicked] = useState<Set<ComposeField>>(new Set<ComposeField>(["cast", "style", "extras", "opening", "questions", "structure"]));
  const st = composeStructure(d, out);
  const toggle = (k: ComposeField) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <ProposalShell
      job={job}
      title="씬 구성"
      summary={out.summary}
      applyDisabled={picked.size === 0}
      onApply={() => apply(applyComposition(doc.data, out, [...picked]), "AI 씬 구성 적용")}
    >
      <div className="space-y-3">
        <ComposeRow picked={picked} toggle={toggle} k="cast" title={`주요 인물 ${Math.min(out.characters.length, max)}명 (지금 ${d.cast.length}명을 이 목록으로 바꿈)`}>
          {out.characters.length > max && (
            <span className="block notice notice-warn">이 방식은 최대 {max}명이라 앞의 {max}명만 들어갑니다.{story ? "" : " 더 많으면 스토리보드 방식을 쓰세요."}</span>
          )}
          <ol className="space-y-2">
            {out.characters.slice(0, max).map((c, i) => (
              <li key={i} className="text-[14px]">
                <span className="font-semibold">{c.name}</span>
                <span className="block whitespace-pre-wrap">특징: {c.locks}</span>
                <span className="block">외형: {c.appearance}</span>
                <span className="block">의상: {c.outfit}</span>
                {c.voice && <span className="block text-muted">목소리: {c.voice}</span>}
              </li>
            ))}
          </ol>
        </ComposeRow>
        <ComposeRow picked={picked} toggle={toggle} k="style" title="그림체 (장면 공통)">
          <span className="block whitespace-pre-wrap">{out.style}</span>
        </ComposeRow>
        {story && out.extras.trim() && (
          <ComposeRow picked={picked} toggle={toggle} k="extras" title="군중·배경 인물">
            <span className="block whitespace-pre-wrap">{out.extras}</span>
          </ComposeRow>
        )}
        {!st.tooFew && (
          <ComposeRow
            picked={picked}
            toggle={toggle}
            k="structure"
            title={
              st.story
                ? `쇼트 구성 · 쇼트 ${st.shots}개${st.mergedShots ? ` (제안 ${st.shots + st.mergedShots}개 → 최대 ${MAX_SHOTS}개로 합침)` : ""} · 패널 ${st.panels.length}개 · ${st.duration}초`
                : `표정 비트 ${st.panels.length}개 · ${st.duration}초 (컷 없는 한 쇼트)`
            }
          >
            <span className="block text-[13px] text-muted">
              적용하면 {st.story ? "컷 수·컷 제목·연결(✂/→)" : "표정 수"}과 영상 길이·시간 배분이 이 구성으로 바뀝니다. 그다음 2단계의 ‘AI로 {st.story ? "콘티" : "표정"} 설계’가 내용을 채웁니다.
            </span>
            {st.story ? (
              <ol className="space-y-1 text-[14px]">
                {out.shots.map((s, k) => (
                  <li key={k}>
                    <span className="font-semibold">
                      {k > 0 ? "✂ " : ""}쇼트 {k + 1} · {s.seconds}초 · 패널 {s.panels.length}개
                    </span>{" "}
                    {s.title}
                    <span className="block text-muted">{s.panels.map((p, i) => `${i > 0 ? "→ " : ""}${p}`).join("  ")}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="list-decimal pl-5 text-[14px]">
                {st.panels.map((p, i) => (
                  <li key={i}>{p.title}</li>
                ))}
              </ol>
            )}
            {st.clipped && <span className="block notice notice-warn">패널이 {st.total}개라 앞의 12개만 들어갑니다(한 장면 최대 12개). 장면을 둘로 나누는 것도 방법입니다.</span>}
            {st.duration > 30 && <span className="block notice notice-warn">{st.duration}초는 영상 모델 한도(Kling·Seedance 30초, Gemini Omni·MiniMax 15초)를 넘습니다. 생성할 때 모델 한도로 잘립니다.</span>}
          </ComposeRow>
        )}
        <ComposeRow picked={picked} toggle={toggle} k="opening" title="첫 장면 묘사 (장면 기준 그림 생성에 씀)">
          <span className="block whitespace-pre-wrap">{out.opening}</span>
        </ComposeRow>
        {out.questions.length > 0 && (
          <ComposeRow picked={picked} toggle={toggle} k="questions" title={`확인 질문 ${out.questions.length}개 추가`}>
            <ul className="list-disc pl-5">
              {out.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </ComposeRow>
        )}
      </div>
    </ProposalShell>
  );
}

/* ───────────── Step 2: expressions ───────────── */

export function ExpressionsProposal({ job, out }: { job: JobView; out: ExpressionsOutT }) {
  const { doc } = useEditor();
  const apply = useApply(job);
  const count = doc.data.expressionSetup.count;
  const [picked, setPicked] = useState<Set<number>>(new Set(out.expressions.map((_, i) => i).filter((i) => i < count)));
  return (
    <ProposalShell
      job={job}
      title={`표정 ${out.expressions.length}개 설계`}
      summary={out.summary}
      applyDisabled={picked.size === 0}
      onApply={() => apply(applyExpressions(doc.data, out, [...picked]), "AI 표정 설계 적용")}
    >
      {out.expressions.length !== count && (
        <p className="notice notice-warn">설정한 표정 개수는 {count}개인데 AI가 {out.expressions.length}개를 제안했습니다. 앞에서부터 {count}개까지만 적용됩니다.</p>
      )}
      {out.styleWarning && <p className="notice notice-warn">그림체 경고: {out.styleWarning}</p>}
      <p className="notice notice-info">적용해도 방향은 “AI 추정” 상태로 들어갑니다. 각 표정 카드에서 방향을 직접 확인해야 승인할 수 있습니다.</p>
      <ul className="grid sm:grid-cols-2 gap-3">
        {out.expressions.map((e, i) => (
          <li key={i}>
            <label className={`flex gap-3 items-start rounded-lg bg-white border border-line p-3 ${i >= count ? "opacity-50" : ""}`}>
              <input
                type="checkbox"
                className="mt-1 size-5"
                disabled={i >= count}
                checked={picked.has(i)}
                onChange={() =>
                  setPicked((s) => {
                    const n = new Set(s);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    return n;
                  })
                }
              />
              <span className="text-[14px] space-y-1">
                <span className="block font-semibold">
                  {i + 1}. {doc.data.cast.length > 1 && doc.data.cast[e.character - 1] ? `${castLabel(doc.data, doc.data.cast[e.character - 1].id)} · ` : ""}
                  {e.emotion} · {INTENSITY_LABEL[e.intensity]}{e.panel ? ` (참고 ${e.panel}번 칸)` : ""}
                </span>
                <span className="block">눈썹 {e.brows} / 눈 {e.eyes} / 입 {e.mouth}</span>
                {e.gesture && <span className="block">팔·손 {e.gesture}</span>}
                <span className="block">얼굴 <strong>{FACING_LABEL[e.facing]}</strong> · 시선 {GAZE_LABEL[e.gaze]} · 몸 {FACING_LABEL[e.body]}</span>
                {doc.data.cast.length > 1 &&
                  (e.reactions ?? []).map((r) => {
                    const c = doc.data.cast[r.character - 1];
                    return (
                      <span key={r.character} className="block">
                        같은 순간 {c ? castLabel(doc.data, c.id) : `인물 ${r.character}`}: {r.emotion} · {INTENSITY_LABEL[r.intensity]} · 얼굴 {FACING_LABEL[r.facing]} · 시선 {GAZE_LABEL[r.gaze]}
                        {r.gesture ? ` · ${r.gesture}` : ""}
                      </span>
                    );
                  })}
                <span className="block text-[13px] text-muted">근거: {e.directionEvidence}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </ProposalShell>
  );
}

export function StoryboardProposal({ job, out }: { job: JobView; out: StoryboardOutT }) {
  const { doc } = useEditor();
  const apply = useApply(job);
  const count = doc.data.expressionSetup.count;
  const [picked, setPicked] = useState<Set<number>>(new Set(out.panels.map((_, i) => i).filter((i) => i < count)));
  return (
    <ProposalShell
      job={job}
      title={`콘티 ${out.panels.length}컷`}
      summary={out.summary}
      applyDisabled={picked.size === 0}
      onApply={() => apply(applyStoryboard(doc.data, out, [...picked]), "AI 콘티 적용")}
    >
      {out.panels.length !== count && (
        <p className="notice notice-warn">설정한 컷 수는 {count}개인데 AI가 {out.panels.length}개를 제안했습니다. 앞에서부터 {count}개까지만 적용됩니다.</p>
      )}
      <ol className="grid sm:grid-cols-2 gap-3">
        {out.panels.map((p, i) => {
          const speaker = doc.data.cast[p.speaker - 1];
          return (
            <li key={i}>
              <label className={`flex gap-3 items-start rounded-lg bg-white border border-line p-3 ${i >= count ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  className="mt-1 size-5"
                  disabled={i >= count}
                  checked={picked.has(i)}
                  onChange={() =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                />
                <span className="text-[14px] space-y-1">
                  <span className="block font-semibold">{i + 1}. {p.title}</span>
                  <span className="block">{p.action}</span>
                  <span className="block text-muted">
                    {i > 0 ? (p.link === "cut" ? "✂ 컷 분할 · " : "→ 이어짐 · ") : ""}카메라: {p.camera}
                  </span>
                  {speaker && <span className="block text-muted">말하는 인물: {castLabel(doc.data, speaker.id)}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ol>
    </ProposalShell>
  );
}

export function SheetCheckResult({ job, out }: { job: JobView; out: SheetCheckOutT }) {
  return (
    <ProposalShell job={job} title="표정 시트 검사 결과" summary={out.summary}>
      {!out.panelCountMatches && <p className="notice notice-error">칸 수가 표정 개수와 다릅니다.</p>}
      {out.issues.length === 0 ? (
        <p className="notice notice-ok">문제를 찾지 못했습니다.</p>
      ) : (
        <ul className="space-y-1">
          {out.issues.map((i, n) => (
            <li key={n} className={`notice ${i.severity === "high" ? "notice-error" : "notice-warn"}`}>
              {i.panel ? <strong>{i.panel}번 칸: </strong> : null}
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </ProposalShell>
  );
}

/* ───────────── Step 3: dialogue ───────────── */

export function DialogueProposal({ job, out }: { job: JobView; out: DialogueOutT }) {
  const { doc } = useEditor();
  const apply = useApply(job);
  return (
    <ProposalShell
      job={job}
      title="대사 제안"
      summary={out.summary}
      applyLabel="대사 전체 적용"
      onApply={() => apply(applyDialogue(doc.data, out), "AI 대사 적용")}
    >
      <ul className="space-y-1">
        {out.voices.map((v) => {
          const c = doc.data.cast[v.character - 1];
          return (
            <li key={v.character}>
              <strong>목소리{doc.data.cast.length > 1 && c ? ` · ${castLabel(doc.data, c.id)}` : ""}:</strong> {v.voice}
            </li>
          );
        })}
      </ul>
      <ol className="space-y-2">
        {out.lines.map((l) => (
          <li key={l.panel} className="rounded-lg bg-white border border-line p-3">
            <div className="font-semibold">
              {l.panel}번 표정
              {doc.data.cast.length > 1 && doc.data.expressions[l.panel - 1] ? ` · ${castLabel(doc.data, doc.data.expressions[l.panel - 1].characterId)}` : ""} · “{l.line}”
            </div>
            <div className="text-[14px] text-muted">의미: {l.meaning} · 말투: {l.delivery}</div>
          </li>
        ))}
      </ol>
    </ProposalShell>
  );
}

/* ───────────── Step 4: acting ───────────── */

export function ActingProposal({ job, out }: { job: JobView; out: ActingOutT }) {
  const { doc } = useEditor();
  const apply = useApply(job);
  return (
    <ProposalShell
      job={job}
      title={`시간 분배 제안 · 전체 ${doc.data.acting.duration}초`}
      summary={out.summary}
      applyLabel="타임라인 적용"
      onApply={() => apply(applyActing(doc.data, out), "AI 타임라인 적용")}
    >
      <ol className="space-y-1">
        {out.segments.map((s, i) => (
          <li key={i} className="rounded-lg bg-white border border-line p-2 text-[14px]">
            <strong>{s.start}–{s.end}초</strong> · {s.panel}번 표정{s.transition ? ` · 전환: ${s.transition}` : ""}
          </li>
        ))}
      </ol>
      <p className="field-help">전체 길이는 그대로 두고, AI가 제안한 순서와 비율에 맞춰 나눕니다.</p>
    </ProposalShell>
  );
}

/** Renders whatever pending proposal exists for `step` (`kinds` / `except` pick which AI jobs show here). */
export function PendingProposal({ step, kinds, except }: { step: number; kinds?: JobKind[]; except?: JobKind[] }) {
  const pending = usePendingProposal(step, (k) => (!kinds || kinds.includes(k as JobKind)) && !except?.includes(k as JobKind));
  if (!pending) return null;
  const { job, proposal } = pending;
  if (job.kind === "check_sheet") return <SheetCheckResult job={job} out={proposal as SheetCheckOutT} />;
  switch (step) {
    case 0:
      return job.kind === "compose_scene" ? (
        <ComposeProposal job={job} out={proposal as SceneComposeOutT} />
      ) : (
        <CharacterProposal job={job} out={proposal as CharacterOutT} />
      );
    case 1:
      return (proposal as { panels?: unknown }).panels ? (
        <StoryboardProposal job={job} out={proposal as StoryboardOutT} />
      ) : (
        <ExpressionsProposal job={job} out={proposal as ExpressionsOutT} />
      );
    case 2:
      return <DialogueProposal job={job} out={proposal as DialogueOutT} />;
    case 3:
      return <ActingProposal job={job} out={proposal as ActingOutT} />;
    default:
      return null;
  }
}
