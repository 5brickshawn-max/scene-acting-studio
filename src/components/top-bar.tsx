import Link from "next/link";
import type { Ctx } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

const ROLE_LABEL = { admin: "관리자", editor: "편집자", reviewer: "검토자" } as const;

export function TopBar({ ctx, children }: { ctx: Ctx; children?: React.ReactNode }) {
  return (
    <header className="bg-white border-b border-line">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 h-16 flex items-center gap-4">
        <Link href="/projects" className="flex items-center gap-2 shrink-0" aria-label="작업 목록으로">
          <span className="brand-mark">5</span>
          <span className="hidden sm:block font-bold">Scene Acting Studio</span>
        </Link>
        <div className="flex-1 min-w-0 flex items-center gap-3">{children}</div>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/projects" className="btn btn-ghost btn-sm">작업</Link>
          <Link href="/team" className="btn btn-ghost btn-sm">팀·사용량</Link>
        </nav>
        <details className="relative">
          <summary className="btn btn-sm list-none cursor-pointer" aria-label="계정 메뉴">
            <span className="max-w-[140px] truncate">{ctx.email}</span>
          </summary>
          <div className="absolute right-0 mt-2 w-60 card p-3 z-30 shadow-lg space-y-2">
            <div className="text-sm">{ctx.workspaceName}</div>
            <div className="text-sm text-muted">{ROLE_LABEL[ctx.role]}</div>
            <SignOutButton />
          </div>
        </details>
      </div>
    </header>
  );
}
