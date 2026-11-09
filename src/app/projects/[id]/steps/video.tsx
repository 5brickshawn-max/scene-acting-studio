"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { usesConti, type ProjectData, type StepIndex } from "@/lib/domain/project";
import type { CheckFix, CheckItem } from "@/lib/domain/check";
import { appendDirection, applyRetime, applyTextFix, fixState, fixWhere, promptFixRows, removePromptFix, type CheckTextFix } from "@/lib/domain/fixes";
import { useEditor } from "../editor-context";
import { AiAction, CopyButton, ImageSlot, Seg } from "../ui";
import { StepFrame } from "./step-frame";
import { FrameMaker, HiggsfieldVideo } from "./higgsfield-direct";
import { uploadAsset } from "@/lib/upload";
import { composeImages } from "@/lib/export";
import { HiggsfieldVideoPack } from "../packs";
import { EnglishBar, PromptApplyBar, TextDiff, useVideoPrompt, type VideoPrompt } from "../prompt-tools";
import { englishStale } from "@/lib/domain/english";
import { VIDEO_MODELS, videoDuration, videoMaxDuration, type VideoModelKey } from "@/lib/higgsfield/models";
import { WEIGHT_LABEL, WEIGHT_LEVELS } from "@/lib/domain/constraints";
import type { PromptCheckResult } from "@/lib/ai/schemas";

const short = (t: string, n = 90) => (t.length > n ? t.slice(0, n) + "…" : t);

const LEVELS: { level: CheckItem["level"]; title: string; cls: string }[] = [
  { level: "warn", title: "확인할 점", cls: "notice-warn" },
  { level: "fixed", title: "자동으로 맞춘 것", cls: "notice-info" },
  { level: "ok", title: "문제 없음", cls: "notice-ok" },
];

/** One fix the AI check wrote: where, before → after, and the button that applies it. */
function FixCard({ fix, busy, onApply }: { fix: CheckTextFix; busy: boolean; onApply: () => void }) {
  const { doc, canEdit } = useEditor();
  const state = fixState(doc.data, fix);
  const promptOnly = fix.target !== "camera" && fix.target !== "direction";
  return (
    <div className="rounded-lg border border-line bg-white p-3 space-y-2 text-ink">
      <div className="flex flex-wrap items-center gap-2">
        <strong>고칠 안 · {fixWhere(doc.data, fix.target, fix.expressionId)}</strong>
        {promptOnly && <span className="pill">영상 프롬프트에만 적용 · 승인된 글은 그대로</span>}
        {state === "applied" && <span className="pill pill-ok">적용됨</span>}
        {state === "changed" && <span className="pill">점검 뒤에 이 칸이 바뀌어 적용할 수 없습니다 · 다시 점검하세요</span>}
      </div>
      <TextDiff before={fix.before} after={fix.text} />
      {canEdit && state === "ready" && (
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={onApply}>
          이대로 고치기
        </button>
      )}
    </div>
  );
}

/**
 * 렌더 전 점검: everything going into the video, checked against each other right
 * before the render button. The instant check comes with every prompt build;
 * "AI로 정밀 점검" reads the final prompt for subtler contradictions and writes the
 * fixed texts. Every finding that can be fixed has its button here.
 */
