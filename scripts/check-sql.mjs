// Runs the Supabase migration in an in-memory Postgres (PGlite) with stubbed
// auth/storage schemas, then checks versioned saves, conflicts and RLS.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();
await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text);
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema public, auth to authenticated;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on functions to authenticated;`);
await db.exec(fs.readFileSync(new URL("../supabase/migrations/0001_init.sql", import.meta.url), "utf8"));

const A = "11111111-1111-1111-1111-111111111111", O = "22222222-2222-2222-2222-222222222222", R = "33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users values ('${A}','admin@x.com');
insert into workspaces(name) values ('WS');
insert into workspace_members(workspace_id,email,role) select id,'Admin@X.com','admin' from workspaces;
insert into workspace_members(workspace_id,email,role) select id,'r@x.com','reviewer' from workspaces;
insert into auth.users values ('${O}','o@x.com'), ('${R}','r@x.com');`);
const ws = (await db.query(`select id from workspaces`)).rows[0].id;

async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('test.uid','${uid}',false); set role authenticated;`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
}
const fails = async (p, re) => { await assert.rejects(p, re); };
let n = 0; const ok = (msg) => console.log(`✓ ${++n}. ${msg}`);

const links = (await db.query(`select email, user_id from workspace_members order by email`)).rows;
assert.equal(links[0].user_id, A); assert.equal(links[1].user_id, R); ok("invites link to accounts (before and after sign-up), emails lower-cased");

const pid = (await as(A, `select create_project($1,'P',$2::jsonb) id`, [ws, JSON.stringify({ title: "P" })])).rows[0].id;
const v2 = (await as(A, `select save_project($1,1,$2::jsonb) v`, [pid, JSON.stringify({ title: "P2", approvedThrough: 0 })])).rows[0].v;
assert.equal(v2, 2); ok("save creates version 2");
await fails(as(A, `select save_project($1,1,'{}'::jsonb)`, [pid]), /version_conflict/); ok("stale save raises version_conflict");
await fails(as(R, `select save_project($1,2,'{}'::jsonb)`, [pid]), /forbidden/); ok("reviewer cannot save");
await fails(as(O, `select save_project($1,2,'{}'::jsonb)`, [pid]), /forbidden/); ok("non-member cannot save");
assert.equal((await as(A, `select rename_project($1,'새이름') v`, [pid])).rows[0].v, 3);
assert.equal((await db.query(`select name from projects`)).rows[0].name, "새이름"); ok("rename = new version, name stays in sync");
assert.equal((await as(O, `select count(*)::int c from projects`)).rows[0].c, 0); ok("non-member sees no projects");
assert.equal((await as(R, `select count(*)::int c from project_versions`)).rows[0].c, 3); ok("reviewer can read history");
await fails(as(A, `update projects set name='x' where id=$1`, [pid]), /permission denied/); ok("direct name/version edits are blocked");
assert.equal((await as(A, `update projects set status='archived' where id=$1`, [pid])).affectedRows, 1); ok("editor can archive");
assert.equal((await as(R, `update projects set status='trashed' where id=$1`, [pid])).affectedRows, 0); ok("reviewer cannot trash");
await fails(as(R, `insert into workspace_members(workspace_id,email) values ($1,'z@x.com')`, [ws]), /row-level security/); ok("only admins invite");
assert.equal((await as(A, `delete from workspace_members where email='admin@x.com'`)).affectedRows, 0); ok("admin cannot remove themselves");
assert.equal((await as(R, `insert into review_comments(project_id,step,body,author_id) values ($1,0,'hi',$2)`, [pid, R])).affectedRows, 1); ok("reviewer can comment");
await fails(as(O, `insert into review_comments(project_id,step,body,author_id) values ($1,0,'hi',$2)`, [pid, O]), /row-level security/); ok("non-member cannot comment");
console.log("SQL checks passed");
