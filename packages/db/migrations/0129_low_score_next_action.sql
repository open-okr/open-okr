-- A next action for every low score (METHOD.md §7.2 step 2, P9-T19a-b).
--
-- METHOD v2: "Every low score gets a next action due by the next check-in,
-- with an owner. Where something is actually blocked, it gets a blocker too."
-- The session used to demand a blocker for every low key result, which made a
-- team invent a blocker where there was only a next step. The next action now
-- lives on the key result's confirmed confidence for that session, which is
-- the row that already says it is low.
--
-- `next_action_due_at` is the end of the goal's next check-in day after the
-- action was set, as a blocker's `due_at` is (P9-T19a-a). The three are set
-- together or not at all.
--
-- Forward-only and safe for a rolling upgrade: three nullable columns the
-- previous release names nowhere. `session_confidences` keeps its tenant
-- policy from migration 0037, which none of this touches.
alter table session_confidences
  add column next_action text,
  add column next_action_owner_id uuid references workspace_members (id),
  add column next_action_due_at timestamptz,
  add constraint session_confidences_next_action_is_complete check (
    (next_action is null) = (next_action_owner_id is null)
    and (next_action is null) = (next_action_due_at is null)
  );
