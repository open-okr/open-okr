-- Two more blocker types (METHOD.md §7.3, P9-T19a-a).
--
-- METHOD v2 adds "approach not working", for work that is happening while the
-- number does not move, and "other", for anything the five do not name. An
-- enum addition: every stored value stays valid.
--
-- Forward-only and safe for a rolling upgrade. The previous release writes
-- only the five it knows, and the constraint still accepts all of them; it
-- would refuse the two new values, which only this release writes. `blockers`
-- keeps its tenant policy from migration 0038, which this does not touch.
alter table blockers
  drop constraint blockers_type_check,
  add constraint blockers_type_check
    check (type in (
      'resource', 'dependency', 'clarity', 'priority_conflict', 'external',
      'approach_not_working', 'other'
    ));
