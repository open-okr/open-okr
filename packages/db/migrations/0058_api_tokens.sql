-- Tokens for the versioned REST surface and the agent endpoint
-- (TECHNICAL-PLAN.md §14, P5-T07a).
--
-- **Hashed at rest, like every other token in this product.** The raw value is
-- shown once, when it is minted, and never stored. A stolen database row is not
-- a credential: presenting one requires the pre-image.
--
-- **The audience is stored, not read off the string.** A token's text carries a
-- readable prefix so a person can tell two of theirs apart and so a wrong-door
-- request gets a clear refusal without a query. The prefix is a convenience and
-- the column is the authority: the string is attacker-controlled and the row is
-- not. §14 asks for REST tokens and MCP tokens to be separated, and a single
-- table with an authoritative audience column is what makes the separation one
-- rule rather than two token systems that have to agree.
--
-- **Scopes narrow, they never widen.** A token carries the authority of the
-- member who minted it, bounded further by its scopes. A write-scoped token in
-- the hands of a view-level member still writes nothing, because `can()` runs
-- exactly as it does in the browser. That is why there is no scope for access
-- level here: a second answer to "who may do this" is a second thing to get
-- wrong.
--
-- **The pre-tenant policy key.** A REST request arrives with a bearer token and
-- nothing else. Which workspace it belongs to *is* the question, so the lookup
-- runs before any tenant setting exists, and forced row-level security would
-- otherwise return nothing at all. The second policy key admits exactly the row
-- whose hash the caller already holds, which is the arrangement
-- `channel_installations` uses for the same reason (P5-T02a). A caller who does
-- not already have the token learns nothing.
create table api_tokens (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Whose authority this token carries. Not a service account: there is no
  -- principal in this product with ambient authority.
  member_id uuid not null references workspace_members (id) on delete cascade,
  -- What the person called it, so a list of four tokens is readable.
  name text not null,
  -- Which door this token opens. 'rest' is the versioned surface; 'mcp' is the
  -- external agent endpoint, which P5-T08 issues its own grants for and which
  -- must refuse a REST token even when it is otherwise valid.
  audience text not null check (audience in ('rest', 'mcp')),
  -- SHA-256 hex of the raw token. Globally unique because the lookup has only
  -- the hash to go on.
  token_hash text not null,
  -- The readable head of the raw token, for display. Never enough to present.
  prefix text not null,
  -- 'read' allows read actions; 'write' allows write; 'destructive' allows the
  -- writes that remove something a person can see. Held as text rather than an
  -- enum type because the safety classes live in the action registry and a
  -- second declaration in the database would be a second thing to migrate.
  scopes text[] not null,
  -- Null means it does not expire on its own. Revocation is always available.
  expires_at timestamptz,
  -- Stamped on use, so a person can tell which of their tokens is still in
  -- something's configuration file. Best-effort and outside the request's
  -- transaction: a failed stamp must never fail an otherwise good call.
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table api_tokens enable row level security;
alter table api_tokens force row level security;

create policy tenant_isolation on api_tokens
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or token_hash = nullif(current_setting('app.api_token_hash', true), '')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create unique index api_tokens_hash_idx on api_tokens (token_hash);

create index api_tokens_member_idx
  on api_tokens (workspace_id, member_id)
  where deleted_at is null;
