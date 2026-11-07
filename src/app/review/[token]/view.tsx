/* eslint-disable @next/next/no-img-element */
import {
  FACING_LABEL,
  FRAMING_CUT,
  FRAMING_LABEL,
  GAZE_LABEL,
  INTENSITY_LABEL,
  PITCH_LABEL,
  STEPS,
  TILT_LABEL,
  showsHands,
  imageIsStale,
  castLabel,
  imageAspectFor,
  POSITION_LABEL,
} from "@/lib/domain/project";
import { estimateSpeechSeconds } from "@/lib/domain/speech";
import { JOB_LABEL, type JobKind } from "@/lib/ai/schemas";
import type { ReviewAsset, ReviewBundle, ReviewJob } from "@/lib/review-data";

const fmt = (t: string | number) =>
  new Date(t).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });

const VERSION_KIND: Record<string, string> = {
  create: "생성",
  save: "저장",
  approve: "승인",
  unapprove: "승인 취소",
  ai_apply: "AI 제안 적용",
  restore: "되돌림",
};
const JOB_STATUS: Record<string, string> = { queued: "대기", running: "진행 중", done: "완료", failed: "실패" };
const DIRECTION_STATUS: Record<string, string> = { ai: "AI 추정 · 확인 필요", confirmed: "확인됨", manual: "직접 입력" };

const jobLabel = (kind: string) =>
  kind === "hf_expr"
    ? "Higgsfield 표정 그림"
    : kind === "hf_video"
      ? "Higgsfield 영상"
      : kind === "hf_frame"
        ? "Higgsfield 프레임 그림"
        : JOB_LABEL[kind as JobKind] ?? kind;

