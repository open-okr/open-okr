-- The Postgres cache driver's storage (TECHNICAL-PLAN §5).
--
-- A cache is never a source of truth: every caller works correctly with this
-- table empty, so eviction and expiry can be as aggressive as we like.

-- openokr:not-tenant-scoped: an infrastructure key/value store. Callers
-- namespace their keys with the workspace id, and nothing reads this table
-- except the cache driver, which is given whole keys, never a scan.
-- openokr:hard-delete: expired and evicted entries are removed outright.
-- Keeping a deleted cache entry recoverable would be meaningless.
create table cache_entries (
  key text primary key,
  value jsonb not null,
  -- Null means no expiry. Expired rows are filtered on read and swept later,
  -- so a missed sweep can never serve stale data.
  expires_at timestamptz
);

create index cache_entries_expiry_idx on cache_entries (expires_at)
  where expires_at is not null;
