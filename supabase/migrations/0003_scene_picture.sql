-- The scene reference drawing (one picture of the whole cast) is the project thumbnail.
-- New installs get this from 0001; run this on a database set up before it.
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
    thumbnail_asset_id = coalesce(nullif(p_data->>'baseAssetId','')::uuid, thumbnail_asset_id),
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_project_id;
  return v_next;
end $$;
