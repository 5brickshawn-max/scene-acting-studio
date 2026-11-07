import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
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
        <LoginForm next={next ?? "/projects"} />
      </div>
    </main>
  );
}
