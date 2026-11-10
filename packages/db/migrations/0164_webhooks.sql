-- Outbound webhooks and their delivery log (docs/design/outbound-webhooks.md,
-- plan 0.7.0 D5, approved by Akmal on 10 November 2026).
--
-- A hook is a URL, a set of public events and an owner (W1). Every write that
-- records a mapped activity inserts one `webhooks.deliver` outbox row per
-- active hook subscribed to the event, in the write's own transaction (W8),
-- and the relay signs and posts it through the outbound guard (W5, W7).
--
-- **The signing secret is envelope-encrypted** (W6), in the same three
-- columns every sealed credential uses, so `pnpm keys:rotate` re-wraps it.
-- The server signs with it and so cannot hash it. The previous secret keeps
-- signing beside the new one for a day after a rotation, then stops.
--
-- A hook carried in a workspace archive arrives without its secret and off
-- (W14), which is why the secret columns are nullable and a hook that is on
-- must have one.
--
-- Forward-only and safe for a rolling upgrade: two new tables the previous
-- release names nowhere. The tenant policy ships with each.
create table webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  url text not null check (char_length(url) between 1 and 2000),
  -- Public event names from `packages/core/src/webhooks/events.ts`, never an
  -- activity kind (W3).
  events text[] not null check (cardinality(events) between 1 and 32),
  -- Limits the hook to one space's subjects. Null is the whole workspace.
  space_id uuid references spaces(id) on delete cascade,
  -- Whose access each delivery reads with (W1). A suspended owner pauses it.
  owner_member_id uuid not null references workspace_members(id),
  -- Who is emailed when the hook turns itself off after failures (W9).
  created_by_member_id uuid not null references workspace_members(id),
  enabled boolean not null default true,
  off_reason text check (off_reason in ('manual', 'failures', 'imported')),
  secret_ciphertext text,
  secret_data_key text,
  secret_key_id text,
  previous_secret_ciphertext text,
  previous_secret_data_key text,
  previous_secret_key_id text,
  previous_secret_expires_at timestamptz,
  secret_rotated_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  turned_off_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint webhooks_secret_whole check (
    (secret_ciphertext is null) = (secret_data_key is null)
    and (secret_ciphertext is null) = (secret_key_id is null)
  ),
  constraint webhooks_previous_secret_whole check (
    (previous_secret_ciphertext is null) = (previous_secret_data_key is null)
    and (previous_secret_ciphertext is null) = (previous_secret_key_id is null)
    and (previous_secret_ciphertext is null) = (previous_secret_expires_at is null)
  ),
  constraint webhooks_on_has_secret check (not enabled or secret_ciphertext is not null),
  constraint webhooks_off_has_reason check (enabled = (off_reason is null))
);

-- The one lookup every mapped write pays (W8): the live, switched-on hooks
-- of one workspace. A workspace with none reads an empty index range.
create index webhooks_live_idx
  on webhooks (workspace_id)
  where deleted_at is null and enabled;

alter table webhooks enable row level security;
alter table webhooks force row level security;

create policy webhooks_tenant on webhooks
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One row per attempt (W10): the event, the subject, when, the status code,
-- the duration, the attempt number and a reason in our own words. Never a
-- request or response body and never a response header: the body is
-- workspace content and the answer is whatever the receiver says. A
-- redelivery reads the subject again rather than replaying a stored body.
--
-- openokr:hard-delete: an operational log kept 30 days and purged daily by age (W10). Nothing restores a purged attempt; the audit trail records every change to a hook.
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event text not null,
  -- The `webhook-id` header: the same on every attempt and every redelivery
  -- of one event, so a receiver can drop a duplicate.
  event_id text not null check (char_length(event_id) between 1 and 80),
  subject_type text,
  subject_id uuid,
  -- The check-in a `key_result.checked_in` event came from, so a redelivery
  -- can read its value and confidence again.
  check_in_id uuid,
  occurred_at timestamptz not null,
  attempt integer not null check (attempt >= 1),
  outcome text not null check (outcome in ('delivered', 'failed', 'refused', 'withheld')),
  status_code integer,
  duration_ms integer check (duration_ms >= 0),
  reason text check (char_length(reason) <= 300),
  attempted_at timestamptz not null default now()
);

-- A hook's own log, newest first.
create index webhook_deliveries_hook_idx
  on webhook_deliveries (workspace_id, webhook_id, attempted_at desc);

-- The daily purge.
create index webhook_deliveries_attempted_idx
  on webhook_deliveries (workspace_id, attempted_at);

alter table webhook_deliveries enable row level security;
alter table webhook_deliveries force row level security;

create policy webhook_deliveries_tenant on webhook_deliveries
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
