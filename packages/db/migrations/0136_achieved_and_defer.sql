-- Achieved and defer (METHOD.md §8.8, P9-T20e-a).
--
-- v2's §8.8 closes every objective with one of five decisions where there
-- were three: "Achieved: done, close it" and "Defer: still worth doing, not
-- next cycle, it goes to the issue list" join keep, modify and abandon. Both
-- tables that hold a close decision take the two new values.
--
-- Forward-only and safe for a rolling upgrade: two checks each widened by
-- values the previous release never writes.
alter table goals drop constraint goals_close_decision_check;
alter table goals add constraint goals_close_decision_check check (
  close_decision is null
  or close_decision in ('achieved', 'keep', 'modify', 'defer', 'abandon')
);

alter table review_decisions drop constraint review_decisions_decision;
alter table review_decisions add constraint review_decisions_decision
  check (decision in ('achieved', 'keep', 'modify', 'defer', 'abandon'));
