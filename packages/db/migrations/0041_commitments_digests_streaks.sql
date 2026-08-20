-- Commitments, digests and streaks (TECHNICAL-PLAN §4, METHOD.md §7.2, P4-T08).
--
-- Stage 3: commitments set each week and closed in the next.
-- Stage 4: the digest assembled from the session record.
-- The streak: consecutive weeks a space held its check-in.

-- openokr:soft-delete: commitments are historical records.
create table commitments (
  id              uuid        primary key,
  workspace_id    uuid        not null references workspaces (id) on delete cascade,
  session_id      uuid        references okr_sessions (id) on delete set null,
  space_id        uuid        not null references spaces (id) on delete cascade,
  week_start      date        not null,
  text            text        not null,
  owner_id        uuid        not null references workspace_members (id),
  key_result_id   uuid        references key_results (id) on delete set null,
  delivered       boolean,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index commitments_space_week_idx
  on commitments (workspace_id, space_id, week_start)
  where deleted_at is null;

alter table commitments enable row level security;
alter table commitments force row level security;
create policy commitments_tenant on commitments
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: digests are the permanent record of each session.
create table digests (
  id              uuid        primary key,
  workspace_id    uuid        not null references workspaces (id) on delete cascade,
  scope           text        not null,
  scope_id        uuid,
  period          text        not null,
  period_start    date        not null,
  body            jsonb       not null default '{}',
  note            text,
  generated_at    timestamptz not null default now(),
  published_at    timestamptz,
  channels        text[]      not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint digests_scope_check
    check (scope in ('space', 'workspace', 'member')),
  constraint digests_period_check
    check (period in ('daily', 'weekly', 'cycle'))
);

create index digests_scope_period_idx
  on digests (workspace_id, scope, scope_id, period_start)
  where deleted_at is null;

alter table digests enable row level security;
alter table digests force row level security;
create policy digests_tenant on digests
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Now that the digests table exists, add the FK on okr_sessions.
-- The column was created in 0036 as a bare uuid; this adds the constraint.
alter table okr_sessions
  add constraint okr_sessions_digest_id_fk
  foreign key (digest_id) references digests (id) on delete set null;

-- Streaks: one row per space, upserted on session close.
-- Not soft-deleted: a streak is a running counter, not a document.
-- openokr:hard-delete: a streak row is derived, never authored. Deleting
-- a space takes its streak.
create table streaks (
  id                uuid        primary key,
  workspace_id      uuid        not null references workspaces (id) on delete cascade,
  space_id          uuid        not null references spaces (id) on delete cascade,
  current_weeks     integer     not null default 0,
  longest_weeks     integer     not null default 0,
  last_session_week date,
  history           jsonb       not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint streaks_space_unique unique (workspace_id, space_id)
);

alter table streaks enable row level security;
alter table streaks force row level security;
create policy streaks_tenant on streaks
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
