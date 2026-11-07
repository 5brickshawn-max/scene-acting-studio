import { SignOutButton } from "./sign-out-button";

export function NoAccess({ email }: { email: string | null }) {
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="card p-8 max-w-md space-y-3">
        <h1 className="text-xl font-bold">작업함 접근 권한이 없습니다</h1>
        <p className="text-muted">
          <strong className="text-ink">{email}</strong> 계정은 아직 팀에 등록되지 않았습니다. 관리자에게 이 이메일을
          등록해 달라고 요청하세요. 등록되면 다시 로그인하면 됩니다.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
