import type { Metadata } from "next";
import "./globals.css";

/** The test version (a Vercel preview build, e.g. the `test` branch) says so everywhere. */
const IS_TEST = process.env.VERCEL_ENV === "preview";

export const metadata: Metadata = {
  title: `${IS_TEST ? "[시험] " : ""}씬 액팅 스튜디오 · 5Bricks`,
  description: "출연진(1~4명) → 표정 → 대사 → 액팅 → 영상 프롬프트",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="antialiased">
        {IS_TEST && (
          <div role="note" className="bg-[#c2410c] text-white text-[13px] font-semibold text-center px-4 py-1.5">
            시험 버전 — 새 기능을 먼저 써 보는 주소입니다. 실제 앱과 같은 데이터에 저장되니 시험용 프로젝트로 써 보세요.
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
