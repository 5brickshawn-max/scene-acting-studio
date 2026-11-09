"use client";
/**
 * Shared pieces for the video prompt: building it from the saved version, the
 * "프롬프트에 적용" bar under 추가 연출, and a before/after view for fixes.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { CheckItem } from "@/lib/domain/check";
import { englishStale } from "@/lib/domain/english";
import { castLabel } from "@/lib/domain/project";
import { useEditor } from "./editor-context";
import { CopyButton } from "./ui";

export type VideoHandoffView = {
  version: number;
  recommendedModel: string;
  startFrame: string;
  references: { assetId: string; label: string; parts?: { assetId: string; expressionId: string }[] }[];
  prompt: string;
  promptKo: string;
  cameraMove: boolean;
  /** for models with a negative-prompt field */
  negativePrompt?: string;
  adjustments: { where: string; rule: string; before: string; after: string }[];
  constraints: string;
  overrides: string[];
  directorBlock: string;
  checks: CheckItem[];
};

/**
 * The video prompt built from the saved version. `auto` rebuilds it whenever a new version is
 * saved; `apply()` saves pending edits right away and rebuilds.
 */
export function useVideoPrompt(auto: boolean) {
  const { doc, projectId } = useEditor();
  const [h, setH] = useState<VideoHandoffView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/handoff?kind=video`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "프롬프트를 만들지 못했습니다.");
    return body as VideoHandoffView;
  }, [projectId]);

  const { flush } = doc;
  const apply = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if ((await flush()) === false) throw new Error("저장하지 못해 적용하지 못했습니다. 화면 위쪽의 저장 상태를 확인하세요.");
      setH(await load());
    } catch (e) {
      setError(e instanceof Error ? e.message : "적용하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [flush, load]);

  // follows the saved version, but waits until saving settles (typing saves every ~1.5 s): one rebuild, not one per save
  useEffect(() => {
    if (!auto) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      load()
        .then((body) => alive && setH(body))
        .catch(() => undefined)
        .finally(() => alive && setLoading(false));
    }, h ? 1200 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, load, doc.version]);

  return { h, loading, error, apply };
}
export type VideoPrompt = ReturnType<typeof useVideoPrompt>;

/**
 * "프롬프트에 적용": saves now and rebuilds the prompt, then says plainly whether the
 * text on screen is what the prompt uses, and shows how it went in.
 */
export function PromptApplyBar({ vp }: { vp: VideoPrompt }) {
  const { doc, canEdit } = useEditor();
  const { h, loading, error, apply } = vp;
  const empty = !doc.data.video.extraDirection.trim();
  const upToDate = !!h && h.version === doc.version && doc.status === "saved";
  const blocks = h?.directorBlock ?? "";

  let status: ReactNode;
  if (loading) status = "저장하고 프롬프트를 다시 만드는 중…";
  else if (!upToDate) status = doc.status === "saved" ? "아직 프롬프트에 반영하지 않았습니다. 버튼을 누르세요." : "저장 전입니다. 누르면 바로 저장하고 프롬프트에 넣습니다.";
  else if (empty) status = "추가 연출이 비어 있어 앱의 기본 문장을 씁니다.";
  else status = <>✓ 프롬프트에 들어 있습니다 · v{h!.version} · 프롬프트 {h!.prompt.length.toLocaleString("ko-KR")}자</>;

  return (
    <div className="rounded-lg border border-line bg-[#fbfcf9] p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <button type="button" className="btn btn-primary" disabled={loading} onClick={apply}>
            {loading ? "적용 중…" : "프롬프트에 적용"}
          </button>
        )}
        <span role="status" className={`text-[14px] ${upToDate && !empty && !loading ? "text-ok font-semibold" : "text-muted"}`}>
          {status}
        </span>
      </div>
      <p className="field-help">입력을 멈추면 자동으로 저장되고 프롬프트도 따라 바뀝니다. 버튼은 지금 바로 저장하고 확인할 때 씁니다.</p>
      {error && <p className="notice notice-error">{error}</p>}
      {upToDate && blocks && (
        <details>
          <summary className="cursor-pointer text-[14px] font-semibold">프롬프트에 들어간 모습 보기</summary>
          <pre className="whitespace-pre-wrap break-words text-[13px] font-mono mt-2">{blocks}</pre>
        </details>
      )}
      {upToDate && h && (
        <details>
          <summary className="cursor-pointer text-[14px] font-semibold">최종 프롬프트 전체 보기 ({h.prompt.length.toLocaleString("ko-KR")}자)</summary>
          <div className="mt-2 space-y-2">
            <CopyButton text={h.prompt} label="프롬프트 복사" />
            <pre className="whitespace-pre-wrap break-words text-[13px] font-mono">{h.prompt}</pre>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * 영어 정리: whether the prompts get the design as short English, the button that writes it
 * (an AI job, applied as soon as it arrives) and the English itself.
 */
export function EnglishBar() {
  const { doc, jobs, askAi, canEdit } = useEditor();
  const [sending, setSending] = useState(false);
  const d = doc.data;
  const en = d.english;
  const job = jobs.jobs.find((j) => j.kind === "write_english");
  const running = sending || job?.status === "queued" || job?.status === "running";
  const stale = englishStale(d);
  const status = running
    ? "영어로 정리하는 중… (30초 안팎)"
    : !en
      ? "아직 없음. 프롬프트에 한국어 설계가 줄여서 들어갑니다."
      : stale.length
        ? `정리 뒤에 바뀐 곳: ${stale.join(", ")} (그 부분은 한국어로 들어감)`
        : "✓ 지금 설계와 맞습니다. 구간 설명·목소리·특징이 짧은 영어로 들어갑니다.";
  const fresh = !running && en && !stale.length;
  const n = (id: string) => d.expressions.findIndex((e) => e.id === id) + 1;
  return (
    <div className="rounded-lg border border-line p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="text-[14px]">영어 정리</strong>
        {canEdit && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={running}
            onClick={async () => {
              setSending(true);
              await askAi("write_english", 4);
              setSending(false);
            }}
          >
            {running ? "정리 중…" : en ? "다시 정리" : "AI로 영어 정리"}
          </button>
        )}
        <span role="status" className={`text-[14px] ${fresh ? "text-ok font-semibold" : "text-muted"}`}>
          {status}
        </span>
      </div>
      <p className="field-help">
        팀의 한국어 설계를 영상·그림 모델이 잘 따르는 짧은 영어로 옮깁니다. 대사 원문과 추가 연출은 그대로 둡니다. 설계를 고치면 그 부분만 한국어로 돌아가니 다시 정리하세요.
      </p>
      {job?.status === "failed" && <p className="notice notice-error">{job.error ?? "영어 정리에 실패했습니다."}</p>}
      {en && (
        <details>
          <summary className="cursor-pointer text-[14px] font-semibold">영어 정리 내용 보기</summary>
          <div className="mt-2 space-y-2 text-[14px]">
            {en.cast.map((c) => (
              <div key={c.characterId} className="rounded-md border border-line p-2 space-y-1">
                {doc.data.cast.length > 1 && <div className="font-semibold">{castLabel(doc.data, c.characterId)}</div>}
                <p>
                  <strong>특징</strong> {c.look.items.join("; ")}
                </p>
                <p>
                  <strong>의상</strong> {c.outfit.text}
                </p>
                {c.voice.text && (
                  <p>
                    <strong>목소리</strong> {c.voice.text}
                  </p>
                )}
              </div>
            ))}
            <p>
              <strong>그림체</strong> {en.style.text} <span className="text-muted">({en.language.text})</span>
            </p>
            <ol className="space-y-1">
              {en.beats.map((b) => (
                <li key={b.expressionId} className="rounded-md border border-line p-2">
                  <strong>
                    {n(b.expressionId)}번 · {b.emotion}
                  </strong>{" "}
                  {b.face} {b.body} {b.transition && <span className="text-muted">→ {b.transition}</span>}
                  {b.delivery && <span className="text-muted"> · 말투: {b.delivery}</span>}
                </li>
              ))}
            </ol>
          </div>
        </details>
      )}
    </div>
  );
}

/* ───────────── before / after ───────────── */

type Op = { t: "same" | "del" | "add"; s: string };

/** Longest-common-subsequence difference of two token lists. */
function diff(A: string[], B: string[]): Op[] {
  const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      out.push({ t: "same", s: A[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "del", s: A[i++] });
    else out.push({ t: "add", s: B[j++] });
  }
  while (i < A.length) out.push({ t: "del", s: A[i++] });
  while (j < B.length) out.push({ t: "add", s: B[j++] });
  return out;
}

export const lineDiff = (a: string, b: string) => diff(a.split("\n"), b.split("\n"));

const DEL = "bg-err-soft line-through";
const ADD = "bg-ok-soft";

/** One changed line, with only the changed words marked (a rewritten phrase reads as one block). */
function WordDiff({ a, b }: { a: string; b: string }) {
  const words = (t: string) => t.split(/(?<=\s)(?=\S)/);
  const runs: Op[] = [];
  for (const o of diff(words(a), words(b))) {
    const last = runs[runs.length - 1];
    if (last && last.t === o.t) last.s += o.s;
    else runs.push({ ...o });
  }
  // removed words first, then what replaces them
  for (let k = 0; k + 1 < runs.length; k++)
    if (runs[k].t === "add" && runs[k + 1].t === "del") [runs[k], runs[k + 1]] = [runs[k + 1], runs[k]];
  return (
    <div>
      {"~ "}
      {runs.map((o, k) => (o.t === "same" ? <span key={k}>{o.s}</span> : <span key={k} className={o.t === "del" ? DEL : ADD}>{o.s}</span>))}
    </div>
  );
}

/** Short texts: before → after. Long ones: only the changed lines (one line around them), changed words marked. */
export function TextDiff({ before, after }: { before: string; after: string }) {
  if (!before.includes("\n") && !after.includes("\n"))
    return (
      <div className="text-[14px] space-y-1">
        <div className="text-muted line-through whitespace-pre-wrap">{before || "(비어 있음)"}</div>
        <div className="whitespace-pre-wrap">→ {after}</div>
      </div>
    );
  const ops = lineDiff(before, after);
  const near = (k: number) => ops.slice(Math.max(0, k - 1), k + 2).some((o) => o.t !== "same");
  const rows: ReactNode[] = [];
  let skipped = false;
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.t === "same") {
      if (!near(k)) {
        if (!skipped) rows.push(<div key={k} className="text-muted">⋯</div>);
        skipped = true;
        continue;
      }
      skipped = false;
      rows.push(<div key={k} className="text-muted">{"  "}{o.s || " "}</div>);
      continue;
    }
    skipped = false;
    // a run of removed lines followed by added ones: pair them up and mark the changed words
    let d = k;
    while (d < ops.length && ops[d].t === "del") d++;
    let a = d;
    while (a < ops.length && ops[a].t === "add") a++;
    const dels = ops.slice(k, d);
    const adds = ops.slice(d, a);
    const pairs = Math.min(dels.length, adds.length);
    for (let x = 0; x < Math.max(dels.length, adds.length); x++) {
      if (x < pairs) rows.push(<WordDiff key={`${k}-${x}`} a={dels[x].s} b={adds[x].s} />);
      else if (x < dels.length) rows.push(<div key={`${k}-d${x}`} className={DEL}>{"− "}{dels[x].s || " "}</div>);
      else rows.push(<div key={`${k}-a${x}`} className={ADD}>{"+ "}{adds[x].s || " "}</div>);
    }
    k = a - 1;
  }
  return <div className="font-mono text-[13px] whitespace-pre-wrap break-words rounded-md border border-line bg-white p-2">{rows}</div>;
}
