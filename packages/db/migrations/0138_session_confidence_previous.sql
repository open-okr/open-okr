-- What a key result's confidence was just before a session confirmed it
-- (METHOD.md §7.2 step 2, §11).
--
-- A key result whose confidence falls into the low band is raised with the
-- coordinator, wherever the fall happens. A check-in's snapshot records the
-- value it replaced, but a session confirmation did not, so a key result
-- drafted at 0.8 and confirmed at 0.2 in its first session was compared with
-- nothing and told nobody. Set when a session first confirms a key result,
-- and kept if the room confirms it again in the same session.
--
-- Forward-only and safe for a rolling upgrade: one nullable column the
-- previous release never reads, and rows it wrote stay null, which readers
-- treat as unknown. `session_confidences` already has its row-level security
-- policy, which covers a new column as it covers the rest of the row.
alter table session_confidences
  add column previous_confidence numeric;
