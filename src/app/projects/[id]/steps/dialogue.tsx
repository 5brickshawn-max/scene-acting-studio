"use client";
import { castLabel, imageAspectFor, type StepIndex } from "@/lib/domain/project";
import { estimateSpeechSeconds } from "@/lib/domain/speech";
import { useEditor } from "../editor-context";
import { AiAction, Field, PanelCrop } from "../ui";
import { PendingProposal } from "../proposals";
import { StepFrame } from "./step-frame";

export function DialogueStep({ onNavigate }: { onNavigate: (s: StepIndex) => void }) {
  const { doc, assets } = useEditor();
  const { data } = doc;
  const sheet = data.expressionSetup.sheetAssetId ? assets.get(data.expressionSetup.sheetAssetId) : undefined;
  const lineOf = (id: string) => data.dialogue.lines.find((l) => l.expressionId === id) ?? { expressionId: id, line: "", meaning: "", delivery: "" };
  const setLine = (id: string, patch: Partial<ReturnType<typeof lineOf>>) =>
    doc.edit(2, (d) => {
      const existing = d.dialogue.lines.some((l) => l.expressionId === id);
      const lines = existing
        ? d.dialogue.lines.map((l) => (l.expressionId === id ? { ...l, ...patch } : l))
        : [...d.dialogue.lines, { ...lineOf(id), ...patch }];
      return { ...d, dialogue: { ...d.dialogue, lines } };
    });
  const setDialogue = (patch: Partial<typeof data.dialogue>) => doc.edit(2, (d) => ({ ...d, dialogue: { ...d.dialogue, ...patch } }));
  const setVoice = (id: string, voice: string) => doc.edit(2, (d) => ({ ...d, cast: d.cast.map((c) => (c.id === id ? { ...c, voice } : c)) }));
  const multi = data.cast.length > 1;
  const aspect = imageAspectFor(data).replace(":", "/");

  return (
    <StepFrame
      step={2}
      title="대사를 정하세요"
      intro={
        multi
          ? "표정마다 한 줄씩, 그 표정을 연기하는 인물이 말합니다. 인물마다 목소리를 따로 정해 영상에서 목소리가 섞이지 않게 합니다."
          : "표정마다 한 줄씩, 그 표정이 화면에 있는 동안 말할 수 있는 길이로 씁니다."
      }
      onNavigate={onNavigate}
    >
      <div className="grid md:grid-cols-[1fr_200px] gap-4">
        <div className="space-y-4">
          {data.cast.map((c) => (
            <Field
              key={c.id}
              label={multi ? `목소리 · ${castLabel(data, c.id)}` : "목소리"}
              multiline
              rows={3}
              value={c.voice}
              onChange={(v) => setVoice(c.id, v)}
              placeholder="예: 성인 여성, 중저음 허스키, 자음을 또렷하게"
            />
          ))}
          {multi && <p className="field-help">목소리는 나이·음높이·음색·속도가 서로 분명히 다르게 쓰세요. 대사가 없는 인물은 비워 둬도 됩니다.</p>}
        </div>
        <Field label="대사 언어" value={data.dialogue.language} onChange={(v) => setDialogue({ language: v })} />
      </div>
      <AiAction
        kind="write_dialogue"
        step={2}
        label="AI로 대사 작성"
        description={multi ? "표정을 연기하는 인물에 맞춰 대사와 인물별 목소리를 제안합니다." : "표정과 캐릭터 성격에 맞는 대사를 제안합니다."}
      />
      <PendingProposal step={2} />
      <ol className="space-y-4">
        {data.expressions.map((e, i) => {
          const l = lineOf(e.id);
          const seg = data.acting.segments.find((s) => s.expressionId === e.id);
          const need = estimateSpeechSeconds(l.line);
          const have = seg ? seg.end - seg.start : 0;
          return (
            <li key={e.id} className="rounded-xl border border-line p-4 grid sm:grid-cols-[120px_1fr] gap-4">
              <div>
                {e.imageAssetId && assets.get(e.imageAssetId) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={assets.get(e.imageAssetId)!.previewUrl} alt={`${i + 1}번 표정`} className="w-full object-contain rounded-lg border border-line checker" style={{ aspectRatio: aspect }} />
                ) : (
                  <PanelCrop asset={sheet} cols={data.expressions.length} rows={1} index={i} label={`${i + 1}번 표정`} />
                )}
                <div className="mt-1 font-semibold">{i + 1}. {e.emotion || "감정 미정"}</div>
                {multi && <div className="text-[13px] text-muted">말하는 인물: {castLabel(data, e.characterId)}</div>}
              </div>
              <div className="space-y-3">
                <Field label={multi ? `대사 · ${castLabel(data, e.characterId)}` : "대사"} value={l.line} onChange={(v) => setLine(e.id, { line: v })} />
                {l.line && (
                  <p className={`text-[13px] ${seg && need > have ? "text-warn font-semibold" : "text-muted"}`}>
                    말하는 데 약 {need}초{seg ? ` · 현재 구간 ${Math.round(have * 10) / 10}초` : ""}
                    {seg && need > have ? " — 4단계에서 구간을 늘리거나 대사를 줄이세요." : ""}
                  </p>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="의미·속마음" value={l.meaning} onChange={(v) => setLine(e.id, { meaning: v })} />
                  <Field label="말투" value={l.delivery} onChange={(v) => setLine(e.id, { delivery: v })} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </StepFrame>
  );
}
