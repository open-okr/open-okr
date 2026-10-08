-- A space's holidays (METHOD.md §7.4, P9-T19b-a).
--
-- "A space marks its holiday periods. No check-in is due in them, nobody is
-- nudged for them, the streak does not break." One row per span the space
-- marked, both days included. A check-in period is a holiday when its last
-- working day is inside one, which `packages/method` decides, so the due
-- dates, the streak and the booking cannot disagree about which weeks owed
-- nothing.
--
-- **Spans, not weeks.** A space on every two weeks or monthly marks the same
-- summer as a space that meets weekly, and a period's frequency can change
-- after the summer was marked. Storing the dates keeps the mark true whatever
-- the periods turn out to be.
--
-- **`holiday` joins the suppression reasons.** A check-in nudge about a space
-- that is on holiday today is recorded and not sent, with its reason, the
-- same as every other decision to stay quiet (AI-NATIVE-PLAN §6.3).
--
-- Forward-only and safe for a rolling upgrade: a new table the previous
-- release names nowhere, and a check widened by one value the previous
-- release never writes. The tenant policy ships in the same migration.
create table space_holidays (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  space_id uuid not null references spaces(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint space_holidays_in_order check (ends_on >= starts_on)
);

create index space_holidays_space_idx
  on space_holidays (workspace_id, space_id, starts_on)
  where deleted_at is null;

alter table space_holidays enable row level security;
alter table space_holidays force row level security;

create policy space_holidays_tenant on space_holidays
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

alter table nudges drop constraint nudges_suppressed_reason_check;
alter table nudges add constraint nudges_suppressed_reason_check
  check (suppressed_reason in
    ('dedup', 'quiet_hours', 'snooze', 'disabled', 'ceiling', 'holiday'));
