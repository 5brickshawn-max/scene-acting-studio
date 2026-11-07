"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function SignOutButton() {
  return (
    <button
      className="btn btn-sm w-full"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        window.location.href = "/login";
      }}
    >
      로그아웃
    </button>
  );
}
