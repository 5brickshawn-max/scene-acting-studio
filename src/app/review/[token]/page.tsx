import type { Metadata } from "next";
import { openReview, REVIEW_FAIL_MESSAGE } from "@/lib/review-data";
import { ReviewView } from "./view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "검토용 보기 · 씬 액팅 스튜디오",
  robots: { index: false, follow: false },
  // The token is in the URL: never send it to other sites as a referrer.
  referrer: "no-referrer",
};

/** Read-only review of one project, opened with a signed review link instead of a login. */
export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await openReview(token);
  if (!r.ok)
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <div className="card p-6 space-y-3">
          <h1 className="text-xl font-bold">검토용 링크</h1>
          <p className="notice notice-warn">{REVIEW_FAIL_MESSAGE[r.reason]}</p>
        </div>
      </main>
    );
  return <ReviewView b={r.bundle} dataUrl={`/api/review/${token}`} />;
}
