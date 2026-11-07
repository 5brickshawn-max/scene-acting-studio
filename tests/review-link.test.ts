import { beforeAll, describe, expect, it } from "vitest";

const PROJECT = "3f2b8c1e-6a4d-4e2f-9b7a-1c2d3e4f5a6b";
let mod: typeof import("@/lib/review-link");

beforeAll(async () => {
  process.env.REVIEW_LINK_SECRET = "test-secret-for-review-links";
  mod = await import("@/lib/review-link");
});

describe("review links", () => {
  it("accepts a fresh link and returns its project and times", () => {
    const now = Date.UTC(2026, 10, 5, 3, 0, 0);
    const { token, expiresAt } = mod.createReviewToken(PROJECT, 24, now);
    expect(expiresAt).toBe(now + 24 * 3_600_000);
    const r = mod.verifyReviewToken(token, now + 1000);
    expect(r).toEqual({ ok: true, claims: { projectId: PROJECT, issuedAt: now, expiresAt } });
  });

  it("each link is different even when made at the same moment", () => {
    const now = Date.now();
    expect(mod.createReviewToken(PROJECT, 1, now).token).not.toBe(mod.createReviewToken(PROJECT, 1, now).token);
  });

  it("rejects expired links as expired", () => {
    const now = Date.now();
    const { token } = mod.createReviewToken(PROJECT, 1, now);
    expect(mod.verifyReviewToken(token, now + 3_600_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects edited links: another project, longer expiry, or a broken signature", () => {
    const { token } = mod.createReviewToken(PROJECT, 1);
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const forge = (p: object) => `${Buffer.from(JSON.stringify(p)).toString("base64url")}.${sig}`;
    expect(mod.verifyReviewToken(forge({ ...payload, p: "00000000-0000-4000-8000-000000000000" })).ok).toBe(false);
    expect(mod.verifyReviewToken(forge({ ...payload, e: payload.e + 9e9 })).ok).toBe(false);
    expect(mod.verifyReviewToken(`${body}.${sig.slice(0, -2)}AA`).ok).toBe(false);
    expect(mod.verifyReviewToken("garbage").ok).toBe(false);
    expect(mod.verifyReviewToken("").ok).toBe(false);
  });

  it("links signed with another server key do not work", async () => {
    const { token } = mod.createReviewToken(PROJECT, 1);
    process.env.REVIEW_LINK_SECRET = "a-different-server";
    expect(mod.verifyReviewToken(token)).toEqual({ ok: false, reason: "invalid" });
    process.env.REVIEW_LINK_SECRET = "test-secret-for-review-links";
  });

  it("clamps the lifetime to 1 hour … 7 days", () => {
    const now = Date.now();
    expect(mod.createReviewToken(PROJECT, 0, now).expiresAt).toBe(now + 3_600_000);
    expect(mod.createReviewToken(PROJECT, 9999, now).expiresAt).toBe(now + 168 * 3_600_000);
  });
});