function RenderCheck({ vp, model, onNavigate }: { vp: VideoPrompt; model: VideoModelKey; onNavigate: (s: StepIndex) => void }) {
  const { jobs, doc, askAi, canEdit } = useEditor();
  const { h, loading, apply } = vp;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vm = VIDEO_MODELS[model];
  const items: CheckItem[] = [...(h?.checks ?? [])];
  const input = { start: Boolean(doc.data.video.startFrameAssetId), end: Boolean(doc.data.video.startFrameAssetId && doc.data.video.endFrameAssetId) };
  const dur = videoDuration(vm, doc.data.acting.duration, input);
  if (h && dur !== Math.ceil(doc.data.acting.duration))
    items.unshift({
      level: "warn",
      area: "영상 길이",
      text: `${vm.label}은(는) 지금 방식으로 ${vm.minDuration}~${videoMaxDuration(vm, input)}초만 지원해 ${dur}초로 만듭니다 (설계 ${doc.data.acting.duration}초).`,
    });
  const count = (level: CheckItem["level"]) => items.filter((i) => i.level === level).length;
  const ai = jobs.jobs.find((j) => j.kind === "check_prompt" && j.step === 4);
  const aiRunning = ai?.status === "queued" || ai?.status === "running";
  const englishJob = jobs.jobs.find((j) => j.kind === "write_english");
  const englishRunning = englishJob?.status === "queued" || englishJob?.status === "running";
  const busyFix = (f: CheckFix) => (f.kind === "ai_check" && aiRunning) || (f.kind === "english" && englishRunning);
  const aiOut = ai?.status === "done" ? (ai.output as PromptCheckResult | null) : null;
  const aiFixes = (aiOut?.conflicts ?? []).flatMap((c) => (c.fix ? [{ fix: c.fix, note: short(c.problem, 80) }] : []));
  const ready = aiFixes.filter((x) => fixState(doc.data, x.fix) === "ready");
  const promptFixes = promptFixRows(doc.data);

  async function save(next: ProjectData, note: string, kind: "save" | "ai_apply" = "save") {
    setBusy(true);
    setError(null);
    const v = await doc.commit(next, kind, note);
    setBusy(false);
    if (!v) setError("저장하지 못했습니다. 화면 위쪽의 저장 상태를 확인하세요.");
  }

  async function runFix(fix: CheckFix) {
    if (fix.kind === "goto") return onNavigate(fix.step as StepIndex);
    if (fix.kind === "retime")
      return save(applyRetime(doc.data, fix.to), `렌더 전 점검: 추가 연출의 시간을 ${fix.to}초에 맞춤`);
    if (fix.kind === "append_direction") return save(appendDirection(doc.data, fix.text), "렌더 전 점검: 상황 설정의 카메라 움직임을 추가 연출로 옮김");
    if (fix.kind === "english") return void (await askAi("write_english", 4));
    setOpen(true);
    await askAi("check_prompt", 4);
  }

  function applyFixes(list: { fix: CheckTextFix; note: string }[]) {
    const next = list.reduce((d, x) => applyTextFix(d, x.fix, x.note), doc.data);
    const names = list.map((x) => fixWhere(doc.data, x.fix.target, x.fix.expressionId)).join(", ");
    return save(next, `렌더 전 AI 점검 수정 적용: ${names}`, "ai_apply");
  }

  return (
    <div className="rounded-lg border border-line bg-white p-4 space-y-3" role="region" aria-label="렌더 전 점검">
      <div className="flex flex-wrap items-center gap-2">
        <strong>렌더 전 점검</strong>
        <button
          className="btn btn-sm"
          disabled={loading}
          onClick={async () => {
            setOpen(true);
            await apply(); // saves pending edits first, then rebuilds the prompt and the check
          }}
        >
          {loading ? "점검 중…" : "충돌 점검"}
        </button>
        {h && <span className={`pill ${count("warn") ? "pill-warn" : "pill-ok"}`}>{count("warn") ? `확인할 점 ${count("warn")}` : "충돌 없음"}</span>}
        {h && count("fixed") > 0 && <span className="pill">자동 조율 {count("fixed")}</span>}
        {promptFixes.length > 0 && <span className="pill">프롬프트만 고친 문구 {promptFixes.length}</span>}
        {h && (
          <span className="text-[13px] text-muted">
            v{h.version} 기준 · 프롬프트 {h.prompt.length.toLocaleString("ko-KR")}자
          </span>
        )}
        {h && !open && (
          <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
            자세히
          </button>
        )}
      </div>
      {doc.status !== "saved" && <p className="field-help">저장되지 않은 수정이 있습니다. ‘충돌 점검’을 누르면 저장한 뒤 다시 점검합니다.</p>}
      {error && <p className="notice notice-error">{error}</p>}

      {open && h && (
        <div className="space-y-3">
          {LEVELS.map(({ level, title, cls }) => {
            const list = items.filter((i) => i.level === level);
            if (!list.length) return null;
            return (
              <div key={level} className="space-y-1">
                <div className="text-[13px] font-semibold text-muted">{title}</div>
                <ul className="space-y-1">
                  {list.map((i, k) => (
                    <li key={k} className={`notice ${cls} text-[14px] space-y-2`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <span>
                          <strong>{i.area}</strong> · {i.text}
                        </span>
                        {i.fix && (canEdit || i.fix.kind === "goto") && (
                          <button
                            type="button"
                            className="btn btn-sm shrink-0"
                            disabled={busy || busyFix(i.fix)}
                            onClick={() => runFix(i.fix!)}
                          >
                            {busyFix(i.fix) ? "AI 작업 중…" : i.fix.label}
                          </button>
                        )}
                      </div>
                      {i.fix?.kind === "retime" && i.fix.changes.length > 0 && <div className="text-[13px]">바뀌는 곳: {i.fix.changes.join(" · ")}</div>}
                      {i.fix?.kind === "append_direction" && <div className="text-[13px] whitespace-pre-wrap">옮길 문장: {i.fix.text}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {promptFixes.length > 0 && (
            <div className="space-y-1">
              <div className="text-[13px] font-semibold text-muted">영상 프롬프트에만 고친 문구 (승인된 단계의 글은 그대로)</div>
              <ul className="space-y-2">
                {promptFixes.map(({ fix, where, active }, k) => (
                  <li key={k} className="rounded-lg border border-line p-3 text-[14px] space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{where}</strong>
                      {!active && <span className="pill">원래 글이 바뀌어 지금은 쓰지 않음</span>}
                      {canEdit && (
                        <button type="button" className="btn btn-sm btn-ghost ml-auto" disabled={busy} onClick={() => save(removePromptFix(doc.data, fix), `영상 프롬프트 수정 되돌림: ${where}`)}>
                          되돌리기
                        </button>
                      )}
                    </div>
                    {fix.note && <div className="text-muted">{fix.note}</div>}
                    <TextDiff before={fix.before} after={fix.after} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {h.adjustments.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[14px] font-semibold">자동으로 고친 문구 보기 (영상 프롬프트에만 적용, 앱의 원래 문구는 그대로)</summary>
              <ul className="space-y-2 mt-2">
                {h.adjustments.map((a, i) => (
                  <li key={i} className="rounded-lg border border-line p-3 text-[14px] space-y-1">
                    <div>
                      <strong>{a.where}</strong> · {a.rule}
                    </div>
                    <div className="text-muted whitespace-pre-wrap">
                      <span className="line-through">{short(a.before)}</span>
                      {"\n"}→ {short(a.after) || "(삭제)"}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary className="cursor-pointer text-[14px] font-semibold">이 영상에 쓰는 스튜디오 제약사항 (프롬프트 맨 끝)</summary>
            <pre className="whitespace-pre-wrap break-words text-[13px] font-mono mt-2">{h.constraints}</pre>
          </details>

          <div className="border-t border-line pt-3 space-y-2">
            <AiAction
              kind="check_prompt"
              step={4}
              label="AI로 정밀 점검"
              description="최종 프롬프트 전체를 읽고 자동 점검이 못 잡는 모순(장비·각도·구도·조명·속도·동작 등)을 찾아, 고칠 글까지 제안합니다. ‘이대로 고치기’를 눌러야 바뀝니다."
            />
            {aiOut && ai && (
              <div className="space-y-2">
                {ai.based_on_version !== h.version && (
                  <p className="field-help">
                    v{ai.based_on_version} 기준 결과입니다(지금 v{h.version}). 그 뒤에 바뀐 칸의 고칠 안은 적용되지 않으니, 바뀐 내용까지 보려면 다시 점검하세요.
                  </p>
                )}
                <p className="text-[14px]">{aiOut.summary}</p>
                {canEdit && ready.length > 1 && (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => applyFixes(ready)}>
                    고칠 안 모두 적용 ({ready.length})
                  </button>
                )}
                {aiOut.conflicts.length === 0 ? (
                  <p className="notice notice-ok">AI가 찾은 충돌이 없습니다.</p>
                ) : (
                  <ul className="space-y-2">
                    {aiOut.conflicts.map((c, i) => (
                      <li key={i} className={`notice ${c.severity === "high" ? "notice-error" : "notice-warn"} text-[14px] space-y-2`}>
                        <div>
                          <strong>{c.severity === "high" ? "중요" : "다듬기"}</strong> · {c.where}
                        </div>
                        <div>{c.problem}</div>
                        <div className="text-muted">고칠 곳: {c.suggestion}</div>
                        {c.fix ? (
                          <FixCard fix={c.fix} busy={busy} onApply={() => applyFixes([{ fix: c.fix!, note: short(c.problem, 80) }])} />
                        ) : c.step && c.step >= 1 && c.step <= 5 ? (
                          <button type="button" className="btn btn-sm" onClick={() => onNavigate((c.step! - 1) as StepIndex)}>
                            {c.step}단계로 이동
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Crop one panel of a 1-row sheet in the browser and upload it as a start frame. */
async function cropPanel(url: string, cols: number, index: number): Promise<File> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const w = Math.floor(bmp.width / cols);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, index * w, 0, w, bmp.height, 0, 0, w, bmp.height);
  const out = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return new File([out], `시작프레임_표정${index + 1}.png`, { type: "image/png" });
}

/** Download consecutive beat images joined side by side, padded to the video's aspect ratio. */
async function downloadCombined(urls: string[], aspect: "16:9" | "9:16", name: string) {
  const bytes = await Promise.all(urls.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));
  const out = await composeImages(bytes, aspect);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([out as BlobPart], { type: "image/png" }));
  link.download = `${name.replace(/[\\/:*?"<>|]+/g, " ").trim()}_${aspect.replace(":", "x")}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** Download a reference padded with white to the video's aspect ratio (never stretched). */
async function downloadPadded(url: string, aspect: "16:9" | "9:16", name: string) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const r = aspect === "16:9" ? 16 / 9 : 9 / 16;
  const { width: w, height: h } = bmp;
  const W = w / h < r ? Math.round(h * r) : w;
  const H = w / h < r ? h : Math.round(w / r);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, Math.floor((W - w) / 2), Math.floor((H - h) / 2));
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("변환 실패"))), "image/png"));
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name.replace(/[\\/:*?"<>|]+/g, " ").trim()}_${aspect.replace(":", "x")}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export function VideoStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc, projectId, assets, addAsset, workspaceId, canEdit } = useEditor();
  const [cropping, setCropping] = useState(false);
  const { data } = doc;
  // The prompt (and its check) follows the saved version automatically; "프롬프트에 적용" saves and rebuilds now.
  const vp = useVideoPrompt(true);
  const { h, loading } = vp;

  // 영어 정리 keeps up by itself on this step: when it is missing or out of date (e.g. after the AI
  // check's fixes), it is made again once per saved version, before anyone renders
  const { jobs, askAi } = useEditor();
  const englishJob = jobs.jobs.find((j) => j.kind === "write_english");
  const englishBusy = englishJob?.status === "queued" || englishJob?.status === "running";
  const englishArriving = englishJob?.status === "done" && englishJob.applied_version === null;
  const englishDue =
    canEdit &&
    doc.status === "saved" &&
    !englishBusy &&
    !englishArriving &&
    englishJob?.status !== "failed" &&
    data.expressions.length > 0 &&
    (!data.english || englishStale(data).length > 0);
  // ask once per distinct set of out-of-date pieces (not per saved version): if the AI leaves a piece
  // out, the same set does not trigger another request
  const staleKey = data.english ? englishStale(data).join("|") : "none";
  const autoEnglish = useRef<string | null>(null);
  const [englishRefused, setEnglishRefused] = useState(false);
  useEffect(() => {
    if (!englishDue || autoEnglish.current === staleKey) return;
    autoEnglish.current = staleKey;
    void askAi("write_english", 4).then((id) => setEnglishRefused(!id));
  }, [englishDue, staleKey, askAi]);
  const [error, setError] = useState<string | null>(null);
  const setVideo = (patch: Partial<typeof data.video>) => doc.edit(4, (d) => ({ ...d, video: { ...d.video, ...patch } }));

  const sheet = data.expressionSetup.sheetAssetId ? assets.get(data.expressionSetup.sheetAssetId) : undefined;
  const firstId = data.acting.segments[0]?.expressionId;
  const firstIndex = Math.max(0, data.expressions.findIndex((e) => e.id === firstId));

  const firstImage = data.expressions[firstIndex]?.imageAssetId ?? null;

  async function startFromSheet() {
    if (firstImage) return setVideo({ startFrameAssetId: firstImage });
    if (!sheet) return;
    setCropping(true);
    setError(null);
    try {
      const file = await cropPanel(sheet.url, data.expressions.length, firstIndex);
      const a = await uploadAsset({ file, kind: "design_ref", workspaceId, projectId });
      addAsset(a);
      setVideo({ startFrameAssetId: a.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "시작 프레임을 만들지 못했습니다.");
    } finally {
      setCropping(false);
    }
  }

  return (
    <StepFrame step={4} title="영상 프롬프트를 만드세요" intro="승인된 출연진·표정·대사·액팅으로 영상 프롬프트를 만들고, Higgsfield에서 생성한 결과를 올립니다." onNavigate={onNavigate}>
      <div className="space-y-3">
        <div className="grid md:grid-cols-2 gap-4">
          <Seg label="화면 비율" value={data.video.aspectRatio} options={["16:9", "9:16"] as const}
            labels={{ "16:9": "가로 16:9", "9:16": "세로 9:16" }} onChange={(v) => setVideo({ aspectRatio: v })} />
          {data.mode === "storyboard" && (
            <div>
              <Seg
                label="참고 그림 구성 (스토리보드)"
                value={data.video.refMode}
                options={["auto", "conti", "panels"] as const}
                labels={{ auto: "자동", conti: "콘티 방식", panels: "완성 컷 그림 방식" }}
                onChange={(v) => setVideo({ refMode: v })}
              />
              <p className="field-help">
                지금: <strong>{usesConti(data) ? "콘티 방식" : "완성 컷 그림 방식"}</strong>.{" "}
                {usesConti(data)
                  ? "① 캐릭터 시트(1단계 인물별 자료) → ② 장면 기준 그림·배경·에셋(추가 참고) → ③ 러프 콘티 순서로 첨부하고, 프롬프트가 각 그림의 역할을 지시합니다(러프 콘티는 구도·동선·포즈·카메라만, 그림체는 시트와 장면 그림)."
                  : "장면 기준 그림과 컷마다의 완성 컷 그림을 첨부합니다."}{" "}
                자동은 모든 컷에 러프 콘티가 있으면 콘티 방식을 씁니다. 러프 콘티는 3컷씩 한 장에 나란히 붙여, 선 그림이 컬러 참고 그림보다 많아져 영상이 선화처럼 되는 것을 막습니다.
              </p>
            </div>
          )}
          <div>
            <Seg
              label="움직임 무게감 (스튜디오 제약사항에 들어감)"
              value={data.video.weight}
              options={WEIGHT_LEVELS}
              labels={WEIGHT_LABEL}
              onChange={(v) => setVideo({ weight: v })}
            />
            <p className="field-help">
              무게감은 숫자가 아니라 눈에 보이는 결과로 지시합니다: 실제 속도(슬로모션 없음), 짧은 체공과 빠른 낙하, 강한 착지와 충격 반응, 미끄러지지 않는 발, 빨리
              떨어지는 머리카락·옷. ‘과장’은 “중력이 두 배인 것처럼”을 더합니다(우주·행성 같은 이미지가 끼어들면 ‘무겁게’로 바꾸세요). 대사·동작이 짧은 컷(넘어짐·낙하는 0.5초
              안팎)은 4단계 시간 분배에서 짧게 주고, 나머지 시간은 다른 동작으로 채우세요.
            </p>
          </div>
          {/* the director's field was removed; a text left from before still goes into the prompt, so it stays visible and removable */}
          {data.video.extraDirection.trim() && (
            <div className="notice notice-warn space-y-2">
              <p>
                예전에 적어 둔 <strong>추가 연출</strong>이 남아 있어 영상 프롬프트에 들어가고 있습니다(이 칸은 없어졌습니다). 필요 없으면 비우세요.
              </p>
              <pre className="whitespace-pre-wrap text-[13px] max-h-32 overflow-y-auto">{data.video.extraDirection}</pre>
              {canEdit && (
                <button type="button" className="btn btn-sm" onClick={() => setVideo({ extraDirection: "" })}>
                  추가 연출 비우기
                </button>
              )}
            </div>
          )}
        </div>
        <PromptApplyBar vp={vp} />
        <EnglishBar />
        {englishRefused && (
          <p className="notice notice-error">
            영어 정리를 자동으로 요청하지 못했습니다: {jobs.requestError ?? "요청이 거절되었습니다."} 위 ‘AI로 영어 정리’ 버튼으로 다시 시도할 수 있습니다.
          </p>
        )}
      </div>

      <HiggsfieldVideo
        onAdd={(id) =>
          doc.edit(4, (d) =>
            d.video.resultAssetIds.includes(id) ? d : { ...d, video: { ...d.video, resultAssetIds: [...d.video.resultAssetIds, id] } },
          )
        }
        beforeRender={(model) => <RenderCheck vp={vp} model={model} onNavigate={onNavigate} />}
      />

      <HiggsfieldVideoPack />

      <section className="space-y-3">
        <h3 className="section-title">생성한 영상</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {data.video.resultAssetIds.map((id, i) => (
            <ImageSlot key={id} label={`결과 ${i + 1}`} kind="video" assetId={id} accept="video/mp4" removable emptyText=""
              onChange={(nid) => setVideo({ resultAssetIds: nid ? data.video.resultAssetIds.map((x) => (x === id ? nid : x)) : data.video.resultAssetIds.filter((x) => x !== id) })} />
          ))}
          <ImageSlot label="영상 올리기" kind="video" assetId={null} accept="video/mp4" emptyText="MP4 파일을 올리세요."
            onChange={(id) => id && setVideo({ resultAssetIds: [...data.video.resultAssetIds, id] })} />
        </div>
      </section>

      <details className="rounded-xl border border-line" open={!!data.video.startFrameAssetId}>
      <summary className="cursor-pointer p-4 font-semibold">고급: 시작·끝 프레임 지정 (선택)</summary>
      <section className="px-5 pb-5 space-y-3">
        <p className="text-muted">
          비워두면 기본 그림과 표정 그림들을 참고 그림으로 넘깁니다. 첫 장면을 정확히 정하고 싶으면 한 명만 있는 그림을 시작 프레임으로 고르세요.
          끝 프레임까지 넣으면 영상이 그 장면에서 끝납니다(Kling 4.0·MiniMax H3). 클로즈업에서 바스트로 물러나는 식의 카메라는 글보다 두 프레임으로 정하는 편이 정확합니다.
        </p>
        <div className="grid md:grid-cols-2 gap-4 items-start">
          <ImageSlot label="시작 프레임" kind="design_ref" assetId={data.video.startFrameAssetId} removable
            emptyText="없음 — 참고 그림 방식으로 생성합니다." onChange={(id) => setVideo({ startFrameAssetId: id })} />
          <ImageSlot label="끝 프레임 (선택)" kind="design_ref" assetId={data.video.endFrameAssetId} removable
            emptyText={data.video.startFrameAssetId ? "없음 — 끝 장면은 영상 모델이 정합니다." : "시작 프레임과 함께 쓸 때만 첨부됩니다."}
            onChange={(id) => setVideo({ endFrameAssetId: id })} />
        </div>
        {canEdit && <FrameMaker onUse={(slot, id) => setVideo(slot === "start" ? { startFrameAssetId: id } : { endFrameAssetId: id })} />}
        <div className="grid md:grid-cols-[minmax(0,360px)_1fr] gap-4 items-start">
          {(firstImage || sheet) && canEdit && (
            <div className="space-y-2">
              <button className="btn" onClick={startFromSheet} disabled={cropping || (!!firstImage && data.video.startFrameAssetId === firstImage)}>
                {cropping ? "자르는 중…" : firstImage ? `첫 표정(${firstIndex + 1}번) 그림을 시작 프레임으로` : `표정 시트 ${firstIndex + 1}번 칸으로 시작 프레임 만들기`}
              </button>
              <p className="field-help">타임라인에서 처음 나오는 표정({firstIndex + 1}번)으로 영상을 시작합니다.</p>
            </div>
          )}
        </div>
      </section>
      </details>


      <details className="rounded-xl border border-line">
      <summary className="cursor-pointer p-4 font-semibold">고급: 수동으로 만들기 (프롬프트 복사 → higgsfield.ai)</summary>
      <section className="p-5 space-y-4">
        <h3 className="section-title">Higgsfield에서 영상 만들기 (구독 크레딧 사용)</h3>
        <ol className="list-decimal pl-5 space-y-1">
          <li>아래 버튼으로 프롬프트를 만듭니다.</li>
          <li>
            higgsfield.ai에서 영상 모델을 고르고{" "}
            {data.video.startFrameAssetId ? "시작 프레임(있으면 끝 프레임도)을 첨부합니다." : "아래 참고 그림을 번호 순서대로 첨부합니다."}
          </li>
          <li>프롬프트를 붙여넣고, 길이 {data.acting.duration}초·비율 {data.video.aspectRatio}로 생성합니다.</li>
          <li>완성된 영상을 아래에 올려 팀과 검토합니다.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-dark" onClick={vp.apply} disabled={loading}>{loading ? "만드는 중…" : h ? "지금 내용으로 다시 만들기" : "영상 프롬프트 만들기"}</button>
          <a className="btn" href="https://higgsfield.ai" target="_blank" rel="noreferrer">higgsfield.ai 열기 ↗</a>
        </div>
        {(error || vp.error) && <p className="notice notice-error">{error ?? vp.error}</p>}
        {h && (
          <div className="space-y-4">
            <p>v{h.version} 기준 · 추천 모델 <strong>{h.recommendedModel}</strong></p>
            <p className="notice notice-info">{h.startFrame} 번호가 프롬프트의 reference image 번호와 같아야 합니다.</p>
            <p className="field-help">
              그림이 영상 비율과 다르면 영상 모델이 인물을 늘리거나 찌그러뜨립니다. ‘{data.video.aspectRatio}로 받기’를 눌러 흰 여백을 붙인 그림을 첨부하세요.
            </p>
            <div className="flex flex-wrap gap-3">
              {h.references.map((r, i) => {
                const name = `${String(i + 1).padStart(2, "0")}_${r.label.split(" — ")[0]}`;
                const fail = (e: unknown) => setError(e instanceof Error ? e.message : "받지 못했습니다.");
                if (r.parts) {
                  // consecutive beats joined in one reference (the model takes a limited number of images)
                  const parts = r.parts.map((p) => assets.get(p.assetId));
                  return (
                    <div key={r.assetId} className="rounded-lg border border-line overflow-hidden w-60">
                      <div className="flex gap-1 bg-white">
                        {parts.map((a, k) => (a ? <img key={k} src={a.previewUrl} alt="" className="h-24 min-w-0 flex-1 object-contain checker" /> : null))}
                      </div>
                      <span className="block p-1 text-[13px]">
                        <strong>{i + 1}.</strong> {r.label.split(" — ")[0]} — 한 장에 나란히 붙여 첨부
                      </span>
                      {parts.every(Boolean) && (
                        <button type="button" className="btn btn-sm w-full rounded-none border-x-0 border-b-0"
                          onClick={() => downloadCombined(parts.map((a) => a!.url), data.video.aspectRatio, name).catch(fail)}>
                          합쳐서 {data.video.aspectRatio}로 받기
                        </button>
                      )}
                    </div>
                  );
                }
                const a = assets.get(r.assetId);
                return (
                  <div key={r.assetId} className="rounded-lg border border-line overflow-hidden w-36">
                    <a href={a?.url} target="_blank" rel="noreferrer">
                      {a && <img src={a.previewUrl} alt="" className="h-24 w-full object-contain checker" />}
                    </a>
                    <span className="block p-1 text-[13px]">
                      <strong>{i + 1}.</strong> {r.label.split(" — ")[0]}
                    </span>
                    {a && (
                      <button type="button" className="btn btn-sm w-full rounded-none border-x-0 border-b-0"
                        onClick={() => downloadPadded(a.url, data.video.aspectRatio, name).catch(fail)}>
                        {data.video.aspectRatio}로 받기
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1"><span className="field-label">프롬프트 (영문, 붙여넣기용) · {h.prompt.length.toLocaleString("ko-KR")}자</span><CopyButton text={h.prompt} label="프롬프트 복사" /></div>
              <textarea className="textarea font-mono text-[13px]" rows={12} readOnly value={h.prompt} aria-label="영상 프롬프트" />
            </div>
            {h.negativePrompt && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="field-label">네거티브 프롬프트 (Kling 등 네거티브 칸이 있는 곳에 따로 붙여넣기)</span>
                  <CopyButton text={h.negativePrompt} label="네거티브 복사" />
                </div>
                <textarea className="textarea font-mono text-[13px]" rows={3} readOnly value={h.negativePrompt} aria-label="네거티브 프롬프트" />
                <p className="field-help">
                  본문에는 피할 것을 부정문으로 쓰지 않고 긍정형으로만 씁니다(부정문은 오히려 그 단어를 떠올리게 할 수 있음). 앱에서 바로 생성할 때는 Higgsfield에 네거티브 칸이 없어 이
                  목록은 쓰이지 않습니다. Kling 사이트에서 직접 만들 때는 creativity/relevance를 relevance 쪽으로 올리면 네거티브가 더 엄격히 지켜집니다.
                </p>
              </div>
            )}
            <details>
              <summary className="cursor-pointer font-semibold">한국어로 내용 확인 (구간별 설계 전체, 줄이지 않은 원문)</summary>
              <pre className="whitespace-pre-wrap mt-2 text-[14px]">{h.promptKo}</pre>
            </details>
          </div>
        )}
      </section>
      </details>

    </StepFrame>
  );
}
