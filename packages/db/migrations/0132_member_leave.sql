-- A member's leave, with a delegate (METHOD.md §7.4, P9-T19b-b, the
-- Northwind year's gap G-2).
--
-- "A member marks their own leave, with a delegate. While they are away
-- nobody nudges them, their reviews and acknowledgements go to the delegate,
-- and a check-in on a goal they champion is the delegate's to post." Quiet
-- hours cover a night and a snooze covers a subject; neither covers eleven
-- weeks of parental leave, which is what NW-Q3-08 found nothing held.
--
-- **Leave never moves a role.** The champion and the reviewer stay on the
-- goal: a delegate answers for them while they are away, and the roles are
-- theirs again the day they are back. A permanent change is a reassignment,
-- recorded as one.
--
-- **`leave` joins the suppression reasons.** A nudge to somebody away that is
-- not one their delegate takes over is recorded and not sent, with its
-- reason.
--
-- Forward-only and safe for a rolling upgrade: a new table the previous
-- release names nowhere, and a check widened by one value the previous
-- release never writes. The tenant policy ships in the same migration.
create table member_leave (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  member_id uuid not null references workspace_members(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  delegate_member_id uuid not null
    references workspace_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint member_leave_in_order check (ends_on >= starts_on),
  constraint member_leave_not_self check (delegate_member_id <> member_id)
);

create index member_leave_member_idx
  on member_leave (workspace_id, member_id, starts_on)
  where deleted_at is null;

create index member_leave_dates_idx
  on member_leave (workspace_id, starts_on, ends_on)
  where deleted_at is null;

alter table member_leave enable row level security;
alter table member_leave force row level security;

create policy member_leave_tenant on member_leave
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

alter table nudges drop constraint nudges_suppressed_reason_check;
alter table nudges add constraint nudges_suppressed_reason_check
  check (suppressed_reason in
    ('dedup', 'quiet_hours', 'snooze', 'disabled', 'ceiling', 'holiday',
     'leave'));
