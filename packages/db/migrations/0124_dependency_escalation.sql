-- A dependency escalated to the cycle's sponsor (METHOD.md §5.4, P9-T16b-b).
--
-- §5.4 gives an unconfirmed dependency two ways to be settled besides the
-- providing team's confirmation: escalated to the sponsor, or logged as a
-- risk with a named owner. Until now only the second had a column, so a
-- dependency nobody could commit to had to be owned as a risk before the
-- sponsor had heard of it.
--
-- Who it went to and who sent it, and when. The sponsor is copied rather than
-- read from the cycle later, because a sponsor who changes does not inherit
-- what was escalated to the one before; that person decided, or did not.
--
-- The three are present together or not at all. Forward-only and safe for a
-- rolling upgrade: the previous release names none of them and writes null by
-- leaving them out. `key_result_dependencies` carries its tenant policy from
-- the migration that created it, which new columns do not touch.
alter table key_result_dependencies
  add column escalated_to_id uuid references workspace_members (id),
  add column escalated_by_id uuid references workspace_members (id),
  add column escalated_at timestamptz,
  add constraint key_result_dependencies_escalation_is_complete check (
    (escalated_to_id is null and escalated_by_id is null and escalated_at is null)
    or (escalated_to_id is not null and escalated_by_id is not null and escalated_at is not null)
  );
