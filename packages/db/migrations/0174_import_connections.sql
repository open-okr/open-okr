-- A workspace's connection to a source it imports from
-- (docs/design/flowyteam-connect.md §4.2, approved by Agung on 23 November
-- 2026). One source today: FlowyTeam, connected through OAuth 2.0 with PKCE.
--
-- **The access token is envelope-encrypted**, in the same three columns every
-- sealed credential uses, so `pnpm keys:rotate` re-wraps it. No read action
-- selects them. They are nullable because a disconnected row loses its token
-- once the relay has revoked it at FlowyTeam: a credential nobody will use
-- again is not kept. A live row always holds one.
--
-- `revoked_at` says the token no longer works, whether this instance revoked
-- it or FlowyTeam refused it later. `deleted_at` says somebody disconnected.
-- A row FlowyTeam revoked stays live, so the card can say so and offer
-- Connect again, which replaces it.
--
-- Forward-only and safe for a rolling upgrade: a new table the previous
-- release names nowhere. The tenant policy ships with it.
create table import_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null check (source in ('flowyteam')),
  -- The FlowyTeam instance the token was issued by.
  base_url text not null check (char_length(base_url) between 1 and 2000),
  -- Which OAuth client asked: a registered client id on the managed cloud,
  -- or this instance's client metadata document address. Revoking names it.
  client_id text not null check (char_length(client_id) between 1 and 2000),
  -- As FlowyTeam returned them when the admin approved.
  company_id text not null check (char_length(company_id) between 1 and 64),
  company_name text not null check (char_length(company_name) between 1 and 400),
  token_ciphertext text,
  token_data_key text,
  token_key_id text,
  scopes text not null default 'flowyteam:export',
  connected_by_member_id uuid not null references workspace_members(id),
  connected_at timestamptz not null default now(),
  last_read_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint import_connections_token_whole check (
    (token_ciphertext is null) = (token_data_key is null)
    and (token_ciphertext is null) = (token_key_id is null)
  ),
  constraint import_connections_live_has_token check (
    deleted_at is not null or token_ciphertext is not null
  )
);

-- One live connection per workspace and source. A disconnected row keeps its
-- history and does not hold the slot.
create unique index import_connections_live_idx
  on import_connections (workspace_id, source)
  where deleted_at is null;

alter table import_connections enable row level security;
alter table import_connections force row level security;

create policy import_connections_tenant on import_connections
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
