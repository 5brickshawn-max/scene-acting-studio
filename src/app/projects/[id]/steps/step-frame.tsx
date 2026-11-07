"use client";
import { useState } from "react";
import {
  STEPS,
  approve,
  canApprove,
  stepIssues,
  type StepIndex,
} from "@/lib/domain/project";
import { useEditor } from "../editor-context";
import { IssueList } from "../ui";
import { Comments } from "../comments";

export function StepFrame(props: {
  step: StepIndex;
  title: string;
  intro: string;
  onNavigate: (s: StepIndex) => void;
  children: React.ReactNode;
}) {
  const { doc, canEdit } = useEditor();
  const { data } = doc;
  const { step } = props;
  const approved = data.approvedThrough >= step;
  const prevApproved = data.approvedThrough >= step - 1;
  const issues = stepIssues(data, step);
  const [busy, setBusy] = useState(false);

  async function doApprove() {
    setBusy(true);
    const next = approve(data, step);
    const ok = await doc.commit(next, "approve", `${STEPS[step]} 승인`);
    setBusy(false);
    if (ok && step < 4) props.onNavigate((step + 1) as StepIndex);
  }

  async function undoApprove() {
    setBusy(true);
    await doc.commit({ ...data, approvedThrough: step - 1 }, "unapprove", `${STEPS[step]} 승인 취소`);
    setBusy(false);
  }

  return (
    <section className="card" aria-labelledby={`step-${step}-title`}>
      <header className="p-6 border-b border-line">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="eyebrow">{step + 1}단계 · {STEPS[step]}</span>
          {approved ? <span className="pill pill-ok">승인됨</span> : <span className="pill">작성 중</span>}
        </div>
        <h2 id={`step-${step}-title`} className="text-2xl font-bold">{props.title}</h2>
        <p className="text-muted mt-1">{props.intro}</p>
        {approved && canEdit && (
          <p className="notice notice-info mt-3">승인된 단계입니다. 내용을 고치면 이 단계부터 승인이 풀립니다. 승인은 팀 검토용이라, 승인 없이도 다음 단계로 갈 수 있습니다.</p>
        )}
        {!prevApproved && (
          <p className="notice notice-warn mt-3">
            앞 단계({STEPS[step - 1]})가 아직 승인되지 않았습니다. 미리 작성할 수는 있지만 승인은 앞 단계부터 진행됩니다.
          </p>
        )}
      </header>

      <div className="p-6 space-y-8">{props.children}</div>

      <footer className="p-6 border-t border-line bg-[#fbfcf9] rounded-b-[14px] space-y-4">
        <h3 className="section-title">승인 전 확인</h3>
        <IssueList issues={issues} />
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <button className="btn" disabled={step === 0} onClick={() => props.onNavigate((step - 1) as StepIndex)}>
            ← 이전 단계
          </button>
          {canEdit &&
            (approved ? (
              <div className="flex gap-2">
                <button className="btn" disabled={busy} onClick={undoApprove}>승인 취소</button>
                {step < 4 && (
                  <button className="btn btn-primary" onClick={() => props.onNavigate((step + 1) as StepIndex)}>
                    다음 단계로 →
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 justify-end">
                {step < 4 && (
                  <button className="btn" onClick={() => props.onNavigate((step + 1) as StepIndex)}>
                    승인 없이 다음 단계로 →
                  </button>
                )}
                <button className="btn btn-primary" disabled={busy || !canApprove(data, step)} onClick={doApprove}>
                  {step < 4 ? "승인하고 다음 단계로 →" : "최종 승인"}
                </button>
              </div>
            ))}
        </div>
      </footer>
      <Comments step={step} />
    </section>
  );
}
