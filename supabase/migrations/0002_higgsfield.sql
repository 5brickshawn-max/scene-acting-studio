-- Higgsfield connection (one per workspace). Tokens are only ever read by the
-- server with the service-role key: RLS is on and there are NO policies, so the
-- browser (anon/authenticated) can never select these columns.
create table if not exists higgsfield_connections (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  client_id text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  hf_workspace_id text,
  hf_workspace_name text,
  account_email text,
  connected_by uuid references auth.users(id),
  connected_at timestamptz,
  pending_verifier text,
  pending_state text,
  pending_created_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table higgsfield_connections enable row level security;
