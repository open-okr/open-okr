-- Erasing a closed workspace (docs/design/workspace-erasure.md §4 to §6).
--
-- Set when erasure claims the workspace. From then on nothing reopens it, and it is
-- the one condition under which an audit row may be deleted.
ALTER TABLE tenants
  ADD COLUMN erasing_at timestamptz;

-- The audit trail stays append-only for every role, with one exception: the rows of
-- a workspace whose erasure has started. The server's role still has no DELETE
-- grant on this table, so only the owner role, which the server never holds, can
-- use the exception, and only through `pnpm cloud:erase`.
--
-- The tenant is read under the row-level floor, as the invoking role, so erasure
-- has to set the tenant setting for the workspace it is erasing. On a live
-- workspace the lookup finds no `erasing_at`, and on an instance with no tenant rows
-- it finds nothing at all, so a delete is refused exactly as before.
create or replace function audit_events_append_only() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1 from tenants t
       where t.workspace_id = old.workspace_id
         and t.erasing_at is not null
    ) then
      return old;
    end if;
    raise exception 'audit_events is append-only: DELETE is not permitted'
      using errcode = 'restrict_violation';
  end if;

  -- The one permitted update: an unchained row gaining its position.
  if old.seq is null and new.seq is not null
     and old.prev_hash is null and new.prev_hash is not null
     and old.row_hash is null and new.row_hash is not null
     and new.id = old.id
     and new.workspace_id = old.workspace_id
     and new.actor_member_id is not distinct from old.actor_member_id
     and new.actor_kind = old.actor_kind
     and new.action = old.action
     and new.target_type = old.target_type
     and new.target_id is not distinct from old.target_id
     and new.payload = old.payload
     and new.at = old.at
  then
    return new;
  end if;

  raise exception 'audit_events is append-only: only an unchained row may gain its seq, prev_hash and row_hash, and nothing else may change'
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;
