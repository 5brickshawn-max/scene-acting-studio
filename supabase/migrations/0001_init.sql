-- Scene Acting Studio — initial schema
-- Run in Supabase SQL editor (or `supabase db push`).


-- ───────────────────────── Workspaces & members ─────────────────────────
create type member_role as enum ('admin', 'editor', 'reviewer');

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  daily_ai_limit int not null default 60,
  storage_limit_mb int not null default 2000,
  created_at timestamptz not null default now()
);

-- A member row can exist before the person signs in (invite by email).
-- user_id is filled automatically on first sign-in (see trigger below).
create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  user_id uuid references auth.users(id) on delete set null,
  role member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);
create index on workspace_members(user_id);

create or replace function link_member_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update workspace_members set user_id = new.id
   where lower(email) = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_member_on_signup();

-- And the reverse: invite someone who has already signed in once.
create or replace function link_member_on_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.email := lower(new.email);
  if new.user_id is null then
    select id into new.user_id from auth.users where lower(email) = new.email limit 1;
  end if;
  return new;
end $$;

create trigger on_member_invited
  before insert on workspace_members
  for each row execute function link_member_on_invite();

-- Helper: role of current user in a workspace (null if not a member)
create or replace function my_role(ws uuid) returns member_role
language sql stable security definer set search_path = public as $$
  select role from workspace_members
   where workspace_id = ws and user_id = auth.uid()
$$;

create or replace function can_edit(ws uuid) returns boolean
-- coalesce: a non-member must yield FALSE, never NULL (NULL would slip past `if not ...`)
language sql stable as $$ select coalesce(my_role(ws) in ('admin','editor'), false) $$;

create or replace function is_member(ws uuid) returns boolean
language sql stable as $$ select my_role(ws) is not null $$;

-- ───────────────────────── Projects & versions ─────────────────────────
-- One project = one scene (a cast of 1–4). Every save appends a version; nothing is
-- ever duplicated into a new project to "recover" it.
create type project_status as enum ('active', 'archived', 'trashed');

create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  status project_status not null default 'active',
  current_version int not null default 0,
  current_step int not null default 0,
  approved_through int not null default -1,
  thumbnail_asset_id uuid,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on projects(workspace_id, status, updated_at desc);

create type version_kind as enum ('create', 'save', 'approve', 'unapprove', 'ai_apply', 'restore');

create table project_versions (
  project_id uuid not null references projects(id) on delete cascade,
  version int not null,
  kind version_kind not null,
  note text,
  data jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, version)
);

