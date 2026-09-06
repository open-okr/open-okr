-- The session an external agent holds while it works (AI-NATIVE-PLAN.md §8.3,
-- P5-T09b).
--
-- **A session is bound to a grant and outlives no part of it.** The protocol's
-- session identifier is a convenience for the transport: it lets a client resume
-- a stream and lets the server keep per-connection state. It is not a
-- credential, and it must never become one. Every request still presents its
-- access token and is resolved from scratch, so a session whose grant was
-- revoked a second ago is refused a second ago, and this row is a record rather
-- than an authority.
--
-- **The identifier is stored as a digest, like every other secret in this
-- product.** It is not a secret in the way a token is, and treating it as one
-- costs nothing: a table of live session identifiers would otherwise be a table
-- of ways to attach to somebody's stream if the transport ever came to trust it.
--
-- **The negotiated protocol version is on the row.** Two clients on one
-- instance can be speaking different versions of the protocol, and what a
-- support question needs a quarter later is which one *this* client agreed to,
-- not which ones the server can speak.
create table mcp_sessions (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Cascade: a session under a grant that has gone is a session for nothing.
  grant_id uuid not null references oauth_grants (id) on delete cascade,
  -- SHA-256 hex of the identifier the transport generated.
  session_hash text not null,
  -- What the client and the server agreed to speak, as the protocol writes it.
  protocol_version text not null,
  -- The client's own name and version, from `initialize`. Untrusted text: shown
  -- escaped and read as nothing.
  client_name text,
  client_version text,
  last_seen_at timestamptz not null default now(),
  -- Set when the client sends DELETE, or when the grant is revoked. A closed
  -- session is kept so a person can see what was connected and when it stopped.
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table mcp_sessions enable row level security;
alter table mcp_sessions force row level security;

create policy tenant_isolation on mcp_sessions
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    -- The same pre-tenant key the OAuth secrets use, and for the same reason:
    -- a transport that has only a session identifier does not yet know which
    -- workspace it belongs to. It reaches exactly the row whose digest it holds.
    or session_hash = nullif(current_setting('app.oauth_secret_hash', true), '')
  )
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index mcp_sessions_hash_idx on mcp_sessions (session_hash);

create index mcp_sessions_grant_idx
  on mcp_sessions (workspace_id, grant_id);
