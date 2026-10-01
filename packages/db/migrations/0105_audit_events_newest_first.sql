-- The audit trail read newest first, a page at a time (completeness review
-- L-19).
--
-- The admin screen could verify the chain and export it, and could not show
-- it. `audit.list` is the read that does, ordered by `(at, id)` descending
-- with the last row of a page as the cursor for the next. The indexes the
-- table had answer the chain (`seq`), an actor and a target, and none of them
-- answers "the newest fifty rows in this workspace", so without this every
-- page would sort the whole workspace's trail to hand back fifty rows of it.
-- A date range narrows the same index, which is the filter an auditor reaches
-- for first.
--
-- Additive and forward-only. The previous release never reads it, and the
-- append-only trigger from 0080 is unaffected, because an index is not an
-- update to a row.

-- openokr:not-tenant-scoped: this adds an index to an existing table and
-- creates none, so the tenant-floor and soft-delete checks have nothing to
-- read here. `audit_events` keeps the policy it has had since migration 0006.
create index audit_events_recent_idx
  on audit_events (workspace_id, at desc, id desc);
