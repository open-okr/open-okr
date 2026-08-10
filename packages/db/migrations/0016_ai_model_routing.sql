-- Model catalogue, tier routing, feature settings and the prompt registry
-- (AI-NATIVE-PLAN.md §3.4, §4, §7, P2-T15).
--
-- The *seeded* model catalogue is not a table: it is static data in
-- `packages/core/src/ai/model-catalog.ts`, the same "code registry plus
-- database overrides" shape `INSTANCE_SETTINGS`/`SETTINGS_REGISTRY` already
-- use, and for the same reason — seeding a `FORCE ROW LEVEL SECURITY` table
-- with rows that belong to no workspace has no clean owner to write them as.
-- `ai_models` below holds only what an admin adds themselves: a custom or
-- self-hosted model, real workspace data with no such ambiguity.
create table ai_models (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  provider text not null
    check (provider in ('anthropic', 'openai', 'google', 'openrouter', 'ollama', 'openai-compatible')),
  model_id text not null,
  display_name text not null,
  context_window integer not null,
  cost_in_per_million numeric(10, 4) not null default 0,
  cost_out_per_million numeric(10, 4) not null default 0,
  supports_tools boolean not null default false,
  supports_vision boolean not null default false,
  supports_json_mode boolean not null default false,
  supports_streaming boolean not null default false,
  embedding_dimensions integer,
  -- Which tiers this model is a candidate for. A model tagged for no tier is
  -- still catalogued (metering something already in use) but never offered
  -- as a policy choice.
  tiers text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table ai_models enable row level security;
alter table ai_models force row level security;

create policy tenant_isolation on ai_models
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index ai_models_workspace_provider_model_idx
  on ai_models (workspace_id, provider, model_id)
  where deleted_at is null;

-- One tier-to-model mapping per workspace per tier. Absent means the
-- provider's own seeded default (packages/adapters's DEFAULT_TIER_MODELS,
-- P2-T13) applies — "supplying a key is the only step" (AI-NATIVE-PLAN
-- §3.4) has to remain true, so a policy row is an override, never a
-- prerequisite.
create table ai_model_policies (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  tier text not null check (tier in ('fast', 'balanced', 'deep', 'embed')),
  provider text not null
    check (provider in ('anthropic', 'openai', 'google', 'openrouter', 'ollama', 'openai-compatible')),
  model_id text not null,
  temperature numeric(3, 2),
  max_tokens integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table ai_model_policies enable row level security;
alter table ai_model_policies force row level security;

create policy tenant_isolation on ai_model_policies
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index ai_model_policies_workspace_tier_idx
  on ai_model_policies (workspace_id, tier)
  where deleted_at is null;

-- A switch and an optional tier override per §2 capability. Quota (P2-T16's
-- own card) is not this table's column yet — added when that task lands,
-- not reserved speculatively.
create table ai_feature_settings (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  tier_override text check (tier_override in ('fast', 'balanced', 'deep', 'embed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table ai_feature_settings enable row level security;
alter table ai_feature_settings force row level security;

create policy tenant_isolation on ai_feature_settings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index ai_feature_settings_workspace_feature_idx
  on ai_feature_settings (workspace_id, feature_key)
  where deleted_at is null;

-- The versioned prompt registry. The built-in default text for each
-- `prompt_key` is code, not a row (packages/core/src/ai/prompts.ts),
-- exactly like the model catalogue's own seed/override split above. Every
-- edit is a new row, never an update to one already written — "a prompt
-- version change is recorded and reversible" means the old text has to
-- still exist to revert to, not be overwritten in place. The current
-- version for a key is simply its highest surviving `version`; "restore"
-- (removing every override so the code default serves again) is a soft
-- delete of every row for that key, not a special row of its own.
create table ai_prompts (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  prompt_key text not null,
  version integer not null,
  system_prompt text not null,
  created_by_member_id uuid references workspace_members (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table ai_prompts enable row level security;
alter table ai_prompts force row level security;

create policy tenant_isolation on ai_prompts
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index ai_prompts_workspace_key_version_idx
  on ai_prompts (workspace_id, prompt_key, version)
  where deleted_at is null;

create index ai_prompts_workspace_key_idx
  on ai_prompts (workspace_id, prompt_key, version desc)
  where deleted_at is null;
