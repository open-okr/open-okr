-- Usage metering and budgets (AI-NATIVE-PLAN.md §4 "Budgets and limits",
-- screen S-37, P2-T16).
--
-- `agent_id` carries no foreign key yet: the `agents` table is P2-T17's own
-- deliverable. The column exists now so a usage event recorded before that
-- table lands does not need a later migration to add it, and P2-T17 adds
-- the reference once there is something to reference.
--
-- openokr:hard-delete: a usage event is a fact about a moment a call
-- happened, metered against a real cost; there is nothing to recover by
-- soft-deleting one, and a hard cap computed from a partially-hidden total
-- would be the wrong number
create table ai_usage_events (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid references workspace_members (id),
  agent_id uuid,
  feature_key text,
  source text not null
    check (source in ('copilot', 'mcp', 'assist', 'agent', 'rest', 'channel')),
  provider text not null
    check (provider in ('anthropic', 'openai', 'google', 'openrouter', 'ollama', 'openai-compatible')),
  model_id text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost numeric(12, 6) not null default 0,
  latency_ms integer,
  status text not null default 'ok' check (status in ('ok', 'error', 'blocked')),
  flagged boolean not null default false,
  flagged_reason text,
  created_at timestamptz not null default now()
);

alter table ai_usage_events enable row level security;
alter table ai_usage_events force row level security;

create policy tenant_isolation on ai_usage_events
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The sum-over-a-period query's own access path: by workspace, scope and
-- time, every time a budget is checked.
create index ai_usage_events_workspace_created_idx
  on ai_usage_events (workspace_id, created_at desc);

create index ai_usage_events_member_created_idx
  on ai_usage_events (workspace_id, member_id, created_at desc)
  where member_id is not null;

create index ai_usage_events_agent_created_idx
  on ai_usage_events (workspace_id, agent_id, created_at desc)
  where agent_id is not null;

-- One budget per (workspace, scope, scope_ref, metric, period). scope_ref is
-- null for the workspace's own scope, a member id for 'user', an agent id
-- for 'agent' (no foreign key, same reason as ai_usage_events.agent_id
-- above). The workspace-scope budget doubles as the hard cap the task card
-- names: crossing it is the one that halts a running agent, not just
-- disables a feature, enforced in code rather than a second column here.
create table ai_budgets (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  scope text not null check (scope in ('user', 'agent', 'workspace')),
  scope_ref uuid,
  metric text not null check (metric in ('tokens', 'cost', 'calls')),
  period text not null check (period in ('day', 'month')),
  limit_value numeric(14, 4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table ai_budgets enable row level security;
alter table ai_budgets force row level security;

create policy tenant_isolation on ai_budgets
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index ai_budgets_scope_idx
  on ai_budgets (workspace_id, scope, coalesce(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid), metric, period)
  where deleted_at is null;
