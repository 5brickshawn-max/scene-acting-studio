"use client";
import { useState } from "react";
import type { ActingOutT, CharacterOutT, DialogueOutT, ExpressionsOutT, SheetCheckOutT } from "@/lib/ai/schemas";
import { JOB_LABEL, type JobKind } from "@/lib/ai/schemas";
import { applyActing, applyCharacter, applyDialogue, applyExpressions, type CharacterField } from "@/lib/domain/apply";
import { castLabel, FACING_LABEL, GAZE_LABEL, INTENSITY_LABEL, type ProjectData } from "@/lib/domain/project";
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
  // analysis jobs name their cast member; a consult proposal has none, so the team picks one
  const [target, setTarget] = useState(
    d.cast.some((c) => c.id === job.input?.characterId) ? job.input.characterId! : d.cast[0].id,
  );
  const member = d.cast.find((c) => c.id === target) ?? d.cast[0];
  const now = (k: Exclude<CharacterField, "questions">) => (k === "style" ? d.style : member[k]);
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
  return (
    <ProposalShell
      job={job}
      title={d.cast.length > 1 ? `캐릭터 설명 · ${castLabel(d, member.id)}` : "캐릭터 설명"}
      summary={out.summary}
      applyDisabled={picked.size === 0}
      onApply={() => apply(applyCharacter(doc.data, out, [...picked], member.id), `AI 캐릭터 설명 적용 (${castLabel(d, member.id)})`)}
    >
      <div className="space-y-3">
        {d.cast.length > 1 && !job.input?.characterId && (
          <label className="block">
            <span className="field-label">적용할 인물</span>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              {d.cast.map((c) => (
                <option key={c.id} value={c.id}>{castLabel(d, c.id)}</option>
              ))}
            </select>
          </label>
        )}
        {CHAR_FIELDS.map((f) => (
          <label key={f.key} className="flex gap-3 items-start rounded-lg bg-white border border-line p-3">
            <input type="checkbox" className="mt-1 size-5" checked={picked.has(f.key)} onChange={() => toggle(f.key)} />
            <span className="flex-1">
              <span className="font-semibold">{f.label}</span>
              <span className="block whitespace-pre-wrap">{out[f.key]}</span>
              {now(f.key) && now(f.key) !== out[f.key] && <span className="block text-[13px] text-muted mt-1">현재: {now(f.key)}</span>}
            </span>
          </label>
        ))}
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
                {doc.data.cast.length > 1 && e.others && <span className="block">나머지 인물: {e.others}</span>}
                <span className="block text-[13px] text-muted">근거: {e.directionEvidence}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
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
      return <CharacterProposal job={job} out={proposal as CharacterOutT} />;
    case 1:
      return <ExpressionsProposal job={job} out={proposal as ExpressionsOutT} />;
    case 2:
      return <DialogueProposal job={job} out={proposal as DialogueOutT} />;
    case 3:
      return <ActingProposal job={job} out={proposal as ActingOutT} />;
    default:
      return null;
  }
}
