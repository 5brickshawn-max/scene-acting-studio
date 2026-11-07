import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "씬 액팅 스튜디오 · 5Bricks",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
