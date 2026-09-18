-- Directory sync: SCIM bearer tokens and sync log (P8-T08).
--
-- SCIM 2.0 (RFC 7644) is the provisioning protocol. The identity provider
-- (Okta, Azure AD, etc.) pushes user and group changes to the instance
-- rather than the instance polling a directory.
--
-- Each workspace generates one SCIM bearer token. The identity provider
-- sends it on every request. The token is hashed (SHA-256) at rest so a
-- database copy cannot be replayed, following the same pattern as session
-- tokens (P1-T04).
--
-- The sync log records every SCIM operation for audit. It is not an audit
-- event (those are per-domain-write); it is an operational log that says
-- what the directory asked for and what the instance did about it.

-- openokr:hard-delete: tokens are revoked (revoked_at), not soft-deleted.
-- A revoked token is a fact about the past, not a row to restore.
create table directory_sync_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- SHA-256 of the bearer token. The plaintext is shown once at creation
  -- and never stored.
  token_hash text not null,
  label text not null default 'SCIM token',
  -- The SSO connection this token is associated with, if any.
  sso_connection_id uuid references sso_connections(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,

  constraint directory_sync_tokens_hash_unique unique (token_hash)
);

-- One non-revoked token per workspace. A second one replaces the first by
-- revoking it, so the identity provider always holds one token. Expiry is
-- checked at resolve time rather than in the index predicate, because
-- now() is not IMMUTABLE and Postgres refuses it in a partial index.
create unique index directory_sync_tokens_live_idx
  on directory_sync_tokens (workspace_id)
  where revoked_at is null;

-- Tenant floor.
alter table directory_sync_tokens enable row level security;
alter table directory_sync_tokens force row level security;

create policy directory_sync_tokens_tenant
  on directory_sync_tokens
  using (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- openokr:hard-delete: operational log, not domain data. Rows are retained
-- for a window and then cleared by the retention sweep, not soft-deleted.
create table directory_sync_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- SCIM resource type: "User" or "Group".
  resource_type text not null,
  -- SCIM operation: "CREATE", "UPDATE", "DEACTIVATE", "REACTIVATE",
  -- "ADD_MEMBER", "REMOVE_MEMBER".
  operation text not null,
  -- The external id from the directory (the SCIM externalId or id).
  external_id text not null,
  -- The local member or space id that was affected.
  local_id uuid,
  -- Whether the operation succeeded.
  success boolean not null default true,
  -- Error message if the operation failed.
  error_message text,
  -- The raw SCIM request body, for debugging. Retained for a limited
  -- window and then cleared by the retention sweep.
  request_body jsonb,
  created_at timestamptz not null default now()
);

create index directory_sync_log_workspace_idx
  on directory_sync_log (workspace_id, created_at desc);

-- Tenant floor.
alter table directory_sync_log enable row level security;
alter table directory_sync_log force row level security;

create policy directory_sync_log_tenant
  on directory_sync_log
  using (workspace_id = current_setting('app.workspace_id', true)::uuid);
