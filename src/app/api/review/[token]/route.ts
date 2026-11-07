import { NextResponse } from "next/server";
import { openReview, REVIEW_FAIL_MESSAGE } from "@/lib/review-data";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

/** Read-only review data as JSON (for tools). Public: access is the signed link itself. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await openReview(token);
  if (!r.ok) return NextResponse.json({ error: REVIEW_FAIL_MESSAGE[r.reason], reason: r.reason }, { status: r.reason === "missing" ? 404 : 403, headers: HEADERS });
  return NextResponse.json(r.bundle, { headers: HEADERS });
}
