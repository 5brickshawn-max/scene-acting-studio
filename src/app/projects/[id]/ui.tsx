"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useRef, useState } from "react";
import { uploadAsset, listWorkspaceAssets } from "@/lib/upload";
import { ASSET_KIND_LABEL, type AssetKind, type AssetView } from "@/lib/types";
import { MAX_MATERIAL_PDF_MB, MAX_SCENE_MATERIALS, type Issue } from "@/lib/domain/project";
import { JOB_LABEL, type JobKind } from "@/lib/ai/schemas";
import { useEditor } from "./editor-context";

/* ───────────── Image slot: one image, upload or reuse ───────────── */

export function ImageSlot(props: {
  assetId: string | null;
  kind: AssetKind;
  label: string;
  emptyText: string;
  /** the new asset is passed too (its pixel size tells the image's real aspect ratio) */
  onChange: (assetId: string | null, asset?: AssetView) => void;
  accept?: string;
  tall?: boolean;
  removable?: boolean;
}) {
  const { assets, addAsset, workspaceId, projectId, canEdit } = useEditor();
  const asset = props.assetId ? assets.get(props.assetId) : undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [zoom, setZoom] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const a = await uploadAsset({ file: f, kind: props.kind, workspaceId, projectId });
      addAsset(a);
      props.onChange(a.id, a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="field-label">{props.label}</div>
      <div className={`rounded-xl border border-line checker overflow-hidden grid place-items-center ${props.tall ? "h-72" : "h-48"}`}>
        {asset ? (
          asset.mime.startsWith("video/") ? (
            <video src={asset.url} controls preload="metadata" className="max-h-full max-w-full" />
          ) : (
            <button type="button" className="w-full h-full" onClick={() => setZoom(true)} aria-label={`${props.label} 크게 보기`}>
              <img src={asset.previewUrl} alt={asset.name} className="w-full h-full object-contain" />
            </button>
          )
        ) : (
          <p className="text-muted text-sm px-6 text-center">{props.emptyText}</p>
        )}
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            className="sr-only"
            accept={props.accept ?? "image/png,image/jpeg,image/webp"}
            onChange={(e) => onFile(e.target.files?.[0])}
            aria-label={`${props.label} 파일 선택`}
          />
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "올리는 중…" : asset ? "다른 파일 올리기" : "파일 올리기"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
            기존 자료에서 선택
          </button>
          {props.removable && asset && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => props.onChange(null)}>
              연결 해제
            </button>
          )}
        </div>
      )}
      {error && <p className="notice notice-error">{error}</p>}
      {picking && (
        <AssetPicker
          kinds={[props.kind, ...(props.kind === "base" ? (["design_ref"] as AssetKind[]) : [])]}
          onClose={() => setPicking(false)}
          onPick={(a) => {
            addAsset(a);
            props.onChange(a.id, a);
            setPicking(false);
          }}
        />
      )}
      {zoom && asset && <Lightbox asset={asset} onClose={() => setZoom(false)} />}
    </div>
  );
}

/* ───────────── 기초 자료: script / direction files (PDF or pictures) ───────────── */

const MATERIAL_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

const sizeText = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

