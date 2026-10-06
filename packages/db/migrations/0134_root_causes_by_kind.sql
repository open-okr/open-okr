-- Root causes: "other", and a second cause (METHOD.md §8.4, P9-T20c).
--
-- v2's §8.4: every key result below its root-cause threshold "gets one
-- primary cause, and may name a second", from nine, the ninth being "Other,
-- described in a line". The key stays the cause's place in the list, so 9
-- joins the range, and "other" without its line is refused here as well as
-- at the boundary: an "other" that says nothing is the cause left unnamed.
--
-- Forward-only and safe for a rolling upgrade: a check widened by one value
-- the previous release never writes, and a nullable column it never reads.
alter table root_causes drop constraint root_causes_cause;
alter table root_causes
  add constraint root_causes_cause check (cause_key between 1 and 9),
  add column secondary_cause_key smallint,
  add constraint root_causes_secondary check (
    secondary_cause_key is null
    or (secondary_cause_key between 1 and 9
        and secondary_cause_key <> cause_key)
  ),
  add constraint root_causes_other_described check (
    (cause_key <> 9 and coalesce(secondary_cause_key, 0) <> 9)
    or btrim(coalesce(detail, '')) <> ''
  );
