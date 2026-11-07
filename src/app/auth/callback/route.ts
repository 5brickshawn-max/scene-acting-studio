import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Finishes an email-link (or OAuth) sign-in. A failed exchange — most often a link opened in another
 * browser or a phone's mail app (the PKCE verifier cookie is not there), or an expired link — goes back to
 * the login page with a reason instead of silently looping to /login.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") || "/projects";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/projects";
  const fail = (reason: string) => {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", reason);
    url.searchParams.set("next", safeNext);
    return NextResponse.redirect(url);
  };
  // Supabase reports an expired or used link with error parameters
  const linkError = req.nextUrl.searchParams.get("error_code") || req.nextUrl.searchParams.get("error");
  if (linkError) return fail(/expired/i.test(linkError + (req.nextUrl.searchParams.get("error_description") ?? "")) ? "expired" : "link");
  if (!code) return fail("link");
  const sb = await supabaseServer();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return fail(/verifier|pkce/i.test(error.message) ? "browser" : /expired/i.test(error.message) ? "expired" : "link");
  return NextResponse.redirect(new URL(safeNext, req.url));
}
