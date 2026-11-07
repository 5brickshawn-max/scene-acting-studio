-- Higgsfield's workspace selection is account-wide: calls that select a workspace run one at a time per
-- app workspace (a short lease), so one request can never restore the selection under another's generate.
alter table higgsfield_connections add column if not exists lock_until timestamptz;
