-- The outbox dead letter (TECHNICAL-PLAN §5, P1 hardening follow-up carried
-- to P2-T06).
--
-- Before this, a row that could never succeed retried every lease interval
-- forever, invisible to anyone: `last_error` held the reason, but nothing
-- read it, and `attempts` climbed without a ceiling anywhere. `dead_lettered_at`
-- gives the relay a place to stop, and gives an operator a place to look.

alter table outbox add column dead_lettered_at timestamptz;

-- The claim query already filters on delivered_at is null; this keeps a
-- dead-lettered row out of that scan too, so it stops competing for the
-- relay's attention once it is marked.
drop index outbox_pending_idx;
create index outbox_pending_idx
  on outbox (available_at, created_at)
  where delivered_at is null and dead_lettered_at is null;

create index outbox_dead_letter_idx
  on outbox (created_at)
  where dead_lettered_at is not null;