-- Atomic save with optimistic concurrency.
-- Returns the new version number, or raises 'version_conflict' (P0001)
-- when someone else saved first. The client then shows a compare dialog.
create or replace function save_project(
  p_project_id uuid,
  p_expected_version int,
  p_data jsonb,
  p_kind version_kind default 'save',
  p_note text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_current int;
  v_next int;
begin
  select workspace_id, current_version into v_ws, v_current
    from projects where id = p_project_id for update;
  if v_ws is null then raise exception 'not_found'; end if;
  if not can_edit(v_ws) then raise exception 'forbidden'; end if;
  if v_current <> p_expected_version then
    raise exception 'version_conflict' using detail = v_current::text;
  end if;
  v_next := v_current + 1;
  insert into project_versions(project_id, version, kind, note, data, created_by)
    values (p_project_id, v_next, p_kind, p_note, p_data, auth.uid());
  update projects set
    current_version = v_next,
    name = coalesce(nullif(p_data->>'title', ''), name),
    current_step = coalesce((p_data->>'currentStep')::int, current_step),
    approved_through = coalesce((p_data->>'approvedThrough')::int, approved_through),
    thumbnail_asset_id = coalesce(nullif(p_data->'cast'->0->>'baseAssetId','')::uuid, thumbnail_asset_id),
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_project_id;
  return v_next;
end $$;

create or replace function create_project(p_workspace_id uuid, p_name text, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not can_edit(p_workspace_id) then raise exception 'forbidden'; end if;
  insert into projects(workspace_id, name, current_version, created_by, updated_by)
    values (p_workspace_id, p_name, 1, auth.uid(), auth.uid()) returning id into v_id;
  insert into project_versions(project_id, version, kind, data, created_by)
    values (v_id, 1, 'create', p_data, auth.uid());
  return v_id;
end $$;

-- Rename = a new version with the scene title changed, so name and data never drift.
create or replace function rename_project(p_project_id uuid, p_name text) returns int
language plpgsql security definer set search_path = public as $$
declare v_cur int; v_data jsonb;
begin
  select current_version into v_cur from projects where id = p_project_id;
  select data into v_data from project_versions where project_id = p_project_id and version = v_cur;
  return save_project(p_project_id, v_cur, jsonb_set(v_data, '{title}', to_jsonb(p_name)), 'save', '이름 변경');
end $$;

-- ───────────────────────── Assets ─────────────────────────
create type asset_kind as enum (
  'base',            -- character base drawing
  'design_ref',      -- extra design reference
  'expression_ref',  -- another character's expression sheet (expression only)
  'sheet',           -- generated expression sheet (from Higgsfield)
  'dialogue_ref',
  'acting_ref',
  'video'            -- generated video result
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  kind asset_kind not null,
  name text not null,
  storage_path text not null unique,
  mime text not null,
  size_bytes bigint not null,
  width int,
  height int,
  meta jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on assets(workspace_id, project_id, created_at desc);

-- ───────────────────────── AI jobs ─────────────────────────
-- Every AI call is a job row. Results are proposals: they are NEVER written
-- into project data until a person presses "적용".
create type job_status as enum ('queued', 'running', 'done', 'failed');

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null,
  step int not null,
  status job_status not null default 'queued',
  input jsonb not null default '{}',
  output jsonb,
  error text,
  based_on_version int not null,
  applied_version int,
  input_tokens int,
  output_tokens int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on ai_jobs(project_id, created_at desc);
create index on ai_jobs(workspace_id, created_at);

-- ───────────────────────── Review comments ─────────────────────────
create table review_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  step int not null,
  target text not null default 'all',       -- 'all' or expression id
  body text not null,
  resolved boolean not null default false,
  author_id uuid references auth.users(id),
  author_email text,
  created_at timestamptz not null default now()
);
create index on review_comments(project_id, created_at);

-- ───────────────────────── RLS ─────────────────────────
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table projects enable row level security;
alter table project_versions enable row level security;
alter table assets enable row level security;
alter table ai_jobs enable row level security;
alter table review_comments enable row level security;

create policy ws_read on workspaces for select using (is_member(id));
create policy ws_update on workspaces for update using (my_role(id) = 'admin');

create policy wm_read on workspace_members for select using (is_member(workspace_id));
create policy wm_admin_ins on workspace_members for insert with check (my_role(workspace_id) = 'admin');
create policy wm_admin_upd on workspace_members for update using (my_role(workspace_id) = 'admin');
create policy wm_admin_del on workspace_members for delete using (my_role(workspace_id) = 'admin' and user_id is distinct from auth.uid());

create policy pj_read on projects for select using (is_member(workspace_id));
-- inserts/data changes go through create_project / save_project
create policy pj_update on projects for update using (can_edit(workspace_id));
-- Direct updates may only change status (archive / trash / restore).
revoke update on projects from authenticated;
grant update (status) on projects to authenticated;

create policy pv_read on project_versions for select
  using (exists (select 1 from projects p where p.id = project_id and is_member(p.workspace_id)));

create policy as_read on assets for select using (is_member(workspace_id));
create policy as_ins on assets for insert with check (can_edit(workspace_id));
create policy as_upd on assets for update using (can_edit(workspace_id));

create policy job_read on ai_jobs for select using (is_member(workspace_id));
-- jobs are created/run only by the server (service role). Editors may only
-- record that they applied a result.
create policy job_mark_applied on ai_jobs for update using (can_edit(workspace_id));
revoke update on ai_jobs from authenticated;
grant update (applied_version) on ai_jobs to authenticated;

create policy rc_read on review_comments for select
  using (exists (select 1 from projects p where p.id = project_id and is_member(p.workspace_id)));
create policy rc_ins on review_comments for insert with check (
  author_id = auth.uid() and
  exists (select 1 from projects p where p.id = project_id and is_member(p.workspace_id)));
create policy rc_upd on review_comments for update using (
  exists (select 1 from projects p where p.id = project_id and is_member(p.workspace_id)));

-- ───────────────────────── Storage ─────────────────────────
-- Private bucket. Object path: <workspace_id>/<project_id or 'shared'>/<uuid>.<ext>
insert into storage.buckets (id, name, public) values ('assets', 'assets', false)
  on conflict (id) do nothing;

create policy st_read on storage.objects for select
  using (bucket_id = 'assets' and is_member(((storage.foldername(name))[1])::uuid));
create policy st_write on storage.objects for insert
  with check (bucket_id = 'assets' and can_edit(((storage.foldername(name))[1])::uuid));

-- ───────────────────────── Bootstrap ─────────────────────────
-- Replace the email below with the first admin's sign-in email, then run.
-- insert into workspaces(name) values ('5Bricks 공용 작업함');
-- insert into workspace_members(workspace_id, email, role)
--   select id, 'you@example.com', 'admin' from workspaces where name = '5Bricks 공용 작업함';
