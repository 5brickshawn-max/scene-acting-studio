import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { aiErrorLog, aiErrorMessage, apiReason, refusedForFallback } from "@/lib/ai/errors";

/** An error as the SDK raises it for an API answer of this status and message. */
const apiError = (status: number, message: string, type = "invalid_request_error") =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers({ "request-id": "req_test" }));

describe("what the team sees when an AI request fails (2026-11-25: a bare 400 on the dialogue step)", () => {
  it("keeps the API's own reason for a refused request, and never says to try again later", () => {
    const e = apiError(400, "messages.0.content.2: Something specific was wrong with the request");
    expect(apiReason(e)).toBe("messages.0.content.2: Something specific was wrong with the request");
    const m = aiErrorMessage(e);
    expect(m).toBe("AI가 이 요청을 받지 않았습니다 (400). 다시 눌러도 같은 결과입니다. 사유: messages.0.content.2: Something specific was wrong with the request");
    expect(m).not.toContain("잠시 후");
    expect(aiErrorLog("write_dialogue", e)).toContain("write_dialogue failed: 400 invalid_request_error");
  });

  it("names the cause it can tell: balance, model, size, a picture, the materials", () => {
    expect(aiErrorMessage(apiError(400, "Your credit balance is too low to access the Anthropic API."))).toContain("AI 사용 잔액이 부족합니다");
    expect(aiErrorMessage(apiError(402, "Payment required", "billing_error"))).toContain("AI 사용 잔액이 부족합니다");
    expect(aiErrorMessage(apiError(404, "model: claude-x", "not_found_error"))).toContain("AI 모델을 쓸 수 없습니다 (404)");
    expect(aiErrorMessage(apiError(413, "Request too large", "request_too_large"))).toContain("AI에 보내는 내용이 너무 큽니다");
    expect(aiErrorMessage(apiError(400, "prompt is too long: 250000 tokens > 200000 maximum"))).toContain("AI에 보내는 내용이 너무 큽니다");
    expect(aiErrorMessage(apiError(400, "messages.0.content.1.image.source.base64: image exceeds 5 MB maximum"))).toContain("AI가 그림을 읽지 못했습니다 (400)");
    // a job that sends 기초 자료: the materials are the likely cause unless the reason names a picture
    expect(aiErrorMessage(apiError(400, "A maximum of 100 PDF pages may be provided."), false)).toContain("AI가 기초 자료를 읽지 못했습니다 (400)");
    expect(aiErrorMessage(apiError(400, "something else"), true)).toContain("AI가 기초 자료를 읽지 못했습니다 (400)");
    expect(aiErrorMessage(apiError(400, "something else"), true)).toContain("사유: something else");
  });

  it("still asks to try again for what passes: a busy or failing server", () => {
    expect(aiErrorMessage(apiError(429, "rate limited", "rate_limit_error"))).toBe("AI 요청이 몰려 있습니다. 잠시 후 다시 시도해주세요.");
    expect(aiErrorMessage(apiError(529, "Overloaded", "overloaded_error"))).toBe("AI 서버 오류 (529). 잠시 후 다시 시도해주세요.");
    expect(aiErrorMessage(apiError(500, "Internal", "api_error"))).toBe("AI 서버 오류 (500). 잠시 후 다시 시도해주세요.");
    expect(aiErrorMessage(apiError(401, "invalid x-api-key", "authentication_error"))).toBe("AI 키 설정을 확인해주세요 (관리자).");
    expect(aiErrorMessage(new Error("응답이 너무 길어 중간에 끊겼습니다."))).toBe("응답이 너무 길어 중간에 끊겼습니다.");
  });

  it("knows when the optional fallback was what the API refused, so the request can go again without it", () => {
    expect(refusedForFallback(apiError(400, "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header."))).toBe(true);
    expect(refusedForFallback(apiError(400, "fallbacks: Extra inputs are not permitted"))).toBe(true);
    expect(refusedForFallback(apiError(400, "messages: roles must alternate"))).toBe(false);
    expect(refusedForFallback(apiError(529, "Overloaded", "overloaded_error"))).toBe(false);
    expect(refusedForFallback(new Error("fallback"))).toBe(false);
  });
});
