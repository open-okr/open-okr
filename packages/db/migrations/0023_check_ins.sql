-- Check-ins, their snapshots and the private confidence votes
-- (TECHNICAL-PLAN.md §4.4, METHOD.md §7.2, P3-T07).
--
-- The narrative ritual. A check-in is the only thing that moves a goal's health,
-- and a draft is completely silent: no activity, no notification, no cadence
-- movement, no value history. That is a state on this table rather than a flag
-- somebody remembers to check.
--
-- **The snapshot is immutable, which is why it has its own table.** §6.2 says the
-- column is never updated in place: an edit inside the window writes a new
-- snapshot and keeps the old one, so the difference a reviewer already read cannot
-- change under them. TECHNICAL-PLAN §4.4 lists `check_ins.snapshot jsonb`, and one
-- column cannot hold a history, so `check_in_snapshots` is added beside it and the
-- §4.4 table is updated in the same change. The current snapshot is the newest
-- row, and the check-in keeps a pointer to it so the common read is one join.
--
-- `notifications.reason` and `subscriptions.reason` gain `review` and `check_in`.
-- An acknowledgement obligation is not an invitation, a join, a mention or a role
-- change, and calling it one of those would make the review inbox filter on a lie.

create table check_ins (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Only goals today. §4.4 names the column `subject_type` because KPIs and
  -- initiatives get check-ins in later phases.
  subject_type text not null default 'goal' check (subject_type in ('goal')),
  subject_id uuid not null references goals (id) on delete cascade,
  author_member_id uuid not null references workspace_members (id),
  state text not null default 'draft' check (state in ('draft', 'published')),
  published_at timestamptz,
  status text check (status in ('on_track', 'caution', 'off_track')),
  confidence numeric(3, 2) check (
    confidence is null
    or (confidence >= 0 and confidence <= 1)
  ),
  -- Editor JSON with its version, never Markdown. Required to publish, which the
  -- check constraint below enforces rather than the application alone.
  narrative jsonb,
  narrative_version integer,
  -- The newest snapshot. The history lives in `check_in_snapshots`.
  snapshot_id uuid,
  session_id uuid,
  acknowledged_by_id uuid references workspace_members (id),
  acknowledged_at timestamptz,
  ai_drafted boolean not null default false,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- A published check-in carries everything §6.2 step 1 refuses without. A draft
  -- may be missing all of it.
  constraint check_ins_published_is_complete check (
    state = 'draft'
    or (
      published_at is not null
      and status is not null
      and confidence is not null
      and narrative is not null
    )
  ),
  -- An acknowledgement names who did it and when, or neither.
  constraint check_ins_acknowledged_together check (
    num_nonnulls (acknowledged_by_id, acknowledged_at) <> 1
  ),
  -- Nothing acknowledges a draft.
  constraint check_ins_draft_not_acknowledged check (
    state = 'published' or acknowledged_at is null
  )
);

alter table check_ins enable row level security;
alter table check_ins force row level security;

create policy tenant_isolation on check_ins
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The timeline read: one goal's published check-ins, newest first.
create index check_ins_subject_idx on check_ins (workspace_id, subject_id, published_at desc)
where
  deleted_at is null;

-- One draft per author per goal is the shape the composer wants: reopening it
-- continues where they left off rather than starting a second one.
create unique index check_ins_one_draft_idx on check_ins (workspace_id, subject_id, author_member_id)
where
  state = 'draft'
  and deleted_at is null;

-- The review inbox (P3-T08) reads exactly this: published, not yet acknowledged.
create index check_ins_awaiting_ack_idx on check_ins (workspace_id, subject_id)
where
  state = 'published'
  and acknowledged_at is null
  and deleted_at is null;

create unique index check_ins_legacy_idx on check_ins (workspace_id, legacy_type, legacy_id)
where
  legacy_id is not null
  and deleted_at is null;

-- §6.2: "the snapshot is immutable". Append-only in practice: an edit inside the
-- window adds a row and moves the pointer, and nothing rewrites one.
create table check_in_snapshots (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  check_in_id uuid not null references check_ins (id) on delete cascade,
  -- Per key result: identifier, value, previous value, progress percentage,
  -- confidence and previous confidence. A jsonb array rather than rows, because
  -- nothing joins to it and it is read whole or not at all.
  entries jsonb not null,
  at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table check_in_snapshots enable row level security;
alter table check_in_snapshots force row level security;

create policy tenant_isolation on check_in_snapshots
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index check_in_snapshots_check_in_idx on check_in_snapshots (workspace_id, check_in_id, at desc)
where
  deleted_at is null;

alter table check_ins
add constraint check_ins_snapshot_fk foreign key (snapshot_id) references check_in_snapshots (id) on delete set null;

-- The other half of the P3-T04 promise: `key_result_values.check_in_id` now has a
-- table to point at.
alter table key_result_values
add constraint key_result_values_check_in_fk foreign key (check_in_id) references check_ins (id) on delete set null;

alter table goals
add constraint goals_last_check_in_fk foreign key (last_check_in_id) references check_ins (id) on delete set null;

-- METHOD.md §7.2 step four: private confidence votes with a synchronised reveal.
-- A vote is readable only by its author until `revealed_at` is set, and the reveal
-- is one write over the whole set so no client sees a partial one.
create table check_in_votes (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  check_in_id uuid references check_ins (id) on delete cascade,
  key_result_id uuid not null references key_results (id) on delete cascade,
  session_id uuid,
  member_id uuid not null references workspace_members (id) on delete cascade,
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table check_in_votes enable row level security;
alter table check_in_votes force row level security;

create policy tenant_isolation on check_in_votes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One vote per member per key result per round. Changing your mind updates it.
create unique index check_in_votes_one_per_member_idx on check_in_votes (workspace_id, key_result_id, member_id)
where
  revealed_at is null
  and deleted_at is null;

create index check_in_votes_key_result_idx on check_in_votes (workspace_id, key_result_id)
where
  deleted_at is null;

-- An acknowledgement obligation is not an invitation, a join, a mention or a role
-- change. `check_in` is the fan-out to subscribers; `review` is the reviewer's own
-- obligation, which the review inbox at P3-T08 filters on.
alter table notifications
drop constraint if exists notifications_reason_check;

alter table notifications
add constraint notifications_reason_check check (
  reason in ('invited', 'joined', 'mentioned', 'role', 'review', 'check_in')
);

alter table subscriptions
drop constraint if exists subscriptions_reason_check;

alter table subscriptions
add constraint subscriptions_reason_check check (
  reason in ('invited', 'joined', 'mentioned', 'role', 'review', 'check_in')
);
