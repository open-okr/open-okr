-- Invitations (TECHNICAL-PLAN §4.1, P2-T04).
--
-- Two modes. `workspace` is a reusable link: anyone holding it may join,
-- bounded by `max_uses`, `expires_at` and optionally `allowed_domains`.
-- `personal` is issued to one email address and is used at most once; its
-- `email` column is what "personal" means, since nothing else on this table
-- names a person before they accept.
--
-- The raw token is never stored: `token_hash` is the SHA-256 hex digest, the
-- same shape session tokens already use (packages/core/src/auth/
-- session-hashing.ts). `member_id` is null until the link produces a member,
-- at which point it records who, so a personal link cannot be replayed by
-- someone else once it has already worked.
create table invite_links (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  mode text not null check (mode in ('workspace', 'personal')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Set for `personal`, null for `workspace`: a reusable link has no single
  -- addressee to check against.
  email text,
  -- Meaningful for `workspace` only. A personal link already names its one
  -- recipient in `email`, so a domain restriction beside it would be
  -- redundant at best and confusing at worst.
  allowed_domains text[],
  invited_by_member_id uuid references workspace_members (id),
  member_id uuid references workspace_members (id),
  use_count integer not null default 0,
  -- Null means unlimited. A personal link is enforced single-use in code by
  -- checking `member_id is null` rather than a stored max_uses of 1, so the
  -- column keeps one meaning: the ceiling on a reusable link.
  max_uses integer check (max_uses is null or max_uses > 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    (mode = 'personal' and email is not null) or
    (mode = 'workspace' and email is null)
  )
);

alter table invite_links enable row level security;
alter table invite_links force row level security;

create policy tenant_isolation on invite_links
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- An invite URL names its workspace (by slug) alongside the token, so
-- acceptance always runs with app.workspace_id already set to the claimed
-- workspace, the same as any other request. The lookup is scoped rather
-- than global: a token that exists only in a different workspace is
-- invisible here, which is the tenant floor doing exactly its job rather
-- than a gap this index has to work around.
create unique index invite_links_token_hash_idx
  on invite_links (workspace_id, token_hash)
  where deleted_at is null;

create index invite_links_workspace_idx
  on invite_links (workspace_id)
  where deleted_at is null;
