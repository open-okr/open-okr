-- Tasks, their assignees and their checklists (TECHNICAL-PLAN §4.9, P5-T11).
--
-- **No board table, and that is the design decision rather than an omission.**
-- A board is a view over these rows grouped by status, for a space, an
-- initiative or a key result. Three boards over one set of rows, which is why
-- moving a task between boards is not a thing that can happen: it never
-- belonged to a board. A board with its own table would be three sources of
-- truth about one order.
--
-- **Both links are optional and independent.** The work-layer design's answer to
-- W1: a task may serve a key result with no initiative behind it, and forcing an
-- initiative would make people invent one. A task always has a space, because
-- that is where its access comes from.
--
-- **`position` is sparse and `ordering_state` records how it was last laid
-- out.** Two people drag two cards at the same moment; naive integers lose one
-- move or duplicate a slot. Sparse positions leave room to insert between two
-- neighbours without renumbering, the move runs under a row lock on the
-- column's own set so two moves serialise, and normalisation runs in the same
-- transaction when the gaps close rather than as a background job. A board that
-- renumbers itself while somebody drags is worse than a slow drag.
--
-- **Completing a task moves no key result.** Nothing here is read as progress:
-- TECHNICAL-PLAN §4.9 is explicit that the ratio of completed linked tasks is
-- shown beside the measured value and never instead of it. There is no trigger,
-- no derived column on `key_results`, and no write path from this table to one.

-- openokr:soft-delete: a task is a record of what somebody committed to doing.
create table tasks (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Not nullable: a task lives in a space and its access is the space's plus
  -- its own assignees'. A task belonging to nobody's team is work nobody owns.
  space_id uuid not null references spaces (id) on delete cascade,
  initiative_id uuid references initiatives (id) on delete set null,
  key_result_id uuid references key_results (id) on delete set null,
  title text not null,
  description jsonb,
  description_version integer,
  status text not null default 'backlog' check (
    status in ('backlog', 'todo', 'in_progress', 'done')
  ),
  due_on date,
  -- Sparse. `TASK_POSITION_SPACING` in packages/core is the gap the runtime
  -- leaves; the column itself only requires that it is an integer.
  position integer not null default 0,
  -- How the column was last laid out: the spacing used and when it was last
  -- renumbered. A reader can tell a freshly normalised column from one that has
  -- been dragged a hundred times without reading every row.
  ordering_state jsonb not null default '{}'::jsonb,
  legacy_type text,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table tasks enable row level security;
alter table tasks force row level security;

create policy tenant_isolation on tasks
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The board's own query: one space, one status, in order.
create index tasks_column_idx
  on tasks (workspace_id, space_id, status, position)
  where deleted_at is null;

create index tasks_initiative_idx
  on tasks (workspace_id, initiative_id)
  where deleted_at is null;

create index tasks_key_result_idx
  on tasks (workspace_id, key_result_id)
  where deleted_at is null;

-- The review inbox reads what is due, across spaces, for one member.
create index tasks_due_idx
  on tasks (workspace_id, due_on)
  where deleted_at is null and status <> 'done';

create unique index tasks_legacy_idx
  on tasks (workspace_id, legacy_type, legacy_id)
  where legacy_id is not null and deleted_at is null;

-- openokr:soft-delete: an assignment is an access change, and an access change
-- that vanished without trace is the one thing the audit trail exists to stop.
create table task_assignees (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  task_id uuid not null references tasks (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table task_assignees enable row level security;
alter table task_assignees force row level security;

create policy tenant_isolation on task_assignees
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One assignment per pair. Assigning twice is the same decision made twice, and
-- a second row would bind the same group to the same context again.
create unique index task_assignees_pair_idx
  on task_assignees (workspace_id, task_id, member_id)
  where deleted_at is null;

create index task_assignees_member_idx
  on task_assignees (workspace_id, member_id)
  where deleted_at is null;

-- openokr:soft-delete: a checklist item is part of the task's own record.
create table checklist_items (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  task_id uuid not null references tasks (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table checklist_items enable row level security;
alter table checklist_items force row level security;

create policy tenant_isolation on checklist_items
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index checklist_items_task_idx
  on checklist_items (workspace_id, task_id, position)
  where deleted_at is null;
