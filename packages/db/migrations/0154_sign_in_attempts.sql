-- Failed password sign-ins, counted per account and per account with caller
-- address, so too many hold the next attempt for a while
-- (docs/design/account-lockout.md §2, plan 0.7.0 P10, approved by Akmal on
-- 9 November 2026).
--
-- **Keyed hashes, never addresses** (D5). `account_key` is an HMAC of the
-- trimmed, lower-cased email address and `caller_key` an HMAC of the caller's
-- network address, both under a key derived from BETTER_AUTH_SECRET. A copy of
-- this table names nobody, and a row is written whether or not the account
-- exists, so a hold says nothing about who has one.
--
-- The account row has an empty `caller_key`; every other row is one caller
-- address trying that account. So one account's rows are one prefix of the
-- primary key, which is what a success or a reset clears.
--
-- openokr:not-tenant-scoped: a sign-in attempt arrives before any workspace
-- is chosen and is about an account, which is global to the deployment.
-- openokr:hard-delete: counters, not records. A cleared counter must be gone,
-- and the daily purge removes rows nobody touched for 30 days. The instance
-- audit chain is the record of a hold that mattered.
--
-- Forward-only and safe for a rolling upgrade: a new table the previous
-- release names nowhere.
create table sign_in_attempts (
  account_key text not null,
  caller_key text not null default '',
  -- Failures in a row since the last success; one more than 24 hours after
  -- the last starts again at one (D3).
  failures integer not null default 0,
  last_failure_at timestamptz,
  -- While in the future, the next password attempt is refused unchecked.
  held_until timestamptz,
  -- Caller rows only. A success here in the last 30 days makes the address
  -- known, and the account counter never holds a known address (D4).
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_key, caller_key)
);

-- The daily purge reads by age (D16).
create index sign_in_attempts_updated_idx on sign_in_attempts (updated_at);
