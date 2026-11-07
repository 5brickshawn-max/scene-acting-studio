"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { STEPS, isUnlocked, type ProjectData, type StepIndex } from "@/lib/domain/project";
import type { AssetView, JobView } from "@/lib/types";
import { EditorProvider } from "./editor-context";
import { useProjectDoc, type SaveStatus } from "./use-project-doc";
import { useJobs } from "./use-jobs";
import { CharacterStep } from "./steps/character";
import { ExpressionStep } from "./steps/expressions";
import { DialogueStep } from "./steps/dialogue";
import { ActingStep } from "./steps/acting";
import { VideoStep } from "./steps/video";
import { ConsultPanel } from "./consult";
import { VersionHistory } from "./history";
import { ReviewLinkDialog } from "./review-link";

const STATUS: Record<SaveStatus, { label: string; cls: string }> = {
  saved: { label: "저장됨", cls: "pill-ok" },
  dirty: { label: "저장 대기", cls: "" },
  saving: { label: "저장 중…", cls: "" },
  conflict: { label: "저장 충돌", cls: "pill-err" },
  error: { label: "저장 실패", cls: "pill-err" },
};

function readPref(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function Editor(props: {
  projectId: string;
  workspaceId: string;
  userId: string;
  canEdit: boolean;
  initialData: ProjectData;
  initialVersion: number;
  initialAssets: AssetView[];
  initialJobs: JobView[];
  members: [string, string][];
}) {
  const doc = useProjectDoc(props.projectId, { data: props.initialData, version: props.initialVersion }, !props.canEdit);
  const jobs = useJobs(props.projectId, props.initialJobs);
  const [step, setStep] = useState<StepIndex>(() => Math.min(4, Math.max(0, props.initialData.currentStep)) as StepIndex);
  const [showChat, setShowChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const members = new Map(props.members);

  useEffect(() => setShowChat(readPref("fas:chat", false)), []);
  const toggleChat = (v: boolean) => {
    setShowChat(v);
    try {
      localStorage.setItem("fas:chat", v ? "1" : "0");
    } catch {}
  };

  const navigate = (s: StepIndex) => {
    // Navigation is view state only: it never creates a version or re-opens approvals.
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const running = jobs.jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const st = STATUS[doc.status];

  return (
    <EditorProvider
      projectId={props.projectId}
      workspaceId={props.workspaceId}
      userId={props.userId}
      canEdit={props.canEdit}
      doc={doc}
      jobs={jobs}
      initialAssets={props.initialAssets}
    >
      <header className="sticky top-0 z-20 bg-white border-b border-line">
        <div className="mx-auto max-w-[1500px] px-4 sm:px-6 py-2 min-h-16 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href="/projects" className="btn btn-sm btn-ghost" aria-label="작업 목록으로">← 목록</Link>
          <h1 className="font-bold text-lg truncate flex-1 min-w-[140px]">{doc.data.title || "이름 없음"}</h1>
          {/* One status area: save state + AI jobs */}
          <div className="flex items-center gap-2" aria-live="polite">
            <span className={`pill ${st.cls}`}>{st.label} · v{doc.version}</span>
            {running > 0 && <span className="pill pill-accent">AI 작업 {running}개 진행 중</span>}
            {!props.canEdit && <span className="pill">읽기 전용(검토자)</span>}
          </div>
          <button className="btn btn-sm" onClick={() => setShowHistory(true)}>버전 기록</button>
          {props.canEdit && (
            <button className="btn btn-sm" onClick={() => setShowReview(true)}>검토용 링크</button>
          )}
          <button className="btn btn-sm" aria-pressed={showChat} onClick={() => toggleChat(!showChat)}>
            {showChat ? "상의 닫기" : "AI와 상의"}
          </button>
        </div>
        <nav aria-label="단계" className="mx-auto max-w-[1500px] px-4 sm:px-6 pb-3">
          <ol className="flex gap-1">
            {STEPS.map((name, i) => {
              const s = i as StepIndex;
              const approved = doc.data.approvedThrough >= s;
              const active = step === s;
              return (
                <li key={name} className={`min-w-0 ${active ? "flex-[3] sm:flex-1" : "flex-1"}`}>
                  <button
                    onClick={() => navigate(s)}
                    aria-current={active ? "step" : undefined}
                    className={`w-full rounded-lg px-2 py-2 text-left border text-[14px] font-semibold flex items-center gap-2 ${
                      active ? "border-accent bg-[#fff1e8] text-accent" : approved ? "border-[#c6dfbf] bg-[#edf6ea] text-ok" : "border-line bg-white"
                    } ${!isUnlocked(doc.data, s) && !active ? "opacity-70" : ""}`}
                  >
                    <span className="grid place-items-center size-6 rounded-full border border-current text-[13px] shrink-0">{approved ? "✓" : i + 1}</span>
                    <span className={`truncate ${active ? "" : "hidden sm:inline"}`}>{name}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 sm:px-6 py-6 space-y-4">
        {doc.pendingDraft && (
          <div className="notice notice-warn flex flex-wrap items-center gap-3" role="alert">
            <span className="flex-1">
              이 브라우저에 저장되지 않은 변경이 있습니다 ({new Date(doc.pendingDraft.at).toLocaleString("ko-KR")}, v{doc.pendingDraft.baseVersion} 기준).
              {doc.pendingDraft.baseVersion < doc.version && " 그 뒤에 팀원이 저장한 내용이 있어, 복원하면 최신 내용을 덮어씁니다(이전 내용은 버전 기록에 남습니다)."}
            </span>
            <button className="btn btn-sm" onClick={() => doc.restoreDraft(true)}>복원해서 저장</button>
            <button className="btn btn-sm btn-ghost" onClick={() => doc.restoreDraft(false)}>버리기</button>
          </div>
        )}
        {doc.conflict && (
          <div className="notice notice-error flex flex-wrap items-center gap-3" role="alert">
            <span className="flex-1">
              다른 팀원이 먼저 저장했습니다 (v{doc.conflict.latestVersion}). 어떤 내용을 남길지 고르세요. 어느 쪽을 골라도 다른 쪽은 기록에 남습니다.
            </span>
            <button className="btn btn-sm" onClick={() => doc.resolveConflict("load_latest")}>최신본 불러오기</button>
            <button className="btn btn-sm btn-primary" onClick={() => doc.resolveConflict("keep_mine")}>내 변경으로 저장</button>
          </div>
        )}
        {doc.status === "error" && doc.error && <p className="notice notice-error">저장하지 못했습니다: {doc.error} <button className="btn btn-sm ml-2" onClick={() => doc.save()}>다시 시도</button></p>}

        <div className={`grid gap-6 items-start ${showChat ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}>
          <div className="min-w-0">
            {step === 0 && <CharacterStep onNavigate={navigate} />}
            {step === 1 && <ExpressionStep onNavigate={navigate} />}
            {step === 2 && <DialogueStep onNavigate={navigate} />}
            {step === 3 && <ActingStep onNavigate={navigate} />}
            {step === 4 && <VideoStep onNavigate={navigate} />}
          </div>
          {showChat && (
            <div className="lg:sticky lg:top-[140px]">
              <ConsultPanel step={step} onClose={() => toggleChat(false)} />
            </div>
          )}
        </div>
      </main>
      {showHistory && <VersionHistory onClose={() => setShowHistory(false)} members={members} />}
      {showReview && <ReviewLinkDialog onClose={() => setShowReview(false)} />}
    </EditorProvider>
  );
}
