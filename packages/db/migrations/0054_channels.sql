-- Channels: connections, identities and the message log (AI-NATIVE-PLAN.md §5,
-- TECHNICAL-PLAN §4.11, P5-T01b-a).
--
-- Three tables, and the design document `docs/design/p5-t00-channel-design.md`
-- §2 is where each column is argued. What matters here:
--
-- * Email needs no connection row. It is the instance's own mail settings, so
--   the provider list below is the four that need installing.
-- * An identity is unique in both directions. One provider account is one
--   person, and one person has one account per provider. A single-direction
--   constraint lets two members claim the same Slack user, and lets one member
--   hold two identities that inbound resolution would then have to choose
--   between.
-- * The message log's idempotency key is what makes a relay retry safe. The
--   relay delivers at least once by design (P5-T01a); the second attempt finds
--   the row and stops rather than sending a member the same nudge twice.
-- * Credentials are envelope-encrypted in exactly the shape `ai_credentials`
--   uses: a per-row data key wrapped by the root key ring, so rotating the
--   root key re-wraps data keys and never touches the ciphertext.

create table channel_connections (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  provider text not null
    check (provider in ('slack', 'teams', 'whatsapp', 'telegram')),
  state text not null default 'connected'
    check (state in ('connected', 'error', 'disabled')),
  -- Envelope-encrypted, never read by a read action. `key_id` names the root
  -- key the data key is wrapped by, so `pnpm keys:rotate` can find it.
  ciphertext text not null,
  data_key text not null,
  key_id text not null,
  -- Provider-specific and not secret: a team id, a tenant id, a phone number
  -- id, a bot username. Safe to show on the connection card.
  config jsonb not null default '{}'::jsonb,
  installed_by_id uuid references workspace_members (id),
  last_verified_at timestamptz,
  -- The provider's own last complaint, for the connection health card. Never a
  -- credential: a driver that puts one here is a bug.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table channel_connections enable row level security;
alter table channel_connections force row level security;

create policy tenant_isolation on channel_connections
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One connection per provider per workspace, which is what makes routing a
-- lookup rather than a choice.
create unique index channel_connections_workspace_provider_idx
  on channel_connections (workspace_id, provider)
  where deleted_at is null;

create table channel_identities (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  member_id uuid not null references workspace_members (id) on delete cascade,
  provider text not null
    check (provider in ('slack', 'teams', 'whatsapp', 'telegram')),
  -- The provider's own identifier. Resolution reads this and never the handle:
  -- a handle is changeable, reusable, and sometimes shared.
  external_id text not null,
  -- Display only. Never used to resolve a sender.
  external_handle text,
  -- Null until the member proved it. An unverified identity receives nothing
  -- and sends nothing.
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table channel_identities enable row level security;
alter table channel_identities force row level security;

create policy tenant_isolation on channel_identities
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One provider account is one person.
create unique index channel_identities_external_idx
  on channel_identities (workspace_id, provider, external_id)
  where deleted_at is null;

-- And one person has one account per provider.
create unique index channel_identities_member_idx
  on channel_identities (workspace_id, provider, member_id)
  where deleted_at is null;

create table channel_messages (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  provider text not null
    check (provider in ('email', 'slack', 'teams', 'whatsapp', 'telegram')),
  direction text not null check (direction in ('out', 'in')),
  -- Null for a post to a space channel, which has no single recipient.
  member_id uuid references workspace_members (id) on delete set null,
  external_thread_id text,
  -- What was sent, or what was received after its signature verified. Never
  -- the raw unverified bytes.
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'suppressed')),
  -- The provider's error, or the reason a send was suppressed. Suppression is
  -- normal and is not a failure: a workspace with no channel connected
  -- suppresses every channel send and that is the expected state.
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table channel_messages enable row level security;
alter table channel_messages force row level security;

create policy tenant_isolation on channel_messages
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The relay's safety net. Not partial on `deleted_at`: a soft-deleted log row
-- must still block a redelivery, or deleting the record of a send would make
-- the send happen again.
create unique index channel_messages_idempotency_idx
  on channel_messages (workspace_id, idempotency_key);

create index channel_messages_member_idx
  on channel_messages (workspace_id, member_id, created_at desc)
  where deleted_at is null;
