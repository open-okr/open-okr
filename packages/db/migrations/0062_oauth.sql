-- The authorisation server an external agent connects through
-- (AI-NATIVE-PLAN.md §8.2, P5-T08a).
--
-- **Five tables, because the flow has five different lifetimes.** A client is
-- registered once and lives for years. A grant is one person's decision about
-- one client in one workspace. A code lives for a minute. An access token lives
-- for an hour. A refresh token lives until it is used, and then it is dead
-- forever, which is the property the whole reuse-detection scheme rests on.
-- Collapsing any two of these puts two lifetimes in one row.
--
-- **One pre-tenant key for three tables.** The token endpoint receives a secret
-- and nothing else: which workspace it belongs to *is* the question. So codes,
-- access tokens and refresh tokens each admit a row whose own hash equals
-- `app.oauth_secret_hash`, exactly as `api_tokens`, `channel_installations` and
-- `device_authorisations` do with their own keys. One setting rather than three
-- because the guarantee is identical in all three cases and is not weakened by
-- sharing a name: a caller reaches only the row whose digest it already holds.
--
-- **Nothing is stored in the clear.** Every secret is a SHA-256 hex digest, and
-- the raw value exists for the length of one response.

-- openokr:not-tenant-scoped: a client registers with the instance, not with a
-- workspace. The same agent connects to two workspaces on one instance and is
-- one client in both; a per-workspace copy would mean two registrations for one
-- piece of software and two places to allow-list it. What is per workspace is
-- the *grant*, which is the next table.
create table oauth_clients (
  id uuid primary key,
  -- What the client calls itself in the protocol. Its own identifier rather
  -- than ours, because it is what arrives on every request.
  client_id text not null,
  -- Shown on the consent screen. Untrusted text from a registration document:
  -- displayed escaped, and nothing reads it as a fact.
  name text not null,
  -- Every address a code may be returned to. An exact match, never a prefix:
  -- a prefix match on a redirect is how authorisation codes leak.
  redirect_uris text[] not null,
  -- Where it came from. `allow_list` is one this instance ships or an operator
  -- configured; `registered` came through dynamic registration (P5-T08b).
  source text not null default 'allow_list',
  -- The document a registered client was read from, kept so a later refresh
  -- knows where to look. Null for an allow-listed one.
  metadata_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index oauth_clients_client_id_idx
  on oauth_clients (client_id)
  where deleted_at is null;

-- One person's decision about one client in one workspace.
--
-- **The grant is the unit that gets revoked**, and every token points at it.
-- Revoking is one update here rather than a sweep across two token tables, and
-- a token whose grant is gone stops working on its next use without anything
-- having had to find it.
create table oauth_grants (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  client_id uuid not null references oauth_clients (id) on delete cascade,
  -- The action registry's own safety classes, exactly as `api_tokens.scopes`.
  scopes text[] not null,
  -- The instance URL this grant is bound to. Validated at issue and on every
  -- use, so a token minted for one instance is refused by another.
  resource text not null,
  revoked_at timestamptz,
  -- Why, in words a person reads in their connections list. "You revoked this"
  -- and "a refresh token was replayed" are very different things to be told.
  revoked_reason text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table oauth_grants enable row level security;
alter table oauth_grants force row level security;

create policy tenant_isolation on oauth_grants
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index oauth_grants_member_idx
  on oauth_grants (workspace_id, member_id);

-- The authorisation code, which lives for about a minute.
--
-- **Single use, and the consumption is part of the same transaction that mints
-- the tokens.** A code redeemed twice is the classic replay, and the only
-- defence that actually holds is that the second redemption cannot see an
-- unconsumed row.
create table oauth_codes (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  grant_id uuid not null references oauth_grants (id) on delete cascade,
  code_hash text not null,
  -- The PKCE challenge, and the method it was computed with. Stored rather than
  -- the verifier, which is the point: what the client proves later is that it
  -- knows the value this was derived from.
  challenge text not null,
  challenge_method text not null default 'S256',
  -- Compared exactly against the address the redemption names, because the two
  -- being allowed to differ is how a code reaches the wrong place.
  redirect_uri text not null,
  resource text not null,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table oauth_codes enable row level security;
alter table oauth_codes force row level security;

create policy tenant_isolation on oauth_codes
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or code_hash = nullif(current_setting('app.oauth_secret_hash', true), '')
  )
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index oauth_codes_hash_idx on oauth_codes (code_hash);

-- The short-lived token every tool call presents.
create table oauth_access_tokens (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  grant_id uuid not null references oauth_grants (id) on delete cascade,
  token_hash text not null,
  resource text not null,
  expires_at timestamptz not null,
  -- Set when the grant is revoked, so a token already in a client's memory
  -- stops working without waiting for its own expiry.
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table oauth_access_tokens enable row level security;
alter table oauth_access_tokens force row level security;

create policy tenant_isolation on oauth_access_tokens
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or token_hash = nullif(current_setting('app.oauth_secret_hash', true), '')
  )
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index oauth_access_tokens_hash_idx
  on oauth_access_tokens (token_hash);

create index oauth_access_tokens_grant_idx
  on oauth_access_tokens (workspace_id, grant_id);

-- The refresh token, and the chain each one leaves behind it.
--
-- **A refresh token is used exactly once and then is evidence.** Rotation means
-- every use mints a replacement and marks this one used, pointing at what
-- replaced it. A second presentation of a used token is not an error to report
-- back and forget: it means the token was copied, and the whole lineage is
-- revoked. `replaced_by` is what makes the lineage walkable from any link.
create table oauth_refresh_tokens (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  grant_id uuid not null references oauth_grants (id) on delete cascade,
  token_hash text not null,
  used_at timestamptz,
  replaced_by uuid references oauth_refresh_tokens (id) on delete set null,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table oauth_refresh_tokens enable row level security;
alter table oauth_refresh_tokens force row level security;

create policy tenant_isolation on oauth_refresh_tokens
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or token_hash = nullif(current_setting('app.oauth_secret_hash', true), '')
  )
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index oauth_refresh_tokens_hash_idx
  on oauth_refresh_tokens (token_hash);

create index oauth_refresh_tokens_grant_idx
  on oauth_refresh_tokens (workspace_id, grant_id);
