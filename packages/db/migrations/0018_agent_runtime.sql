-- The agent runtime: agents, runs, sandbox, proposals (AI-NATIVE-PLAN.md
-- §6.5, §7, P2-T17).
--
-- An agent owns a member record with kind = 'agent' (already a real
-- workspace_members.kind value since P2-T03). Its least-privilege bindings
-- are ordinary access_bindings rows on that member's own access_groups
-- entry (P2-T01) — nothing new to store for "explicit bindings on named
-- spaces, goals and KPI trees only", since that mechanism already exists
-- and already excludes the blanket workspace_standard tier for agent-kind
-- members (the cross-phase access-model gap review, 2026-08-10).
create table agents (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id),
  name text not null,
  kind text not null default 'custom' check (kind in ('coach', 'champion', 'custom')),
  persona text not null default '',
  planning_instructions text not null default '',
  execution_instructions text not null default '',
  provider text
    check (provider is null or provider in ('anthropic', 'openai', 'google', 'openrouter', 'ollama', 'openai-compatible')),
  tier text check (tier is null or tier in ('fast', 'balanced', 'deep', 'embed')),
  schedule text not null default 'manual' check (schedule in ('manual', 'continuous', 'nightly')),
  autonomy text not null default 'propose' check (autonomy in ('sandbox', 'propose', 'scoped_direct')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table agents enable row level security;
alter table agents force row level security;

create policy tenant_isolation on agents
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index agents_workspace_member_idx
  on agents (workspace_id, member_id)
  where deleted_at is null;

-- openokr:hard-delete: a run is a durable record of what actually happened
-- (the task list, the append-only log, the cost it metered) — the same
-- "fact about a moment, nothing to soft-delete-recover" reasoning
-- ai_usage_events already uses, and the run history screen (S-38) this
-- feeds needs the whole history, not a filtered one
create table agent_runs (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  trigger text not null,
  status text not null default 'planning'
    check (status in ('planning', 'running', 'completed', 'failed', 'cancelled')),
  -- The decomposed work: an array of {action, input, subjectType, subjectId}
  -- objects. Planning populates this once; execution never adds to it,
  -- only advances current_task_index through it.
  tasks jsonb not null default '[]'::jsonb,
  current_task_index integer not null default 0,
  -- Append-only in practice, not by a database constraint: every step adds
  -- one entry and no step ever rewrites or removes one. A human-readable
  -- log, not a second audit chain — audit_events already covers every
  -- write a scoped_direct or applied-proposal task actually makes.
  log jsonb not null default '[]'::jsonb,
  cost numeric(12, 6) not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table agent_runs enable row level security;
alter table agent_runs force row level security;

create policy tenant_isolation on agent_runs
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index agent_runs_agent_status_idx
  on agent_runs (workspace_id, agent_id, status);

-- openokr:hard-delete: a proposal's decision (applied, dismissed, by whom,
-- when) is the review-inbox history the task card names, the same
-- "history the screen needs, not a filtered one" reasoning as agent_runs
create table proposed_changes (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  run_id uuid not null references agent_runs (id) on delete cascade,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  subject_type text,
  subject_id uuid,
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  decided_by_member_id uuid references workspace_members (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table proposed_changes enable row level security;
alter table proposed_changes force row level security;

create policy tenant_isolation on proposed_changes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index proposed_changes_workspace_status_idx
  on proposed_changes (workspace_id, status);

create index proposed_changes_run_idx
  on proposed_changes (run_id);
