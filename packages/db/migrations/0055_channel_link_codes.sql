-- Channel identity linking by short code (AI-NATIVE-PLAN.md §5.5, P5-T02a).
--
-- The flow the design document draws: a member asks the product for a code,
-- sends that code to the bot, and the inbound handler turns it into a verified
-- identity. Four properties, and each one is a column here rather than a
-- convention somebody has to remember:
--
-- * **Hashed, never stored in the clear.** A code is a bearer credential for
--   somebody's identity, and a table of live codes is a table of ways to
--   become other people. Same treatment as an invite token.
-- * **Expiring.** Ten minutes is the default; the column holds the instant so
--   a later change of mind does not reinterpret codes already issued.
-- * **Single use.** `consumed_at` rather than a delete, so "this code was
--   already used" is answerable and distinguishable from "no such code".
-- * **One live code per member per provider.** A second request replaces the
--   first, which is what a member pressing the button twice means.
--
-- No `legacy_id`: a link code is a thirty-second artefact of a flow, and
-- nothing imports one (TECHNICAL-PLAN §7.2).

create table channel_link_codes (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  provider text not null
    check (provider in ('slack', 'teams', 'whatsapp', 'telegram')),
  -- The code, one-way. Never read back, only compared against.
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table channel_link_codes enable row level security;
alter table channel_link_codes force row level security;

create policy tenant_isolation on channel_link_codes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One live code per member per provider.
create unique index channel_link_codes_member_idx
  on channel_link_codes (workspace_id, member_id, provider)
  where consumed_at is null and deleted_at is null;

-- The lookup the inbound handler does: find an unconsumed code by its hash.
create index channel_link_codes_hash_idx
  on channel_link_codes (workspace_id, provider, code_hash)
  where consumed_at is null and deleted_at is null;
