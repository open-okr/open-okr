-- Proof that a workspace owns an email domain (docs/design/
-- sso-domain-verification.md, change A).
--
-- A single sign-on connection lists email domains as free text, so until now
-- a workspace could claim any domain, `gmail.com` included, and two
-- workspaces could claim the same one. This table holds the proof: a DNS TXT
-- record at `_openokr-verify.<domain>` that only the domain's owner can
-- publish. `sso_connections.email_domains` stays as it is, for display, and is
-- read together with this table.
--
-- One row per (workspace, domain). `token_hash` is the SHA-256 of the token the
-- administrator copies into DNS. The token itself is shown once and never
-- stored, so a database read cannot be turned into a verification.
--
-- `verified_by` is `dns` when the record proved it and the administrator's
-- user id when an instance administrator marked it by hand, for an instance
-- with no public DNS (rule 6). The daily re-check reads only the `dns` ones.
create table sso_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  domain text not null check (domain = lower(domain) and char_length(domain) between 3 and 253),
  token_hash text not null,
  verified_at timestamptz,
  verified_by text,
  last_checked_at timestamptz,
  failed_checks integer not null default 0 check (failed_checks >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Verified and unverified are one fact, said in two columns.
  constraint sso_domains_verified_whole
    check ((verified_at is null) = (verified_by is null))
);

-- One row per domain per workspace, whatever its state.
create unique index sso_domains_workspace_domain_idx
  on sso_domains (workspace_id, domain)
  where deleted_at is null;

-- Rule 2, held by the database rather than by a check that two concurrent
-- verifications could both pass: one verified owner per domain per instance.
-- Exact match, so a subdomain is a separate domain.
create unique index sso_domains_verified_owner_idx
  on sso_domains (domain)
  where verified_at is not null and deleted_at is null;

alter table sso_domains enable row level security;
alter table sso_domains force row level security;

create policy sso_domains_tenant on sso_domains
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- A sign-up has no workspace yet, and has to know which domains somebody has
-- proved. The same key `sso_connections` uses (0094), narrowed the same way:
-- select only, this table only, and only the verified live rows. The row
-- carries a token hash and nothing a caller could use.
create policy sso_domains_verified_lookup on sso_domains
  for select
  using (
    nullif(current_setting('app.sso_lookup', true), '') = 'on'
    and verified_at is not null
    and deleted_at is null
  );

-- Forward-only and safe under a rolling upgrade: the previous release never
-- reads this table, so adding it changes nothing for it.
