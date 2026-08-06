-- The audit spine and the activity feed's table (TECHNICAL-PLAN §4.1, §4.11,
-- §8.1 layer 3, §8.2).
--
-- Every mutation commits its change, its activity row, its audit row and any
-- outbox rows in one transaction. These are two of those four.
--
-- The audit trail is append-only and hash-chained per workspace. Each row
-- commits to the one before it, so altering, removing or back-dating a row
-- breaks every hash after it and the verification tool says exactly where.
--
-- Append-only is enforced twice, on purpose:
--
--   * The application role is not granted UPDATE or DELETE on the table. That
--     is applied by grantAppPrivileges in packages/db, because the role name
--     belongs to the deployment rather than to this migration.
--   * A trigger refuses UPDATE and DELETE from anybody at all, including the
--     owner and a superuser at a psql prompt. Grants protect against the
--     application; the trigger protects against the operator.

-- Neither foreign key here carries an ON DELETE action, and that is the point.
-- A cascade would delete audit rows and a SET NULL would update them, so the
-- append-only trigger below would refuse an ordinary member removal. Both
-- tables are soft-deleted in this product, so restricting never bites in
-- practice; when it does, it is refusing to destroy history, which is correct.
--
-- openokr:hard-delete: the audit trail is append-only, so rows are never
-- deleted and a deleted_at column would describe a state that cannot happen.
-- The trigger below refuses deletion outright. Retention and export are
-- P7-T08, and both read rather than remove.
create table audit_events (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id),
  -- The position in this workspace's chain, starting at 1. Ordering by a
  -- timestamp would be ambiguous under concurrency, and the chain has to have
  -- exactly one order to be verifiable.
  seq bigint not null,
  -- Null for a system actor: provisioning writes the first audit row of a
  -- workspace before any member exists to attribute it to.
  actor_member_id uuid references workspace_members (id),
  actor_kind text not null
    check (actor_kind in ('human', 'agent', 'system', 'operator')),
  -- The registry action name, so an audit row resolves back to one contract.
  action text not null,
  target_type text not null,
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  -- Set by the application, not by now(): the value is part of the hash, so
  -- it has to be the same value the hash was computed over.
  at timestamptz not null,
  -- 64 zeros for the first row in a workspace.
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  unique (workspace_id, seq)
);

-- openokr:hard-delete: an activity is a fact about a moment. Feeds hide
-- entries whose subject is soft-deleted rather than soft-deleting the entry,
-- so there is nothing for a deleted_at here to make recoverable.
create table activities (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- The typed catalogue and its per-kind payload validation arrive with
  -- P2-T07; this migration ships the table the Operation pipeline writes to.
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  actor_member_id uuid references workspace_members (id) on delete set null,
  actor_kind text not null
    check (actor_kind in ('human', 'agent', 'system', 'operator')),
  subject_type text not null,
  subject_id uuid not null,
  -- No foreign keys: spaces are P3-T01 and access contexts are P2-T01. The
  -- fail-closed context resolver that fills context_id is P2-T07.
  space_id uuid,
  context_id uuid,
  at timestamptz not null default now()
);

alter table audit_events enable row level security;
alter table audit_events force row level security;
alter table activities enable row level security;
alter table activities force row level security;

create policy tenant_isolation on audit_events
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create policy tenant_isolation on activities
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The chain is read head-first when appending and in order when verifying.
create index audit_events_chain_idx on audit_events (workspace_id, seq desc);
create index audit_events_actor_idx on audit_events (workspace_id, actor_member_id);
create index audit_events_target_idx on audit_events (workspace_id, target_type, target_id);

create index activities_workspace_idx on activities (workspace_id, at desc);
create index activities_subject_idx on activities (workspace_id, subject_type, subject_id);

-- Append-only, enforced by the database rather than by convention. Grants stop
-- the application role; this stops everyone, so a hash chain cannot be quietly
-- rewritten by whoever holds an owner connection.
create function audit_events_append_only() returns trigger as $$
begin
  raise exception 'audit_events is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

create trigger audit_events_no_update
  before update or delete on audit_events
  for each statement execute function audit_events_append_only();

-- TRUNCATE is deliberately not blocked. It empties the table outright, which
-- is self-evident the moment anybody verifies a chain, whereas editing one row
-- is the silent change this trigger exists to stop. Anybody who can truncate
-- can also drop the table, so a trigger buys nothing against them, and
-- blocking it would only break the test harness's per-test reset.
