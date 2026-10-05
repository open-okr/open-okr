-- An objective added mid-cycle that waits for a person (METHOD.md §2.9,
-- P9-T13-b-b).
--
-- **"New objectives mid-cycle start as"** may be Live, a draft its owner
-- publishes, or a draft its reviewer approves (§12). Under the last two, an
-- objective added after the team publication window starts here: `draft`
-- until its owner publishes it, then `awaiting_approval` until its reviewer
-- approves it where the workspace asks for that. Null is every other
-- objective, which follows its cycle, and is what every existing row is.
--
-- A waiting draft carries no check-in due date, so no reminder and no
-- staleness sweep reaches it; it gets one the moment it goes live.
--
-- Forward-only and safe for a rolling upgrade: the previous release names
-- the column nowhere and writes null by leaving it out. `goals` carries its
-- tenant policy from migration 0022, which a new column does not touch.
alter table goals
  add column draft_state text
    check (draft_state in ('draft', 'awaiting_approval'));
