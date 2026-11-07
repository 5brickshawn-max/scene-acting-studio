/**
 * Read-only review links (검토용 링크). Server only.
 *
 * A link carries a signed token: the project id, when it was made and when it
 * expires, signed with a key derived from the server's secret. Nothing is
 * stored per link, so links need no database table. "모두 끊기" writes one
 * small marker file next to the project's assets: links made before that
 * moment stop working.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const FORMAT = 1;
/** Lifetimes offered in the app, in hours. */
export const REVIEW_LINK_HOURS = [1, 24, 168] as const;
export const MAX_REVIEW_LINK_HOURS = 168;

function signingKey(): Buffer {
  const secret = process.env.REVIEW_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("검토용 링크를 서명할 서버 키가 없습니다.");
  // Derived key: the server secret itself never signs anything public.
  return createHmac("sha256", secret).update("scene-acting-studio:review-link:v1").digest();
}

const sign = (body: string) => createHmac("sha256", signingKey()).update(body).digest();

export type ReviewClaims = { projectId: string; issuedAt: number; expiresAt: number };
export type ReviewTokenCheck = { ok: true; claims: ReviewClaims } | { ok: false; reason: "invalid" | "expired" };

export function createReviewToken(projectId: string, hours: number, now = Date.now()) {
  const h = Math.min(MAX_REVIEW_LINK_HOURS, Math.max(1, Math.round(hours)));
  const payload = { v: FORMAT, p: projectId, i: now, e: now + h * 3_600_000, n: randomBytes(6).toString("base64url") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${sign(body).toString("base64url")}`, expiresAt: payload.e };
}

export function verifyReviewToken(token: string, now = Date.now()): ReviewTokenCheck {
  if (typeof token !== "string" || token.length > 600) return { ok: false, reason: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "invalid" };
  const [body, sig] = parts;
  const given = Buffer.from(sig, "base64url");
  const expected = sign(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "invalid" };
  let p: { v?: unknown; p?: unknown; i?: unknown; e?: unknown };
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (p.v !== FORMAT || typeof p.p !== "string" || !/^[0-9a-f-]{36}$/i.test(p.p) || typeof p.i !== "number" || typeof p.e !== "number")
    return { ok: false, reason: "invalid" };
  if (p.e <= now) return { ok: false, reason: "expired" };
  return { ok: true, claims: { projectId: p.p, issuedAt: p.i, expiresAt: p.e } };
}

/* ───────────── "모두 끊기": one marker file per project ───────────── */

const markerPath = (workspaceId: string, projectId: string) => `${workspaceId}/${projectId}/_review-links.json`;

/** Links issued at or before this moment (ms) no longer work. 0 = none cancelled. */
export async function reviewLinksCancelledAt(sb: SupabaseClient, workspaceId: string, projectId: string): Promise<number> {
  const { data } = await sb.storage.from("assets").download(markerPath(workspaceId, projectId));
  if (!data) return 0;
  try {
    return Number(JSON.parse(await data.text()).revokedBefore) || 0;
  } catch {
    return 0;
  }
}

export async function cancelReviewLinks(sb: SupabaseClient, workspaceId: string, projectId: string, now = Date.now()) {
  const body = JSON.stringify({ revokedBefore: now });
  const { error } = await sb.storage
    .from("assets")
    .upload(markerPath(workspaceId, projectId), new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new Error("검토용 링크를 끊지 못했습니다: " + error.message);
}
