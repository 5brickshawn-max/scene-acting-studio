/**
 * Fixes from the render check (렌더 전 점검), applied by the team with one click.
 *
 * - The director's text (추가 연출) belongs to the video step: a fix replaces it.
 * - Texts of earlier, approved steps (a transition, a gesture, a delivery …) are not changed:
 *   the fix is kept as a prompt-only fix (video.promptFixes) and used in the video prompt while
 *   the step still holds the text the fix was made for. So no approval is re-opened behind the
 *   team's back, and the expression images (drawn from the approved design) stay valid.
 */
import { castLabel, reopenFrom, type ProjectData, type PromptFix, type PromptFixTarget } from "./project";
import { retime } from "./timing";

export const AI_FIX_TARGETS = ["direction", "transition", "gesture", "notes", "delivery", "voice"] as const;
export type AiFixTarget = (typeof AI_FIX_TARGETS)[number];
/** Results saved while there was a separate camera field may still name it; those fixes can no longer apply. */
type StoredFixTarget = AiFixTarget | "camera";

export const FIX_TARGET_LABEL: Record<StoredFixTarget, string> = {
  camera: "카메라 연출 (없어진 칸)",
  direction: "추가 연출",
  transition: "다음 표정으로 넘어가는 연기",
  gesture: "팔·손 동작",
  notes: "표정 메모",
  delivery: "대사 말투",
  voice: "목소리",
};

/** A text fix written by the AI check, resolved against the version it checked. */
export type CheckTextFix = {
  target: StoredFixTarget;
  /** expression number as the AI wrote it (1-based; for "voice" the cast number), null for direction */
  expression: number | null;
  text: string;
  /** the expression id (for "voice": the cast member's id) */
  expressionId: string | null;
  /** the team's text when the check ran */
  before: string;
};

const isPromptOnly = (t: StoredFixTarget): t is PromptFixTarget => t !== "camera" && t !== "direction";

/** The team's current text for a target (null when that field, expression or line no longer exists). */
export function currentText(data: ProjectData, target: StoredFixTarget, expressionId: string | null): string | null {
  switch (target) {
    case "camera":
      return null;
    case "direction":
      return data.video.extraDirection;
    case "voice":
      return data.cast.find((c) => c.id === expressionId)?.voice ?? null;
    case "transition":
      return data.acting.segments.find((s) => s.expressionId === expressionId)?.transition ?? null;
    case "delivery":
      return data.dialogue.lines.find((l) => l.expressionId === expressionId)?.delivery ?? null;
    case "gesture":
    case "notes":
      return data.expressions.find((e) => e.id === expressionId)?.[target] ?? null;
  }
}

/** "3번 표정 팔·손 동작", "추가 연출" */
export function fixWhere(data: ProjectData, target: StoredFixTarget, expressionId: string | null): string {
  if (target === "voice") return data.cast.length > 1 && expressionId ? `${castLabel(data, expressionId)} ${FIX_TARGET_LABEL.voice}` : FIX_TARGET_LABEL.voice;
  const n = data.expressions.findIndex((e) => e.id === expressionId) + 1;
  return n > 0 && isPromptOnly(target) ? `${n}번 표정 ${FIX_TARGET_LABEL[target]}` : FIX_TARGET_LABEL[target];
}

/** Ties an AI fix to the exact text it replaces (on the server, against the checked version). */
export function resolveFix(
  data: ProjectData,
  fix: { target: AiFixTarget; expression: number | null; text: string },
): CheckTextFix | null {
  const perExpression = isPromptOnly(fix.target) && fix.target !== "voice";
  const expressionId = perExpression
    ? data.expressions[(fix.expression ?? 0) - 1]?.id ?? null
    : fix.target === "voice"
      ? data.cast[(fix.expression ?? 1) - 1]?.id ?? null
      : null;
  if ((perExpression || fix.target === "voice") && !expressionId) return null;
  const before = currentText(data, fix.target, expressionId);
  const text = fix.text.trim();
  if (before === null || !text || text === before.trim()) return null;
  return { target: fix.target, expression: fix.expression, text, expressionId, before };
}

/** ready = can be applied · applied = already in use · changed = the text changed after the check */
export function fixState(data: ProjectData, fix: CheckTextFix): "ready" | "applied" | "changed" {
  const now = currentText(data, fix.target, fix.expressionId);
  if (now === null) return "changed";
  if (!isPromptOnly(fix.target)) return now === fix.text ? "applied" : now === fix.before ? "ready" : "changed";
  if (now !== fix.before) return "changed";
  const used = data.video.promptFixes.some(
    (f) => f.target === fix.target && f.expressionId === fix.expressionId && f.before === fix.before && f.after === fix.text,
  );
  return used ? "applied" : "ready";
}

/** Apply one AI fix. Only the video step's approval is re-opened. */
export function applyTextFix(data: ProjectData, fix: CheckTextFix, note: string): ProjectData {
  if (fix.target === "camera") return data;
  if (fix.target === "direction") return reopenFrom({ ...data, video: { ...data.video, extraDirection: fix.text } }, 4);
  const target = fix.target;
  const others = data.video.promptFixes.filter((f) => !(f.target === target && f.expressionId === fix.expressionId));
  const next: PromptFix = { target, expressionId: fix.expressionId, before: fix.before, after: fix.text, note };
  return reopenFrom({ ...data, video: { ...data.video, promptFixes: [...others, next] } }, 4);
}

/** Prompt-only fixes with where they apply and whether they are still in use. */
export function promptFixRows(data: ProjectData): { fix: PromptFix; where: string; active: boolean }[] {
  return data.video.promptFixes.map((fix) => ({
    fix,
    where: fixWhere(data, fix.target, fix.expressionId),
    active: currentText(data, fix.target, fix.expressionId) === fix.before,
  }));
}

export function removePromptFix(data: ProjectData, fix: PromptFix): ProjectData {
  return reopenFrom({ ...data, video: { ...data.video, promptFixes: data.video.promptFixes.filter((f) => f !== fix) } }, 4);
}

/* ───────────── fixes of the instant check ───────────── */

/** Stretch the time marks of 추가 연출 (a camera plan's "0–3s …") to the video length. */
export function applyRetime(data: ProjectData, to: number): ProjectData {
  const { text, changes } = retime(data.video.extraDirection, to);
  return changes.length ? reopenFrom({ ...data, video: { ...data.video, extraDirection: text } }, 4) : data;
}

/** Put the scene's camera sentences at the end of 추가 연출. */
export function appendDirection(data: ProjectData, text: string): ProjectData {
  const now = data.video.extraDirection.trimEnd();
  if (!text.trim() || now.includes(text.trim())) return data;
  return reopenFrom({ ...data, video: { ...data.video, extraDirection: now ? `${now}\n\n${text.trim()}` : text.trim() } }, 4);
}
