-- Comments on initiatives (TECHNICAL-PLAN §4.10, completeness review M-01).
--
-- **An initiative carries a discussion.** REQUIREMENTS §4 Pillar F puts
-- comments "everywhere", and S-26 is the page where the work that moves a key
-- result is talked about. The subject list this table has held since
-- migration 0073 names a goal, a key result, a check-in, a cycle, a document
-- and a task, and not the initiative those tasks belong to, so the one page
-- with no thread was the one between the measure and the work.
--
-- Nothing else has to change for the rows to be safe. An initiative owns its
-- own access context (P5-T10a) and the resolver in
-- packages/core/src/access/reads.ts already walks a comment up to it, so a
-- comment on an initiative is readable by whoever reads the initiative and by
-- nobody else.
--
-- Additive and forward-only. The old release never writes the new value, and
-- a row it reads that carries it resolves through a resolver the old release
-- already has, so a rolling upgrade sees nothing it cannot answer.
--
-- No new policy. The table carries `workspace_id` and its row-level security
-- policy from migration 0032, and both are unchanged.

alter table comments
  drop constraint comments_subject_type_check;

alter table comments
  add constraint comments_subject_type_check
    check (
      subject_type in (
        'goal', 'key_result', 'check_in', 'cycle', 'document', 'task',
        'initiative'
      )
    );
