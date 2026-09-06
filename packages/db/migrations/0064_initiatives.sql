-- Initiatives, and the key results they serve (TECHNICAL-PLAN §4.9,
-- METHOD.md §5.5, P5-T10a).
--
-- **An initiative is the work, and a key result is the measure.** The link
-- between them is many to many because both directions are real: one project
-- moves two numbers, and one number is moved by three projects. §5.5 asks a
-- facilitator to "record the main initiatives that will move it" per key
-- result, which is exactly this table read from the key result's side.
--
-- **`progress_pct` is derived, never typed, and nothing fills it yet.** The
-- work-layer design's own answer to W2: an initiative's progress is how much of
-- its work is done, and its work is the tasks that arrive at P5-T11. Until then
-- the column holds its default of zero and no action writes it. A typed number
-- beside a task list is a number that goes stale in a week, so no input schema
-- accepts one.
--
-- **`capacity` is the one place an initiative reaches into the method.**
-- Publish gate five already refuses a cycle holding a key result at `exceeds`
-- (METHOD.md §4.5, §5.5). An initiative carries the same verdict and the gate
-- reads both, because a cycle can fail for two different reasons with two
-- different fixes: a measure with no capacity behind it, or a project that is
-- over-committed.
--
-- **No cycle column, on purpose.** An initiative reaches a cycle through the key
-- results it serves, and that is the only relationship §5.5 describes. A
-- `cycle_id` here would be a second answer to "which cycle is this in", and the
-- two would disagree the first time an initiative served key results in two
-- cycles at once.

-- openokr:soft-delete: an initiative is a record of what a team committed to.
-- A deleted one still has to be readable from the cycle it was cut from.
create table initiatives (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Not nullable: an initiative lives in a space, and its access is the
  -- space's. A workspace-wide initiative with no owning team is a project
  -- nobody is accountable for.
  space_id uuid not null references spaces (id) on delete cascade,
  title text not null,
  description jsonb,
  description_version integer,
  owner_id uuid not null references workspace_members (id),
  starts_on date,
  ends_on date,
  status text not null default 'planned' check (
    status in ('planned', 'active', 'done', 'dropped')
  ),
  confidence numeric(3, 2) check (
    confidence is null
    or (confidence >= 0 and confidence <= 1)
  ),
  -- Null means nobody has judged it. That is a different fact from "fits", and
  -- gate five must not read the two alike.
  capacity text check (
    capacity is null or capacity in ('fits', 'tight', 'exceeds')
  ),
  progress_pct numeric(5, 2) not null default 0,
  position integer not null default 0,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- A window that ends before it starts is a typing mistake, and catching it
  -- here means every path catches it rather than the one that remembered.
  constraint initiatives_window_check check (
    starts_on is null or ends_on is null or ends_on >= starts_on
  )
);

alter table initiatives enable row level security;
alter table initiatives force row level security;

create policy tenant_isolation on initiatives
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index initiatives_space_idx
  on initiatives (workspace_id, space_id, position)
  where deleted_at is null;

create index initiatives_owner_idx
  on initiatives (workspace_id, owner_id)
  where deleted_at is null;

create index initiatives_status_idx
  on initiatives (workspace_id, status)
  where deleted_at is null;

-- Importable, so a second run of the same import updates rather than
-- duplicates (TECHNICAL-PLAN §7.2).
create unique index initiatives_legacy_idx
  on initiatives (workspace_id, legacy_type, legacy_id)
  where legacy_id is not null and deleted_at is null;

-- openokr:soft-delete: unlinking is a decision somebody made about what moves a
-- number, and the cycle's own record of its capacity check reads it.
create table initiative_key_results (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  initiative_id uuid not null references initiatives (id) on delete cascade,
  key_result_id uuid not null references key_results (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table initiative_key_results enable row level security;
alter table initiative_key_results force row level security;

create policy tenant_isolation on initiative_key_results
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One link per pair. Linking twice is the same decision made twice, and a
-- second row would double the initiative in the key result's own list.
create unique index initiative_key_results_pair_idx
  on initiative_key_results (workspace_id, initiative_id, key_result_id)
  where deleted_at is null;

create index initiative_key_results_key_result_idx
  on initiative_key_results (workspace_id, key_result_id)
  where deleted_at is null;
