-- AI provider configuration and credentials (AI-NATIVE-PLAN.md §3.3, §7,
-- P2-T14).
--
-- Two tables. `ai_providers` is the workspace admin's own on/off switch per
-- provider, plus whether members may add a personal key for it.
-- `ai_credentials` holds the actual key material, envelope-encrypted the same
-- way instance secrets already are (packages/core/src/secrets/key-ring.ts):
-- a per-credential data key wrapped by the root key ring, so root-key
-- rotation re-wraps data keys only. A null owner_member_id is the
-- workspace's own key; a non-null one is one member's personal key for that
-- provider, usable only while that provider's allow_user_keys is on.
create table ai_providers (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  provider text not null
    check (provider in ('anthropic', 'openai', 'google', 'openrouter', 'ollama', 'openai-compatible')),
  base_url text,
  enabled boolean not null default false,
  allow_user_keys boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table ai_providers enable row level security;
alter table ai_providers force row level security;

create policy tenant_isolation on ai_providers
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index ai_providers_workspace_provider_idx
  on ai_providers (workspace_id, provider)
  where deleted_at is null;

create table ai_credentials (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  provider text not null
    check (provider in ('anthropic', 'openai', 'google', 'openrouter', 'ollama', 'openai-compatible')),
  owner_member_id uuid references workspace_members (id),
  ciphertext text not null,
  data_key text not null,
  key_id text not null,
  -- A display-safe fragment (e.g. "sk-...abcd"), never the key itself.
  key_hint text not null,
  status text not null default 'unverified'
    check (status in ('unverified', 'verified', 'invalid')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table ai_credentials enable row level security;
alter table ai_credentials force row level security;

create policy tenant_isolation on ai_credentials
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One workspace-level credential per provider.
create unique index ai_credentials_workspace_key_idx
  on ai_credentials (workspace_id, provider)
  where owner_member_id is null and deleted_at is null;

-- One personal credential per provider per member.
create unique index ai_credentials_member_key_idx
  on ai_credentials (workspace_id, provider, owner_member_id)
  where owner_member_id is not null and deleted_at is null;
