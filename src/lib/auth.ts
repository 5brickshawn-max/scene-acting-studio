import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";

export type Role = "admin" | "editor" | "reviewer";

export type Ctx = {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
};

/**
 * Signed-in user + their workspace membership, or null if either is missing.
 * Cached per request; the JWT is verified locally (getClaims) instead of asking
 * the auth server every time.
 */
export const getCtx = cache(async (): Promise<{ ctx: Ctx | null; email: string | null }> => {
  const sb = await supabaseServer();
  const { data: claims } = await sb.auth.getClaims();
  const c = claims?.claims;
  const user = c?.sub ? { id: c.sub, email: (c.email as string | undefined) ?? undefined } : null;
  if (!user) return { ctx: null, email: null };
  const { data } = await sb
    .from("workspace_members")
    .select("workspace_id, role, workspaces(name)")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) return { ctx: null, email: user.email ?? null };
  const ws = data.workspaces as unknown as { name: string } | null;
  return {
    email: user.email ?? null,
    ctx: {
      userId: user.id,
      email: user.email ?? "",
      workspaceId: data.workspace_id as string,
      workspaceName: ws?.name ?? "작업함",
      role: data.role as Role,
    },
  };
});

export const canEdit = (role: Role) => role === "admin" || role === "editor";
