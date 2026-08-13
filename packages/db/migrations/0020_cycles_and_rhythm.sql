-- The annual frame, cycles and rhythm settings (TECHNICAL-PLAN.md §4.3,
-- METHOD.md §2.1, §11, P3-T02).
--
-- This is the time model the whole method hangs from. The cycle is the workflow
-- container, not just a date range: it carries the eight-phase position, the
-- roles, the publication deadline and which levels set OKRs. Its child tables
-- (the input pack, prior scores, issues, priorities, gate state) arrive with the
-- guided workflow at P3-T03.
--
-- Rich text follows the repository convention: editor JSON in `jsonb` beside an
-- integer version column, never Markdown as storage, one version per field the
-- way `workspace_members.bio`/`bio_version` already does it.
create table annual_frames (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- What the organisation calls the year: "2027", "FY28", "Year 3".
  year_label text not null,
  -- What it calls the horizon beyond the year, if it names one at all.
  horizon_label text,
  mission jsonb,
  mission_version integer,
  vision jsonb,
  vision_version integer,
  strategy jsonb,
  strategy_version integer,
  -- METHOD.md §2.3: phase 3 of an annual cycle completes only once leadership
  -- agreement on the frame is recorded.
  agreed boolean not null default false,
  open_issues jsonb,
  open_issues_version integer,
  -- §1 principle 3: "The not-doing list is as valuable as the priority list, and
  -- it must be written down."
  not_doing jsonb,
  not_doing_version integer,
  -- History rather than replacement. §2.1: the frame is "never rewritten
  -- mid-year", so a new frame supersedes the old one and the old one stays
  -- readable beside the cycles that were planned inside it.
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table annual_frames enable row level security;
alter table annual_frames force row level security;

create policy tenant_isolation on annual_frames
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One current frame per workspace. TECHNICAL-PLAN §4.3: "One current frame per
-- workspace, with history."
create unique index annual_frames_current_idx
  on annual_frames (workspace_id)
  where deleted_at is null and superseded_at is null;

create table annual_strategies (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  frame_id uuid not null references annual_frames (id) on delete cascade,
  text text not null,
  note text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table annual_strategies enable row level security;
alter table annual_strategies force row level security;

create policy tenant_isolation on annual_strategies
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index annual_strategies_frame_idx
  on annual_strategies (workspace_id, frame_id, position)
  where deleted_at is null;

create table cycles (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  mode text not null default 'quarterly' check (mode in ('annual', 'quarterly')),
  cadence text not null default 'quarterly'
    check (cadence in ('annual', 'semiannual', 'quarterly', 'monthly')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'closing', 'closed')),
  -- The facilitator's position in the eight-phase workflow (METHOD.md §2.2).
  -- Moved freely; what gates is the *completion* of the phases before it, which
  -- packages/method computes from rows rather than reading a boolean here.
  phase smallint not null default 1 check (phase between 0 and 7),
  frame_id uuid references annual_frames (id),
  previous_cycle_id uuid references cycles (id),
  sponsor_id uuid references workspace_members (id),
  facilitator_id uuid references workspace_members (id),
  -- The booked session dates, as an array of {key, on} objects. A jsonb column
  -- rather than a table because nothing joins to a session date; the real
  -- session rows are domain G at P4-T04.
  session_dates jsonb not null default '[]'::jsonb,
  publication_deadline date,
  pack_distributed_at timestamptz,
  published_at timestamptz,
  -- Which levels set OKRs this cycle (METHOD.md §2.7). Individual is optional:
  -- "Many organisations stop at team level."
  levels jsonb not null default '["company", "department", "team"]'::jsonb,
  contributing_units text,
  -- METHOD.md §2.3: phase 2 completes when the prior cycle is scored "or first
  -- cycle declared". Somewhere has to hold that declaration.
  first_cycle boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint cycles_dates_ordered check (ends_on >= starts_on)
);

alter table cycles enable row level security;
alter table cycles force row level security;

create policy tenant_isolation on cycles
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Generation is idempotent: resolving "the current cycle" twice creates one.
create unique index cycles_period_idx
  on cycles (workspace_id, mode, starts_on)
  where deleted_at is null;

create index cycles_status_idx
  on cycles (workspace_id, status, starts_on)
  where deleted_at is null;

-- openokr:hard-delete: one row per workspace, created at provisioning and never
-- removed while the workspace exists. There is no state where a workspace has no
-- rhythm settings, so there is nothing to soft-delete and recover.
create table rhythm_settings (
  workspace_id uuid primary key references workspaces (id) on delete cascade,
  -- Three §11 parameters with their own columns because TECHNICAL-PLAN §4.3
  -- names them so. They are therefore NOT allowed inside `overrides`: one value
  -- with two homes is a value nobody owns, and §11's own rule is that no
  -- threshold lives anywhere else. `resolveRhythmSettings` folds these three in.
  default_check_in_frequency text not null default 'weekly'
    check (default_check_in_frequency in ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly')),
  check_in_anchor_day smallint not null default 1
    check (check_in_anchor_day between 1 and 7),
  coach_strictness text not null default 'warn'
    check (coach_strictness in ('advisory', 'warn', 'strict')),
  -- Sparse deviations from the METHOD.md §11 canon, validated against the
  -- registry schema in packages/method on every write. An unset key reads the
  -- canon default, so an empty object is a complete answer.
  overrides jsonb not null default '{}'::jsonb,
  -- Terminology renames, keyed by the fixed term set in packages/method. A
  -- workspace renames a concept the method has; it cannot invent one.
  labels jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table rhythm_settings enable row level security;
alter table rhythm_settings force row level security;

create policy tenant_isolation on rhythm_settings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
