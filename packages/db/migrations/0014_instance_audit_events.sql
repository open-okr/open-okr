-- The instance-level audit chain (TECHNICAL-PLAN §8.2, P1/P2-hardening).
--
-- audit_events is hash-chained per workspace and requires one via a not-null
-- workspace_id: the plan's chain is a property of a tenant. Some security
-- events have no tenant to attach to at the moment they happen -- a failed
-- sign-in is a fact about an email address, resolved before any workspace
-- membership is known, and can implicate zero, one or several workspaces.
-- This is the other chain: one sequence for the whole instance, read and
-- written the same way system_settings already is.

-- openokr:instance-scope: instance-level security events, above every
-- workspace rather than beneath one, so it holds no workspace_id and its
-- write policy keys on the instance-admin setting instead
-- openokr:hard-delete: an audit row is a fact about a moment; there is
-- nothing to recover by soft-deleting one, and no append-only chain should
-- offer a delete path at all
create table instance_audit_events (
  id uuid primary key,
  -- Position in the instance's own chain, starting at 1.
  seq bigint not null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  -- Set by the application, not by now(): the value is part of the hash, so
  -- it has to be the same value the hash was computed over.
  at timestamptz not null,
  -- 64 zeros for the first row.
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash text not null check (row_hash ~ '^[0-9a-f]{64}$'),
  unique (seq)
);

alter table instance_audit_events enable row level security;
alter table instance_audit_events force row level security;

-- Readable by the application: an instance administration screen needs to
-- list these rows, and there is no tenant to scope the read to.
create policy instance_audit_events_read on instance_audit_events
  for select
  using (true);

-- Writes need the same explicit transaction-local opt-in system_settings
-- already uses. An ordinary request path never sets it, so a stray insert
-- from a request handler is refused by the database rather than caught in
-- review.
create policy instance_audit_events_write on instance_audit_events
  for insert
  with check (nullif(current_setting('app.instance_admin', true), '') = 'on');

-- The chain is read head-first when appending and in order when verifying.
create index instance_audit_events_chain_idx on instance_audit_events (seq desc);

-- Append-only, enforced by the database rather than by convention, the same
-- way audit_events already is: grants stop the application role (grants.ts's
-- APPEND_ONLY_TABLES), this stops everyone, including the owner and a
-- superuser, so the chain cannot be quietly rewritten by whoever holds an
-- owner connection. TRUNCATE is deliberately not blocked, for the same
-- reason audit_events leaves it open: emptying the table is self-evident,
-- and anybody who can truncate can also drop the table outright.
create function instance_audit_events_append_only() returns trigger as $$
begin
  raise exception 'instance_audit_events is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

create trigger instance_audit_events_no_update
  before update or delete on instance_audit_events
  for each statement execute function instance_audit_events_append_only();
