-- Authentication, owned by Better Auth (TECHNICAL-PLAN §2, §4.1, §8.2).
--
-- Identity is two-level: `users` is global to a deployment and holds
-- credentials, sessions, passkeys and one-time passwords. The per-workspace
-- person is `workspace_members`, which arrives in P1-T06 and references
-- `users.id`.
--
-- Column names and text identifiers follow Better Auth's own conventions
-- rather than the repository's time-ordered UUIDs, because Better Auth owns
-- this schema and fighting its shape buys friction on every upgrade.

-- openokr:not-tenant-scoped: identity is global to the deployment by design.
-- One person signs in once and may be a member of several workspaces, so a
-- workspace_id here would be wrong, not merely absent.
-- openokr:hard-delete: a soft-deleted account would keep a live credential
-- and a signable identity. Erasure is anonymisation at the member level
-- (P7-T08), which preserves authorship without preserving the login.
create table users (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  -- Set by the two-factor plugin once a second factor is enrolled.
  two_factor_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- openokr:not-tenant-scoped: a session belongs to a global user, not to a
-- workspace. The active workspace is a member-level concern (P1-T06).
-- openokr:hard-delete: revoking a session must actually remove it. A
-- recoverable session is a live credential wearing a deleted label.
create table sessions (
  id text primary key,
  -- SHA-256 of the token the browser holds, never the token itself
  -- (TECHNICAL-PLAN §8.2, "tokens hashed at rest"). The hashing adapter in
  -- packages/core owns both halves of this: it hashes on write and hashes
  -- the predicate on lookup, so a database copy cannot be replayed as a
  -- signed-in browser.
  token text not null unique,
  user_id text not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

-- openokr:not-tenant-scoped: credentials belong to the global user.
-- openokr:hard-delete: unlinking a provider or removing a password must
-- remove the credential, not hide it.
create table accounts (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  -- The provider's own identifier for this account, and which provider it is
  -- ("credential" for email and password).
  account_id text not null,
  provider_id text not null,
  -- Hashed by Better Auth (scrypt). Null for social and passkey accounts.
  password text,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, account_id)
);

create index accounts_user_id_idx on accounts (user_id);

-- openokr:not-tenant-scoped: verification challenges are pre-workspace by
-- definition; email verification and password reset happen before any
-- workspace context exists.
-- openokr:hard-delete: a consumed or expired challenge is removed. Keeping a
-- used reset token recoverable is exactly the risk this table must not carry.
create table verifications (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index verifications_identifier_idx on verifications (identifier);

-- openokr:not-tenant-scoped: a passkey authenticates the global user.
-- openokr:hard-delete: removing a passkey must revoke the credential.
create table passkeys (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  name text,
  -- The public half only. The private key never leaves the authenticator,
  -- which is the property that makes passkeys unphishable.
  public_key text not null,
  credential_id text not null unique,
  counter integer not null default 0,
  device_type text not null,
  backed_up boolean not null default false,
  transports text,
  aaguid text,
  created_at timestamptz not null default now()
);

create index passkeys_user_id_idx on passkeys (user_id);

-- openokr:not-tenant-scoped: a second factor belongs to the global user.
-- openokr:hard-delete: disabling two-factor must destroy the shared secret
-- and the backup codes outright.
create table two_factors (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  -- The TOTP shared secret and the backup codes, both encrypted by Better
  -- Auth with the instance secret before they reach this table.
  secret text not null,
  backup_codes text not null,
  verified boolean not null default true,
  -- Better Auth counts wrong codes here and parks the factor when there are
  -- too many, so a stolen password cannot be paired with a guessed code.
  failed_verification_count integer not null default 0,
  locked_until timestamptz
);

create index two_factors_user_id_idx on two_factors (user_id);
