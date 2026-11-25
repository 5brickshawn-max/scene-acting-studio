/**
 * What the team sees when an AI request fails. The API's own reason is kept: "AI 서버 오류 (400)" alone left
 * nothing to act on (2026-11-25: a 400 on the dialogue step with no way to tell why), and a 400 is never
 * fixed by trying again later.
 */
import Anthropic from "@anthropic-ai/sdk";

/** The API's reason without the JSON around it, in one line. */
export function apiReason(e: { error?: unknown; message?: string }): string {
  const body = e.error as { error?: { message?: unknown }; message?: unknown } | undefined;
  const m = typeof body?.error?.message === "string" ? body.error.message : typeof body?.message === "string" ? body.message : e.message ?? "";
  return m.replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * Whether a refused request was refused for the optional fallback (its beta header or its field): a beta that is
 * retired or not enabled for the organization, or a model with no server-side fallback, answers 400.
 */
export const refusedForFallback = (e: unknown) => e instanceof Anthropic.BadRequestError && /anthropic-beta|fallback/i.test(apiReason(e));

/** The message stored on the failed job and shown under the button. */
export function aiErrorMessage(e: unknown, readsMaterials = false): string {
  if (!(e instanceof Anthropic.APIError)) return e instanceof Error ? e.message : "알 수 없는 오류";
  if (e instanceof Anthropic.RateLimitError) return "AI 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.";
  if (e instanceof Anthropic.AuthenticationError) return "AI 키 설정을 확인해주세요 (관리자).";
  const why = apiReason(e);
  const tail = why ? ` 사유: ${why}` : "";
  if (e.status === 402 || /credit balance|billing|purchase credits/i.test(why))
    return "AI 사용 잔액이 부족합니다. 관리자가 Anthropic 콘솔의 Plans & Billing에서 충전해야 합니다.";
  if (e.status === 404) return `AI 모델을 쓸 수 없습니다 (404). 관리자가 모델 설정(CLAUDE_MODEL)을 확인해야 합니다.${tail}`;
  if (e.status === 403) return `이 AI 요청은 지금 계정에서 허용되지 않습니다 (403). 관리자가 Anthropic 콘솔의 조직·작업 공간 설정을 확인해야 합니다.${tail}`;
  if (e.status === 413 || /prompt is too long|too many tokens|request too large|exceeds? the (?:maximum|limit)/i.test(why))
    return `AI에 보내는 내용이 너무 큽니다. 상황 설정·설계 글이나 기초 자료, 그림 크기를 줄여 주세요.${tail}`;
  if (e instanceof Anthropic.BadRequestError) {
    // a picture or a PDF the API could not read
    if (/\bpdf\b|document/i.test(why) || (readsMaterials && !/image|media type|pixel/i.test(why)))
      return `AI가 기초 자료를 읽지 못했습니다 (400). PDF는 100쪽 이하·암호 없는 파일인지, 그림은 PNG·JPG인지 확인해 주세요.${tail}`;
    if (/image|media type|pixel/i.test(why)) return `AI가 그림을 읽지 못했습니다 (400). 그림을 PNG·JPG로 다시 올려 주세요.${tail}`;
    return `AI가 이 요청을 받지 않았습니다 (400). 다시 눌러도 같은 결과입니다.${tail}`;
  }
  return `AI 서버 오류 (${e.status ?? "연결"}). 잠시 후 다시 시도해주세요.`;
}

/** One line for the server log: what failed and the API's request id, to look it up. */
export function aiErrorLog(kind: string, e: unknown): string {
  if (!(e instanceof Anthropic.APIError)) return `[ai] ${kind} failed: ${e instanceof Error ? e.message : String(e)}`;
  return `[ai] ${kind} failed: ${e.status ?? "-"} ${e.type ?? "-"} ${e.requestID ?? "-"} ${apiReason(e)}`;
}
