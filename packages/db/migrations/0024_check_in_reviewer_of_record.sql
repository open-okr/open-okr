-- The reviewer of record on a check-in (TECHNICAL-PLAN.md §4.4, P3-T08).
--
-- The review inbox has to answer "who owes this acknowledgement" without asking
-- the goal, because the goal only knows who reviews it *now*. Two rules in the
-- approved design document (`p3-t00-okr-core-domain.md` §4.4) meet on this
-- column, and neither can be honoured by reading `goals.reviewer_id`:
--
--   Step 4 of a reassignment: "Reassign every pending obligation of that role on
--   this goal to the incoming member."
--
--   And immediately after: "A reviewer change never retroactively creates an
--   obligation for a check-in published before the change: the review inbox
--   reads the reviewer as of the check-in's publication."
--
-- Reading `goals.reviewer_id` satisfies the first and breaks the second: every
-- past check-in, acknowledged or not, would appear in the new reviewer's inbox.
-- Storing the reviewer per check-in satisfies both, because the two rules act on
-- different rows. A reassignment moves the column on check-ins still open, and
-- an acknowledged check-in keeps the reviewer who actually closed it, which is
-- also what makes the audit trail readable a year later.
--
-- Null means "published before this column existed" for the short window before
-- the backfill runs, and "still a draft" forever after: a draft has no reviewer
-- of record because publication is what creates the obligation.

alter table check_ins
  add column reviewer_member_id uuid references workspace_members (id);

comment on column check_ins.reviewer_member_id is
  'The reviewer as of publication. A reassignment moves it only while the check-in is unacknowledged (design §4.4 step 4).';

-- The review inbox's own query: one member''s open acknowledgement obligations.
-- Partial, because an acknowledged check-in is not an obligation and a draft
-- never was one, so neither belongs in the index the inbox reads on every page.
create index check_ins_open_obligation_idx
  on check_ins (workspace_id, reviewer_member_id)
  where state = 'published'
    and acknowledged_at is null
    and deleted_at is null;
