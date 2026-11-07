"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function google() {
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    if (error) setError(error.message);
  }

  async function magic(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: true },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="space-y-4">
      {/* shown only when Google sign-in is turned on in Supabase (otherwise the button only errors) */}
      {process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN === "1" && (
        <>
          <button className="btn btn-dark w-full" onClick={google}>
            Google 계정으로 로그인
          </button>
          <div className="text-center text-sm text-muted">또는</div>
        </>
      )}
      {sent ? (
        <p className="notice notice-ok">로그인 링크를 {email}로 보냈습니다. 메일함을 확인하고, 링크는 지금 이 브라우저에서 열어 주세요.</p>
      ) : (
        <form onSubmit={magic} className="space-y-2">
          <label className="field-label" htmlFor="email">이메일</label>
          <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn w-full" type="submit">이메일로 로그인 링크 받기</button>
        </form>
      )}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </div>
  );
}
