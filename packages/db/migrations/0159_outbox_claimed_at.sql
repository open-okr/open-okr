-- The outbox rate per workspace (docs/design/tenant-limits.md §10, plan 0.7.0
-- P6 and P7, approved by Akmal on 9 November 2026).
--
-- `claimed_at` is when the relay last claimed the row. The rate is a count of
-- each workspace's claims in the last minute, read from this column, so the
-- outbox is its own record of the rate and every relay process agrees (R3).
-- Written only while `cloud.limits.outboxRowsPerMinute` is set: with the
-- default of 0 nothing writes it and the index stays empty (R5).
--
-- The index is partial, so without a limit it costs nothing, and with one the
-- count reads a minute of claims rather than every row kept for
-- `outbox.retentionDays` (R4).
--
-- No row policy: the outbox is not tenant scoped (migration 0001's marker),
-- and this column authorises nothing. Forward-only and additive.
alter table outbox add column claimed_at timestamptz;

create index outbox_claimed_at_idx on outbox (claimed_at)
where claimed_at is not null;