/** A list of PDFs and pictures (each opens in full; the team can add several at once, reuse one, or let one go). */
export function MaterialFiles(props: { ids: string[]; onChange: (ids: string[]) => void }) {
  const { assets, addAsset, workspaceId, projectId, canEdit } = useEditor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [zoom, setZoom] = useState<AssetView | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const room = MAX_SCENE_MATERIALS - props.ids.length;

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    const bad = files.find((f) => !MATERIAL_TYPES.includes(f.type));
    const big = files.find((f) => f.type === "application/pdf" && f.size > MAX_MATERIAL_PDF_MB * 1048576);
    if (bad || big || files.length > room) {
      setError(
        bad
          ? `${bad.name}: PDF나 그림(PNG·JPG·WEBP)만 올릴 수 있습니다.`
          : big
            ? `${big.name}: PDF는 ${MAX_MATERIAL_PDF_MB}MB까지입니다. 이 장면에 필요한 쪽만 뽑아 올려 주세요.`
            : `기초 자료는 최대 ${MAX_SCENE_MATERIALS}개입니다(지금 ${room}개 더 올릴 수 있음).`,
      );
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true);
    const added: string[] = [];
    try {
      for (const f of files) {
        const a = await uploadAsset({ file: f, kind: "dialogue_ref", workspaceId, projectId });
        addAsset(a);
        added.push(a.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드 실패");
    } finally {
      if (added.length) props.onChange([...props.ids, ...added]);
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {props.ids.length > 0 && (
        <ul className="grid sm:grid-cols-2 gap-2">
          {props.ids.map((id, i) => {
            const a = assets.get(id);
            const pdf = a?.mime === "application/pdf";
            return (
              <li key={id} className="flex items-center gap-3 rounded-xl border border-line p-2 min-w-0">
                {a && !pdf ? (
                  <button type="button" className="shrink-0" onClick={() => setZoom(a)} aria-label={`기초 자료 ${i + 1} 크게 보기`}>
                    <img src={a.previewUrl} alt="" className="h-14 w-14 object-cover rounded-lg border border-line" />
                  </button>
                ) : (
                  <span className="shrink-0 h-14 w-14 rounded-lg border border-line grid place-items-center text-[13px] font-bold text-accent bg-white">
                    {a ? "PDF" : "?"}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate" title={a?.name}>
                    {i + 1}. {a?.name ?? "찾을 수 없는 자료"}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                    {a && <span>{pdf ? "PDF" : "그림"} · {sizeText(a.sizeBytes)}</span>}
                    {a && (
                      <a className="underline" href={a.url} target="_blank" rel="noreferrer">
                        열기
                      </a>
                    )}
                    {canEdit && (
                      <button type="button" className="underline" onClick={() => props.onChange(props.ids.filter((x) => x !== id))}>
                        연결 해제
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && room > 0 && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            accept={MATERIAL_TYPES.join(",")}
            onChange={(e) => onFiles(e.target.files)}
            aria-label="기초 자료 파일 선택"
          />
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "올리는 중…" : props.ids.length ? `PDF·그림 더 올리기 (${props.ids.length}/${MAX_SCENE_MATERIALS})` : "PDF·그림 올리기"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
            기존 자료에서 선택
          </button>
        </div>
      )}
      {error && <p className="notice notice-error">{error}</p>}
      {picking && (
        <AssetPicker
          kinds={["dialogue_ref"]}
          onClose={() => setPicking(false)}
          onPick={(a) => {
            addAsset(a);
            if (!props.ids.includes(a.id)) props.onChange([...props.ids, a.id]);
            setPicking(false);
          }}
        />
      )}
      {zoom && <Lightbox asset={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

export function Lightbox({ asset, onClose }: { asset: AssetView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto rounded-xl p-0 max-w-[95vw] max-h-[92vh] backdrop:bg-black/50">
      <div className="flex items-center justify-between p-3 border-b border-line gap-4">
        <span className="font-semibold truncate">{asset.name}</span>
        <div className="flex gap-2">
          <a className="btn btn-sm" href={asset.url} target="_blank" rel="noreferrer">원본 열기</a>
          <button className="btn btn-sm" onClick={() => ref.current?.close()} autoFocus>닫기</button>
        </div>
      </div>
      <img src={asset.url} alt={asset.name} className="max-h-[80vh] max-w-[92vw] object-contain bg-white" />
    </dialog>
  );
}

export function AssetPicker(props: { kinds: AssetKind[]; onPick: (a: AssetView) => void; onClose: () => void }) {
  const { workspaceId } = useEditor();
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<AssetView[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    ref.current?.showModal();
    listWorkspaceAssets(workspaceId, props.kinds).then(setItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shown = (items ?? []).filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <dialog ref={ref} onClose={props.onClose} className="m-auto rounded-xl p-5 w-[min(960px,94vw)] backdrop:bg-black/50">
      <div className="flex items-center justify-between mb-4 gap-4">
        <h2 className="section-title">기존 자료에서 선택</h2>
        <button className="btn btn-sm" onClick={() => ref.current?.close()}>닫기</button>
      </div>
      <input className="input mb-4" placeholder="파일 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="자료 검색" />
      {items === null ? (
        <p className="text-muted">불러오는 중…</p>
      ) : shown.length === 0 ? (
        <p className="text-muted">선택할 수 있는 자료가 없습니다.</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-[60vh] overflow-auto">
          {shown.map((a) => (
            <li key={a.id}>
              <button className="w-full text-left card overflow-hidden hover:border-accent" onClick={() => props.onPick(a)}>
                {a.mime === "application/pdf" ? (
                  <span className="w-full h-32 grid place-items-center text-lg font-bold text-accent bg-white">PDF</span>
                ) : (
                  <img src={a.previewUrl} alt="" className="w-full h-32 object-contain checker" />
                )}
                <div className="p-2">
                  <div className="text-sm font-semibold truncate">{a.name}</div>
                  <div className="text-[13px] text-muted">{ASSET_KIND_LABEL[a.kind]}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}

/* ───────────── Panel crop: show one cell of a grid sheet ───────────── */

export function PanelCrop(props: { asset: AssetView | undefined; cols: number; rows: number; index: number; label: string }) {
  const { asset, cols, rows, index } = props;
  if (!asset || index < 0 || index >= cols * rows) {
    return <div className="aspect-[3/4] rounded-lg border border-dashed border-line-strong grid place-items-center text-[13px] text-muted">없음</div>;
  }
  const col = index % cols;
  const row = Math.floor(index / cols);
  const ratio = asset.width && asset.height ? asset.width / cols / (asset.height / rows) : 0.75;
  return (
    <div
      role="img"
      aria-label={props.label}
      className="w-full rounded-lg border border-line bg-white"
      style={{
        aspectRatio: String(ratio),
        backgroundImage: `url("${asset.previewUrl}")`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${cols > 1 ? (col / (cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

/* ───────────── Small helpers ───────────── */

export function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "복사됨 ✓" : label}
    </button>
  );
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <p className="notice notice-ok">확인할 문제가 없습니다.</p>;
  return (
    <ul className="space-y-1" aria-label="확인할 점">
      {issues.map((i, n) => (
        <li key={n} className={`notice ${i.level === "block" ? "notice-error" : "notice-warn"}`}>
          <strong className="mr-1">{i.level === "block" ? "필수" : "확인"}</strong>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

/** One AI action button + live status of its latest job. The only place each AI action lives. */
export function AiAction(props: {
  kind: JobKind;
  step: number;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
  instruction?: string;
  description?: string;
  /** analyze_character: the cast member this button analyzes (its own running/failed state) */
  characterId?: string;
}) {
  const { jobs, askAi, canEdit } = useEditor();
  const latest = jobs.jobs.find(
    (j) => j.kind === props.kind && j.step === props.step && (!props.characterId || j.input?.characterId === props.characterId),
  );
  const running = latest && (latest.status === "queued" || latest.status === "running");
  const [sending, setSending] = useState(false);
  // the request itself was refused (daily limit, permission …): say so here, not only in the side panel
  const [refused, setRefused] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-dark"
          disabled={!canEdit || props.disabled || running || sending}
          onClick={async () => {
            setSending(true);
            setRefused(false);
            const id = await askAi(props.kind, props.step, { instruction: props.instruction, characterId: props.characterId });
            setRefused(!id);
            setSending(false);
          }}
        >
          {running ? "AI 작업 중…" : props.label}
        </button>
        {props.description && <span className="text-sm text-muted">{props.description}</span>}
      </div>
      {props.disabled && props.disabledReason && <p className="field-help">{props.disabledReason}</p>}
      {running && (
        <p className="notice notice-info" aria-live="polite">
          {JOB_LABEL[props.kind]} 중입니다. 창을 닫아도 서버에서 계속되며, 결과는 바로 적용되지 않고 제안으로 도착합니다.
        </p>
      )}
      {refused && <p className="notice notice-error">{jobs.requestError ?? "AI 요청을 보내지 못했습니다. 저장 상태를 확인하고 다시 시도하세요."}</p>}
      {!refused && latest?.status === "failed" && <p className="notice notice-error">{latest.error ?? "실패했습니다."}</p>}
    </div>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  help?: string;
  rows?: number;
  placeholder?: string;
}) {
  const { canEdit } = useEditor();
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>{props.label}</label>
      {props.multiline ? (
        <textarea
          id={id}
          className="textarea"
          rows={props.rows ?? 4}
          value={props.value}
          placeholder={props.placeholder}
          disabled={!canEdit}
          onChange={(e) => props.onChange(e.target.value)}
        />
      ) : (
        <input id={id} className="input" value={props.value} placeholder={props.placeholder} disabled={!canEdit} onChange={(e) => props.onChange(e.target.value)} />
      )}
      {props.help && <p className="field-help">{props.help}</p>}
    </div>
  );
}

export function Seg<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  /** options that cannot be picked right now (shown, but disabled) */
  disabledOptions?: readonly T[];
}) {
  const { canEdit } = useEditor();
  return (
    <div role="group" aria-label={props.label}>
      <div className="text-[13px] font-semibold mb-1 text-muted">{props.label}</div>
      <div className="seg">
        {props.options.map((o) => (
          <button key={o} type="button" aria-pressed={props.value === o} disabled={!canEdit || (props.value !== o && props.disabledOptions?.includes(o))} onClick={() => props.onChange(o)}>
            {props.labels[o]}
          </button>
        ))}
      </div>
    </div>
  );
}
