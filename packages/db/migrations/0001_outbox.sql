-- The transactional outbox (TECHNICAL-PLAN §4.1, §5).
--
-- The only legal way a write causes a side effect: the domain change, the
-- audit row and this row commit together, or none of them do. The relay
-- drains committed rows to the drivers at least once, and consumers are
-- idempotent on `idempotency_key`.

-- openokr:not-tenant-scoped: infrastructure queue, not user data. Only the
-- relay reads it, and it must drain every workspace's rows in one pass, so a
-- per-tenant policy would defeat its purpose. Tenant context, when a consumer
-- needs it, travels inside the payload.
-- openokr:hard-delete: delivered rows are purged by retention, never shown to
-- a user, so there is nothing for a soft delete to make recoverable.
create table outbox (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  payload jsonb not null,
  -- The consumer's deduplication key. Unique, so a retried write cannot
  -- enqueue the same side effect twice.
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  -- Null until the relay has handed the row to its driver.
  delivered_at timestamptz,
  attempts integer not null default 0,
  -- When the relay may next try this row. Moves forward on failure so one
  -- poison row cannot starve the queue.
  available_at timestamptz not null default now(),
  last_error text
);

-- The relay's claim query: undelivered rows that are due, oldest first.
create index outbox_pending_idx
  on outbox (available_at, created_at)
  where delivered_at is null;
