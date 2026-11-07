/**
 * Server-only client for Higgsfield's official MCP server.
 *
 * Generations made through MCP are billed to the connected Higgsfield
 * account's plan credits (not the separate pay-as-you-go API balance).
 *
 * Higgsfield only accepts trusted or localhost OAuth redirect URIs, so the
 * login finishes on a localhost URL that the admin copies back into the app
 * ("paste the address bar") — see /api/higgsfield/connect.
 */
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

const MCP_URL = "https://mcp.higgsfield.ai/mcp";
const OAUTH = "https://mcp.higgsfield.ai/oauth2";
export const REDIRECT_URI = "http://localhost:3000/api/higgsfield/callback";
const SCOPE = "openid email offline_access";

/* ───────────── Connection storage (service role only) ───────────── */

export type Connection = {
  workspace_id: string;
  client_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  hf_workspace_id: string | null;
  hf_workspace_name: string | null;
  account_email: string | null;
  pending_verifier: string | null;
  pending_state: string | null;
  pending_created_at: string | null;
};

export async function getConnection(workspaceId: string): Promise<Connection | null> {
  const { data } = await supabaseAdmin()
    .from("higgsfield_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return (data as Connection) ?? null;
}

async function saveConnection(workspaceId: string, patch: Partial<Connection>) {
  const { error } = await supabaseAdmin()
    .from("higgsfield_connections")
    .upsert({ workspace_id: workspaceId, ...patch, updated_at: new Date().toISOString() });
  if (error) throw new Error("Higgsfield 연결 정보를 저장하지 못했습니다: " + error.message);
}

export async function disconnect(workspaceId: string) {
  await supabaseAdmin().from("higgsfield_connections").delete().eq("workspace_id", workspaceId);
}

/* ───────────── OAuth ───────────── */

const b64url = (buf: Buffer) => buf.toString("base64url");

async function registerClient(): Promise<string> {
  const res = await fetch(`${OAUTH}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "5Bricks Scene Acting Studio",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.client_id) throw new Error("Higgsfield 앱 등록 실패: " + (body.error_description ?? res.status));
  return body.client_id as string;
}

/** Step 1: returns the URL the admin opens to log in to Higgsfield. */
export async function startLogin(workspaceId: string): Promise<string> {
  const existing = await getConnection(workspaceId);
  const clientId = existing?.client_id ?? (await registerClient());
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  await saveConnection(workspaceId, {
    client_id: clientId,
    pending_verifier: verifier,
    pending_state: state,
    pending_created_at: new Date().toISOString(),
  });
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource: MCP_URL,
  });
  return `${OAUTH}/authorize?${q}`;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, resource: MCP_URL }),
  });
  return (await res.json()) as TokenResponse;
}

function idTokenEmail(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()).email ?? null;
  } catch {
    return null;
  }
}

/** Step 2: the admin pastes the localhost address-bar URL; exchange its code. */
export async function finishLogin(workspaceId: string, pastedUrl: string) {
  const conn = await getConnection(workspaceId);
  if (!conn?.pending_verifier || !conn.client_id) throw new Error("먼저 ‘Higgsfield 로그인 열기’를 눌러주세요.");
  if (conn.pending_created_at && Date.now() - Date.parse(conn.pending_created_at) > 15 * 60_000)
    throw new Error("로그인 시간이 지났습니다. 다시 ‘Higgsfield 로그인 열기’를 눌러주세요.");
  let url: URL;
  try {
    url = new URL(pastedUrl.trim());
  } catch {
    throw new Error("주소창 전체(http://localhost:3000/... 로 시작)를 붙여넣어 주세요.");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error("주소에 code 값이 없습니다. 로그인 후 바뀐 주소창 전체를 복사해 주세요.");
  if (url.searchParams.get("state") !== conn.pending_state)
    throw new Error("로그인 확인 값이 맞지 않습니다. 가장 최근에 연 로그인 창의 주소를 붙여넣어 주세요.");

  const t = (await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: conn.client_id,
    code_verifier: conn.pending_verifier,
  })) as TokenResponse & { id_token?: string };
  if (!t.access_token) throw new Error("Higgsfield 로그인 실패: " + (t.error_description ?? t.error ?? "알 수 없음"));
  await saveConnection(workspaceId, {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? null,
    expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    account_email: idTokenEmail(t.id_token),
    pending_verifier: null,
    pending_state: null,
    pending_created_at: null,
    connected_at: new Date().toISOString(),
  } as Partial<Connection>);
}

/** Valid access token, refreshing when it expires within 5 minutes. */
async function accessToken(workspaceId: string): Promise<{ token: string; conn: Connection }> {
  const conn = await getConnection(workspaceId);
  if (!conn?.access_token) throw new Error("Higgsfield 계정이 연결되지 않았습니다. 관리자가 ‘팀·사용량’에서 연결해 주세요.");
  const exp = conn.expires_at ? Date.parse(conn.expires_at) : 0;
  if (exp - Date.now() > 5 * 60_000) return { token: conn.access_token, conn };
  if (!conn.refresh_token || !conn.client_id) throw new Error("Higgsfield 로그인이 만료되었습니다. 관리자가 다시 연결해 주세요.");
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refresh_token, client_id: conn.client_id });
  if (!t.access_token) throw new Error("Higgsfield 로그인이 만료되었습니다. 관리자가 다시 연결해 주세요.");
  const next = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
  };
  await saveConnection(workspaceId, next);
  return { token: t.access_token, conn: { ...conn, ...next } };
}

/* ───────────── MCP (JSON-RPC over streamable HTTP) ───────────── */

export class McpSession {
  private sessionId: string | null = null;
  private id = 0;
  constructor(private token: string) {}

  private async post(method: string, params: unknown, notify = false) {
    const body: Record<string, unknown> = { jsonrpc: "2.0", method, params: params ?? {} };
    const id = ++this.id;
    if (!notify) body.id = id;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.status === 401) throw new Error("Higgsfield 로그인이 만료되었습니다. 관리자가 다시 연결해 주세요.");
    if (!res.ok && res.status !== 202) throw new Error(`Higgsfield 서버 오류 (${res.status})`);
    this.sessionId = res.headers.get("mcp-session-id") ?? this.sessionId;
    const raw = await res.text();
    if (notify || !raw.trim()) return null;
    if (raw.trimStart().startsWith("{")) return JSON.parse(raw);
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const msg = JSON.parse(line.slice(5));
      if (msg.id === id) return msg;
    }
    throw new Error("Higgsfield 응답을 읽지 못했습니다.");
  }

  async init() {
    await this.post("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "5bricks-scene-acting-studio", version: "1.0" },
    });
    await this.post("notifications/initialized", {}, true);
  }

  /** Calls a tool and returns its structuredContent (or parsed text). Throws on tool errors. */
  async call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
    const msg = await this.post("tools/call", { name, arguments: args });
    if (msg?.error) throw new Error(`Higgsfield ${name} 실패: ${msg.error.message ?? "알 수 없음"}`);
    const result = msg?.result ?? {};
    const text = (result.content ?? []).find((c: { type: string }) => c.type === "text")?.text as string | undefined;
    let out: unknown = result.structuredContent;
    if (!out && text) {
      try {
        out = JSON.parse(text);
      } catch {
        out = { text };
      }
    }
    if (result.isError) {
      const o = out as { error?: string; message?: string; text?: string } | undefined;
      throw new Error(`Higgsfield ${name} 실패: ${o?.error ?? o?.message ?? o?.text ?? "알 수 없음"}`);
    }
    return (out ?? {}) as T;
  }
}

export async function openSession(workspaceId: string) {
  const { token, conn } = await accessToken(workspaceId);
  const s = new McpSession(token);
  await s.init();
  return { s, conn };
}

export type HfWorkspace = { id: string; name: string | null; type: string; plan_type: string; credits: number; is_selected: boolean };

export async function listWorkspaces(workspaceId: string) {
  const { s } = await openSession(workspaceId);
  const r = await s.call<{ workspaces: HfWorkspace[] }>("list_workspaces", {});
  return r.workspaces ?? [];
}

export async function chooseWorkspace(workspaceId: string, hf: HfWorkspace) {
  await saveConnection(workspaceId, {
    hf_workspace_id: hf.id,
    hf_workspace_name: hf.name ?? (hf.type === "private" ? "개인 워크스페이스" : hf.id),
  });
}

/**
 * Run `fn` with the chosen Higgsfield workspace selected, then switch back to
 * whatever was selected before. Higgsfield's selection is account-wide, so this
 * keeps other apps on the same account (e.g. Claude chat) where they were.
 */
export async function withWorkspace<T>(s: McpSession, conn: Connection, fn: () => Promise<T>): Promise<T> {
  if (!conn.hf_workspace_id) throw new Error("크레딧을 쓸 Higgsfield 워크스페이스를 먼저 선택해 주세요 (팀·사용량).");
  const { workspaces } = await s.call<{ workspaces: HfWorkspace[] }>("list_workspaces", {});
  const prev = workspaces.find((w) => w.is_selected);
  const switching = prev?.id !== conn.hf_workspace_id;
  if (switching) await s.call("select_workspace", { workspace_id: conn.hf_workspace_id });
  try {
    return await fn();
  } finally {
    if (switching) {
      await s
        .call("select_workspace", prev && prev.type !== "private" ? { workspace_id: prev.id } : { clear: true })
        .catch(() => undefined);
    }
  }
}

/** Find job ids in a generation response regardless of exact nesting. */
export function findJobIds(o: unknown, out: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((x) => findJobIds(x, out));
  else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      if ((k === "job_id" || k === "jobId") && typeof v === "string") out.push(v);
      else findJobIds(v, out);
    }
  }
  return [...new Set(out)];
}
