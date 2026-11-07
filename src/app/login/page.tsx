import { LoginForm } from "./login-form";

const LOGIN_ERRORS: Record<string, string> = {
  browser: "로그인 링크를 메일을 요청한 그 브라우저에서 열어 주세요. 다른 브라우저나 휴대폰 메일 앱에서 열면 로그인이 끝나지 않습니다. 이 화면에서 링크를 다시 받으세요.",
  expired: "로그인 링크가 만료되었거나 이미 사용되었습니다. 링크를 다시 받으세요.",
  link: "로그인을 마치지 못했습니다. 링크를 다시 받아 같은 브라우저에서 열어 주세요.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm card p-8">
        <div className="flex items-center gap-2 mb-6">
          <span className="brand-mark">5</span>
          <div>
            <div className="font-bold text-lg leading-none">5BRICKS</div>
            <div className="text-xs text-muted mt-1">Scene Acting Studio</div>
          </div>
        </div>
        <h1 className="text-xl font-bold mb-1">로그인</h1>
        <p className="text-sm text-muted mb-6">팀 관리자가 등록한 이메일로 로그인하세요.</p>
        {error && (
          <p className="notice notice-error mb-4" role="alert">
            {LOGIN_ERRORS[error] ?? LOGIN_ERRORS.link}
          </p>
        )}
        <LoginForm next={next ?? "/projects"} />
      </div>
    </main>
  );
}