function Media({ a, label, tall }: { a?: ReviewAsset; label: string; tall?: boolean }) {
  if (!a)
    return (
      <div className={`${tall ? "aspect-[3/4]" : "aspect-square"} rounded-lg border border-dashed border-line grid place-items-center text-[13px] text-muted`}>
        없음
      </div>
    );
  if (a.mime.startsWith("video/")) return <video src={a.url} controls preload="metadata" className="w-full rounded-lg bg-black" />;
  return (
    <a href={a.url} target="_blank" rel="noreferrer noopener" title="원본 열기">
      <img src={a.previewUrl} alt={label} className={`w-full ${tall ? "aspect-[3/4]" : ""} object-contain rounded-lg border border-line checker`} />
    </a>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <div className="field-label">{label}</div>
      <p className="whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function Prompt({ title, text, open }: { title: string; text: string; open?: boolean }) {
  return (
    <details className="rounded-lg border border-line bg-white" open={open}>
      <summary className="cursor-pointer p-3 font-semibold">
        {title} <span className="text-muted font-normal">· {text.length.toLocaleString("ko-KR")}자</span>
      </summary>
      <pre className="whitespace-pre-wrap break-words px-3 pb-3 text-[13px] font-mono">{text}</pre>
    </details>
  );
}

function Step({ n, title, approved, children }: { n: number; title: string; approved: boolean; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6 space-y-4" aria-labelledby={`step-${n}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">{n}단계</span>
        <h2 id={`step-${n}`} className="text-xl font-bold">{title}</h2>
        <span className={`pill ${approved ? "pill-ok" : ""}`}>{approved ? "승인됨" : "작성 중"}</span>
      </div>
      {children}
    </section>
  );
}

function JobRow({ j, b }: { j: ReviewJob; b: ReviewBundle }) {
  const input = (j.input ?? {}) as { label?: string; message?: string; instruction?: string; expressionId?: string };
  const output = j.output as { assetId?: string } | null;
  const asset = output?.assetId ? b.assets[output.assetId] : undefined;
  const exprIndex = input.expressionId ? b.data.expressions.findIndex((e) => e.id === input.expressionId) : -1;
  const isHf = j.kind.startsWith("hf_");
  return (
    <li className="rounded-lg border border-line p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <strong>{jobLabel(j.kind)}</strong>
        {exprIndex >= 0 && <span className="pill">{exprIndex + 1}번 표정</span>}
        <span className={`pill ${j.status === "done" ? "pill-ok" : j.status === "failed" ? "pill-err" : ""}`}>{JOB_STATUS[j.status] ?? j.status}</span>
        <span className="text-muted">{fmt(j.createdAt)}</span>
      </div>
      {input.label && <p className="text-[14px]">{input.label}</p>}
      {input.message && <p className="text-[14px] whitespace-pre-wrap">요청: {input.message}</p>}
      {input.instruction && <p className="text-[14px] whitespace-pre-wrap">추가 지시: {input.instruction}</p>}
      {j.error && <p className="notice notice-error">{j.error}</p>}
      {asset && (
        <div className={asset.mime.startsWith("video/") ? "max-w-md" : "max-w-[160px]"}>
          <Media a={asset} label="생성 결과" tall={!asset.mime.startsWith("video/")} />
        </div>
      )}
      {!isHf && j.output != null && (
        <details>
          <summary className="cursor-pointer text-[14px] font-semibold">AI 결과 보기</summary>
          <pre className="whitespace-pre-wrap break-words text-[12px] font-mono mt-2">{JSON.stringify(j.output, null, 2)}</pre>
        </details>
      )}
    </li>
  );
}

export function ReviewView({ b, dataUrl }: { b: ReviewBundle; dataUrl: string }) {
  const d = b.data;
  const story = d.mode === "storyboard";
  const multi = d.cast.length > 1 && !story;
  const group = d.cast.length > 1;
  const s = d.expressionSetup;
  const f = s.framing;
  const A = (id: string | null | undefined) => (id ? b.assets[id] : undefined);
  const approved = (step: number) => d.approvedThrough >= step;
  const lineOf = (id: string) => d.dialogue.lines.find((l) => l.expressionId === id);
  const segOf = (id: string) => d.acting.segments.find((x) => x.expressionId === id);
  const indexOf = (id: string) => d.expressions.findIndex((e) => e.id === id);
  const promptOf = (id: string) => b.prompts.expressions.find((p) => p.expressionId === id);
  const video = b.prompts.video;

  return (
    <main className="mx-auto max-w-[1100px] px-4 sm:px-6 py-6 space-y-5">
      <header className="space-y-3">
        <p className="notice notice-info">
          읽기 전용 검토 화면입니다. 이 링크는 <strong>{fmt(b.link.expiresAt)}</strong>까지 열립니다. 수정은 앱에 로그인해서 하세요.
        </p>
        <h1 className="text-2xl font-bold">{d.title || b.project.name}</h1>
        <p className="text-muted">
          v{b.project.version} · 마지막 저장 {fmt(b.project.updatedAt)}
        </p>
        <ol className="flex flex-wrap gap-1" aria-label="단계 승인 상태">
          {STEPS.map((name, i) => (
            <li key={name} className={`pill ${approved(i) ? "pill-ok" : ""}`}>
              {i + 1}. {name}
              {approved(i) ? " ✓" : ""}
            </li>
          ))}
        </ol>
      </header>

      <Step n={1} title={story ? `스토리보드 · 주요 인물 ${d.cast.length}명` : multi ? `출연진 ${d.cast.length}명` : "캐릭터"} approved={approved(0)}>
        <div className="space-y-2 max-w-xl">
          <div className="field-label">{group || story ? "장면 기준 그림" : "기본 그림"}</div>
          <Media a={A(d.baseAssetId)} label={multi ? "장면 기준 그림" : "기본 그림"} />
          {d.designRefAssetIds.length > 0 && (
            <>
              <div className="field-label">추가 참고 그림</div>
              <div className="grid grid-cols-3 gap-2">
                {d.designRefAssetIds.map((id) => (
                  <Media key={id} a={A(id)} label="추가 참고" />
                ))}
              </div>
            </>
          )}
        </div>
        {d.cast.map((c) => (
          <div key={c.id} className="rounded-xl border border-line p-3">
            <div className="space-y-3 min-w-0">
              {group && <div className="font-semibold">{story ? castLabel(d, c.id) : `${castLabel(d, c.id)} · ${POSITION_LABEL[c.position]}`}</div>}
              <Field label="꼭 유지할 특징" value={c.locks} />
              <Field label="외형" value={c.appearance} />
              <Field label="의상" value={c.outfit} />
              {c.questions.length > 0 && (
                <div>
                  <div className="field-label">확인 질문</div>
                  <ul className="space-y-1">
                    {c.questions.map((q, i) => (
                      <li key={i} className="text-[14px]">
                        Q. {q.question}
                        <br />
                        A. {q.answer || <span className="text-muted">(답 없음)</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}
        <Field label="그림체 (장면 공통)" value={d.style} />
        {story && <Field label="군중·배경 인물" value={d.extras} />}
      </Step>

      <Step n={2} title={story ? "콘티" : "표정"} approved={approved(1)}>
        <p>
          표정 {d.expressions.length}개 · 구도 <strong>{FRAMING_LABEL[f]}</strong> ({FRAMING_CUT[f]}) · {imageAspectFor(d)} · 영상 길이 {d.acting.duration}초
        </p>
        {s.refAssetId && (
          <div className="max-w-sm space-y-1">
            <div className="field-label">
              표정 참고 시트 ({s.refColumns}×{s.refRows}칸, {s.transfer === "expression_only" ? "표정만 참고" : "표정과 고개 포즈 참고"})
            </div>
            <Media a={A(s.refAssetId)} label="표정 참고 시트" />
          </div>
        )}
        <Field label="씬 시놉시스·시나리오" value={s.scene} />
        {d.opening.trim() && <Field label="첫 장면 묘사" value={d.opening} />}
        <Field label="연출 지시" value={s.instruction} />
        {s.styleWarning && <p className="notice notice-warn">그림체 경고: {s.styleWarning}</p>}
        <ol className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {d.expressions.map((e, i) => {
            const dir = e.direction;
            const stale = imageIsStale(e, f, imageAspectFor(d));
            const p = promptOf(e.id);
            if (story)
              return (
                <li key={e.id} className="rounded-xl border border-line p-3 space-y-2 min-w-0">
                  <div className="font-semibold">
                    {i > 0 ? (e.link === "cut" ? "✂ " : "→ ") : ""}
                    {i + 1}번 컷 · {e.emotion || "제목 없음"}
                  </div>
                  <Media a={A(e.imageAssetId)} label={`${i + 1}번 컷 그림`} />
                  {e.sketchAssetId && (
                    <div className="max-w-[200px]">
                      <div className="field-label">러프 스케치</div>
                      <Media a={A(e.sketchAssetId)} label="러프 스케치" />
                    </div>
                  )}
                  <Field label="장면 묘사" value={e.action} />
                  <Field label="카메라" value={e.camera} />
                  {d.cast.length > 1 && <Field label="말하는 인물" value={castLabel(d, e.characterId)} />}
                  {p && <Prompt title="그림 프롬프트" text={p.prompt} />}
                </li>
              );
            return (
              <li key={e.id} className="rounded-xl border border-line p-3 space-y-2 min-w-0">
                <div className="font-semibold">
                  {i + 1}. {multi ? `${castLabel(d, e.characterId)} · ` : ""}
                  {e.emotion || "감정 미정"} <span className="text-muted font-normal">· {INTENSITY_LABEL[e.intensity]}</span>
                </div>
                <div className={multi ? "" : "max-w-[240px]"}>
                  <Media a={A(e.imageAssetId)} label={`${i + 1}번 표정 그림`} tall />
                </div>
                {stale && (
                  <p className="notice notice-warn text-[13px]">
                    지금 구도·비율과 다른 그림입니다 ({e.imageFraming ? FRAMING_LABEL[e.imageFraming] : "구도 알 수 없음"}, {e.imageAspect ?? "비율 알 수 없음"}).
                  </p>
                )}
                <p className="text-[14px]">
                  얼굴 {FACING_LABEL[dir.facing]} · 몸 {FACING_LABEL[dir.body]} · {PITCH_LABEL[dir.pitch]} · {TILT_LABEL[dir.tilt]} · 시선{" "}
                  {GAZE_LABEL[dir.gaze]} <span className="pill">{DIRECTION_STATUS[e.directionStatus] ?? e.directionStatus}</span>
                </p>
                {showsHands(f) && (
                  <Field label="팔·손 동작" value={e.gesture || "(비어 있음 — 그림 모델이 감정에 맞게 고름)"} />
                )}
                <Field label="눈썹" value={e.brows} />
                <Field label="눈" value={e.eyes} />
                <Field label="입" value={e.mouth} />
                <Field label="메모" value={e.notes} />
                {multi &&
                  e.reactions.map((r) => (
                    <Field
                      key={r.characterId}
                      label={`같은 순간 ${castLabel(d, r.characterId)}`}
                      value={`${r.emotion || "(감정 미정)"} · ${INTENSITY_LABEL[r.intensity]} · 얼굴 ${FACING_LABEL[r.direction.facing]} · 몸 ${FACING_LABEL[r.direction.body]} · 시선 ${GAZE_LABEL[r.direction.gaze]}${
                        r.gesture ? ` · 팔·손 ${r.gesture}` : ""
                      }${[r.brows, r.eyes, r.mouth].some(Boolean) ? ` · ${[r.brows, r.eyes, r.mouth].filter(Boolean).join(" / ")}` : ""}`}
                    />
                  ))}
                {p && <Prompt title="그림 프롬프트" text={p.prompt} />}
              </li>
            );
          })}
        </ol>
      </Step>

      <Step n={3} title="대사" approved={approved(2)}>
        <ul className="space-y-1">
          {d.cast.map((c) => (
            <li key={c.id}>
              목소리{group ? ` (${castLabel(d, c.id)})` : ""}: {c.voice || <span className="text-muted">(없음)</span>}
            </li>
          ))}
          <li>언어: {d.dialogue.language}</li>
        </ul>
        <ol className="space-y-2">
          {d.expressions.map((e, i) => {
            const l = lineOf(e.id);
            const seg = segOf(e.id);
            const need = estimateSpeechSeconds(l?.line ?? "");
            const have = seg ? Math.round((seg.end - seg.start) * 10) / 10 : null;
            return (
              <li key={e.id} className="rounded-lg border border-line p-3 text-[14px] space-y-1">
                <div className="font-semibold">
                  {i + 1}. {group ? `${castLabel(d, e.characterId)} · ` : ""}{e.emotion || (story ? "제목 없음" : "감정 미정")}
                </div>
                {l?.line ? <p className="text-[15px]">“{l.line}”</p> : <p className="text-muted">(대사 없음)</p>}
                {l?.meaning && <p>의미: {l.meaning}</p>}
                {l?.delivery && <p>말투: {l.delivery}</p>}
                {l?.line && (
                  <p className={have !== null && need > have ? "text-warn font-semibold" : "text-muted"}>
                    말하는 데 약 {need}초{have !== null ? ` · 구간 ${have}초` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </Step>

      <Step n={4} title="액팅 (시간 분배)" approved={approved(3)}>
        <ol className="space-y-2">
          {d.acting.segments.map((seg) => {
            const i = indexOf(seg.expressionId);
            const e = d.expressions[i];
            return (
              <li key={seg.expressionId} className="rounded-lg border border-line p-3 text-[14px] space-y-1">
                <div>
                  <strong>
                    {seg.start}–{seg.end}초
                  </strong>{" "}
                  · {i + 1}번 {e?.emotion || "표정"}
                </div>
                {lineOf(seg.expressionId)?.line && <p>“{lineOf(seg.expressionId)?.line}”</p>}
                {seg.transition && <p className="text-muted">다음 표정으로: {seg.transition}</p>}
              </li>
            );
          })}
        </ol>
      </Step>

      <Step n={5} title="영상" approved={approved(4)}>
        <p>
          화면 비율 {d.video.aspectRatio} · {d.video.startFrameAssetId ? "시작 프레임 사용" : "참고 그림 방식"}
        </p>
        <Field label="추가 연출" value={d.video.extraDirection} />
        <div className="space-y-2">
          <div className="field-label">{d.video.startFrameAssetId ? "시작 프레임" : "참고 그림 (이 순서대로 첨부)"}</div>
          <ol className="flex flex-wrap gap-3">
            {(d.video.startFrameAssetId ? [{ assetId: d.video.startFrameAssetId, label: "시작 프레임" }] : video.references).map((r, i) => (
              <li key={`${r.assetId}-${i}`} className={`${"parts" in r && r.parts ? "w-56" : "w-32"} space-y-1`}>
                {"parts" in r && r.parts ? (
                  <div className="flex gap-1">
                    {r.parts.map((p) => (
                      <div key={p.assetId} className="min-w-0 flex-1">
                        <Media a={A(p.assetId)} label={r.label} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Media a={A(r.assetId)} label={r.label} />
                )}
                <div className="text-[13px]">
                  <strong>{i + 1}.</strong> {r.label.split(" — ")[0]}
                </div>
              </li>
            ))}
          </ol>
        </div>
        <Prompt title="영상 프롬프트 (앱이 Higgsfield에 보내는 그대로)" text={video.prompt} open />
        <div className="space-y-2">
          <div className="field-label">결과 영상 ({d.video.resultAssetIds.length}개)</div>
          <div className="grid md:grid-cols-2 gap-4">
            {d.video.resultAssetIds.map((id) => (
              <Media key={id} a={A(id)} label="결과 영상" />
            ))}
          </div>
        </div>
      </Step>

      <section className="card p-5 sm:p-6 space-y-3" aria-labelledby="jobs">
        <h2 id="jobs" className="text-xl font-bold">
          생성·AI 작업 기록 <span className="text-muted text-base font-normal">최근 {b.jobs.length}개</span>
        </h2>
        <ol className="space-y-2">
          {b.jobs.map((j) => (
            <JobRow key={j.id} j={j} b={b} />
          ))}
        </ol>
      </section>

      {b.comments.length > 0 && (
        <section className="card p-5 sm:p-6 space-y-3" aria-labelledby="comments">
          <h2 id="comments" className="text-xl font-bold">검토 의견</h2>
          <ul className="space-y-2">
            {b.comments.map((cm, i) => (
              <li key={i} className={`rounded-lg border border-line p-3 text-[14px] ${cm.resolved ? "opacity-60" : ""}`}>
                <span className="pill mr-2">{STEPS[cm.step] ?? `${cm.step + 1}단계`}</span>
                {cm.resolved && <span className="pill pill-ok mr-2">해결됨</span>}
                <span className="text-muted">{fmt(cm.createdAt)}</span>
                <p className="mt-1 whitespace-pre-wrap">{cm.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5 sm:p-6 space-y-2" aria-labelledby="versions">
        <h2 id="versions" className="text-xl font-bold">버전 기록</h2>
        <ol className="text-[14px] space-y-1">
          {b.versions.map((v) => (
            <li key={v.version}>
              v{v.version} · {VERSION_KIND[v.kind] ?? v.kind}
              {v.note ? ` · ${v.note}` : ""} <span className="text-muted">· {fmt(v.createdAt)}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="text-[13px] text-muted pb-6">
        도구용 데이터(JSON): <a className="underline break-all" href={dataUrl}>{dataUrl}</a>
      </footer>
    </main>
  );
}
