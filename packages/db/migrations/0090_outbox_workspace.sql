-- The outbox learns whose row it is holding (P8-T06b).
--
-- Design: docs/design/p8-t01a-tenant-limits.md §5, which asks the relay to
-- read "round-robin by workspace" and does not say how it would know. This
-- migration is the answer, and Agung chose it on 15 September 2026 over
-- partitioning on `payload->>'workspaceId'`.
--
-- **The problem this exists for.** The relay reads oldest first. One import
-- writing forty thousand outbox rows therefore puts every other workspace's
-- nudge, digest and channel message behind forty thousand jobs, and not one
-- of those jobs exceeded any limit: the queue is FIFO and FIFO is the unfair
-- part. Ordering by a per-workspace rank fixes it, and a rank needs a column
-- to partition on.
--
-- **Nothing writes it, and that is the point.** The default reads the
-- transaction's own tenant setting, which the Operation pipeline has already
-- applied with `SET LOCAL` before any outbox row is inserted. So
-- `enqueueOutbox` does not change by one line, four hundred call sites do not
-- change, and a path that forgets to pass a workspace cannot exist, because
-- there is nothing to pass. A row written outside a tenant-scoped transaction
-- gets null and shares one bucket with the others like it, which is the right
-- answer rather than a gap: those rows belong to no workspace.
--
-- **Nullable, and it stays nullable.** Every row already in the table
-- predates this column and there is no honest value to backfill them with:
-- the payload carries `workspaceId` on every pipeline path and is not
-- guaranteed to on the rows an action spec supplies through
-- `outcome.outbox`, so a backfill would be right most of the time and wrong
-- silently the rest. Delivered rows are purged by retention anyway, so the
-- nulls drain on their own.
--
-- **This table stays `openokr:not-tenant-scoped`.** The marker on migration
-- 0001 says why and the reason has not changed: only the relay reads this
-- table, and it must drain every workspace's rows in one pass, so a
-- row-level policy here would defeat its purpose. Carrying a workspace
-- identifier is not the same as being tenant-scoped, and adding a policy now
-- would stop the relay dead.

alter table outbox
  add column workspace_id uuid
    default nullif(current_setting('app.workspace_id', true), '')::uuid;

comment on column outbox.workspace_id is
  'Whose row this is, read from the transaction''s own tenant setting at insert. Null for rows written outside a tenant-scoped transaction, and for every row older than P8-T06b. Read by the relay to order fairly between workspaces; never used to authorise anything.';

-- The relay's round-robin read: pending rows, partitioned by workspace and
-- ordered oldest first inside each. Partial, because the relay never looks at
-- a delivered or dead-lettered row and the table is mostly those.
--
-- `outbox_pending_idx` stays: it serves the `available_at <= now()` filter
-- this one does not carry, and dropping an index the same release that adds
-- its replacement is the shape PLAN.md §5.1 forbids.
create index outbox_fair_idx
  on outbox (workspace_id, created_at, id)
  where delivered_at is null and dead_lettered_at is null;
