-- Sessions: the three OKR rituals as records (TECHNICAL-PLAN §4, P4-T07a).
--
-- One row per held ritual. Stage state is live over the realtime channel so
-- every participant sees the same screen without a reload. The table is
-- shared across weekly, monthly and quarterly sessions; `kind` determines
-- which stage list applies.
--
-- `stage_key` is the current stage identifier (e.g. 'confidence', 'diagnose'
-- for weekly; null when the session has not started). `elapsed jsonb` records
-- seconds spent per stage, keyed by stage_key, so the facilitator can see
-- where time went. `notes jsonb` holds per-stage facilitator notes, also keyed
-- by stage_key.
--
-- openokr:soft-delete: sessions follow the repository-wide soft-delete default.
-- A closed or skipped session must stay visible in history; soft-delete is
-- still the right pattern because it keeps the audit chain intact.

create table okr_sessions (
  id            uuid        primary key,
  workspace_id  uuid        not null references workspaces (id) on delete cascade,
  space_id      uuid        references spaces (id) on delete cascade,
  cycle_id      uuid        references cycles (id) on delete set null,
  kind          text        not null,
  title         text        not null,
  scheduled_for timestamptz not null,
  started_at    timestamptz,
  ended_at      timestamptz,
  facilitator_id uuid       not null references workspace_members (id),
  stage_key     text,
  stage_started_at timestamptz,
  elapsed       jsonb       not null default '{}',
  notes         jsonb       not null default '{}',
  state         text        not null default 'scheduled',
  digest_id     uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint okr_sessions_kind_check
    check (kind in ('planning', 'weekly', 'monthly', 'quarterly')),
  constraint okr_sessions_state_check
    check (state in ('scheduled', 'running', 'closed', 'skipped'))
);

create index okr_sessions_space_state_idx
  on okr_sessions (workspace_id, space_id, state)
  where deleted_at is null;

create index okr_sessions_cycle_idx
  on okr_sessions (workspace_id, cycle_id)
  where deleted_at is null;

-- RLS: tenant floor.
-- `force row level security` so the owner role (which migrations run as)
-- is also subject to the policy. Without it, the tenant floor does not hold.
alter table okr_sessions enable row level security;
alter table okr_sessions force row level security;

-- `with check` as well as `using` so a write cannot carry another workspace's
-- id. The missing_ok form of `current_setting` returns nothing rather than
-- raising when the setting is absent (an unscoped request).
create policy okr_sessions_tenant on okr_sessions
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
