-- Subscriptions and the notification spine (TECHNICAL-PLAN §4.10, §4.11,
-- P2-T06).
--
-- `subscription_lists` and `subscriptions` (domain J) are built now even
-- though comments and reactions, the first real subjects that will own one,
-- are Phase 3: the routing machinery has to exist before anything routes
-- through it, the same way access contexts existed before spaces did.
--
-- `notification_batches.status` carries a value TECHNICAL-PLAN does not
-- name (`failed`, beside `pending` and `sent`): the row has to land
-- somewhere when its send attempt errors, and leaving it `pending` forever
-- would make it indistinguishable from one still waiting its window out.

create table subscription_lists (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  send_to_everyone boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table subscription_lists enable row level security;
alter table subscription_lists force row level security;

create policy tenant_isolation on subscription_lists
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index subscription_lists_subject_idx
  on subscription_lists (workspace_id, subject_type, subject_id)
  where deleted_at is null;

create table subscriptions (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  list_id uuid not null references subscription_lists (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  reason text not null check (reason in ('invited', 'joined', 'mentioned', 'role')),
  canceled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table subscriptions enable row level security;
alter table subscriptions force row level security;

create policy tenant_isolation on subscriptions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One live subscription per member per list. Re-subscribing after a cancel
-- is a new row rather than un-canceling the old one, so the reason history
-- (why they first joined, why they are back) is not overwritten.
create unique index subscriptions_one_per_member_idx
  on subscriptions (list_id, member_id)
  where deleted_at is null;

create index subscriptions_member_idx
  on subscriptions (workspace_id, member_id)
  where deleted_at is null and canceled is false;

create table notification_settings (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  -- Per notification reason (mention, batch, daily_summary, ...) to a
  -- channel. A reason absent from this map falls back to the member's
  -- primary_channel (workspace_members, §4.1).
  routing jsonb not null default '{}'::jsonb,
  mention_immediate boolean not null default true,
  batch_window_minutes integer not null default 30,
  daily_summary boolean not null default true,
  -- "HH:MM" in the member's own timezone (workspace_members.timezone).
  daily_summary_time text not null default '08:00',
  quiet_hours jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table notification_settings enable row level security;
alter table notification_settings force row level security;

create policy tenant_isolation on notification_settings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index notification_settings_member_idx
  on notification_settings (workspace_id, member_id)
  where deleted_at is null;

create table notification_batches (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  channel text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  window_minutes integer not null,
  send_at timestamptz not null,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table notification_batches enable row level security;
alter table notification_batches force row level security;

create policy tenant_isolation on notification_batches
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The "found or created under a row lock" invariant: at most one pending
-- batch per member per channel at a time, enforced by the database rather
-- than by hoping the application never races itself. A concurrent insert
-- attempt hits this and the caller falls back to selecting the existing row
-- (see ensurePendingBatch in packages/core).
create unique index notification_batches_one_pending_idx
  on notification_batches (workspace_id, member_id, channel)
  where status = 'pending' and deleted_at is null;

create index notification_batches_due_idx
  on notification_batches (send_at)
  where status = 'pending' and deleted_at is null;

create table notifications (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  recipient_member_id uuid not null references workspace_members (id) on delete cascade,
  activity_id uuid references activities (id),
  -- No foreign key: nudges are P4-T04.
  nudge_id uuid,
  batch_id uuid references notification_batches (id) on delete set null,
  reason text not null check (reason in ('invited', 'joined', 'mentioned', 'role')),
  read_at timestamptz,
  -- Not in TECHNICAL-PLAN's column list: the inbox's own snooze action needs
  -- somewhere to record "hide until", distinct from read_at, which means
  -- "seen". A snoozed notification a member has not read is still unread.
  snoozed_until timestamptz,
  channel text not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table notifications enable row level security;
alter table notifications force row level security;

create policy tenant_isolation on notifications
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index notifications_recipient_idx
  on notifications (workspace_id, recipient_member_id, created_at desc)
  where deleted_at is null;

create index notifications_batch_idx
  on notifications (batch_id)
  where deleted_at is null;
