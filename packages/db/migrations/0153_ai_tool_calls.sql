-- One row for every call an external agent makes (docs/design/agent-tool-calls.md,
-- plan 0.7.0 A2, approved by Akmal on 9 November 2026).
--
-- Writes left an audit row tagged with the channel; reads, `search`, `fetch`
-- and refusals left nothing, so nobody could say what an agent read or how
-- often it was refused. This is that record.
--
-- **No argument value, no result and no refusal sentence is ever stored**
-- (D2). Arguments carry titles, comment bodies and search words. What is kept
-- is the tool, the scope it needed, where the call stopped, up to five ids the
-- input named, and how long it took.
--
-- openokr:hard-delete: an operational log with a retention window
-- (`agentToolCallRetentionDays`, 90 days by default, 0 keeps every row). The
-- sweep removes rows and nothing restores them; the audit trail is the
-- forever record of writes and scope refusals.
--
-- Forward-only and safe for a rolling upgrade: a new table the previous
-- release names nowhere. The tenant policy ships in the same migration.
create table ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  member_id uuid not null references workspace_members(id),
  grant_id uuid references oauth_grants(id) on delete cascade,
  token_id uuid references api_tokens(id) on delete cascade,
  source text not null default 'mcp' check (source in ('mcp')),
  -- Null for a tool this server does not have: that text is the agent's.
  tool text,
  scope text check (scope in ('read', 'write', 'destructive')),
  outcome text not null check (
    outcome in (
      'ok',
      'unknown_tool',
      'outside_toolsets',
      'refused_scope',
      'invalid_input',
      'refused',
      'failed'
    )
  ),
  refusal_code text check (refusal_code in ('forbidden', 'not_found', 'conflict')),
  target_ids uuid[] not null default '{}',
  duration_ms integer not null,
  called_at timestamptz not null default now(),
  -- Exactly one connection: a hosted agent's grant or a local agent's token.
  constraint ai_tool_calls_one_connection
    check ((grant_id is null) <> (token_id is null)),
  constraint ai_tool_calls_five_targets
    check (cardinality(target_ids) <= 5)
);

-- The member's own list, newest first.
create index ai_tool_calls_member_idx
  on ai_tool_calls (workspace_id, member_id, called_at desc);

-- The retention sweep and the administrator's totals.
create index ai_tool_calls_called_idx
  on ai_tool_calls (workspace_id, called_at);

alter table ai_tool_calls enable row level security;
alter table ai_tool_calls force row level security;

create policy ai_tool_calls_tenant on ai_tool_calls
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
