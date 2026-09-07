-- A finding kind for divergence (P4-T06b-a).
--
-- `alignment_findings.kind` shipped at P3-T09 with `structure` plus METHOD.md
-- §5.3's own four semantic types: relink, dependency, conflict and gap.
-- Divergence is none of those. §5.3's four are judgements the Coach makes by
-- reading content, and its `gap` means "something is missing or weak, with no
-- second goal involved". Divergence is arithmetic: a stored health status
-- against a stored progress signal or a stored average confidence, from
-- AI-NATIVE-PLAN.md §6.1 item 3.
--
-- Filing it under `gap` was the cheaper option and is refused here. §5.3's four
-- types are canon and a reader filtering by kind would find a deterministic
-- arithmetic finding sitting among semantic judgements, which is the kind of
-- quiet blurring that costs later. Adding the value does not change METHOD.md:
-- §5.3 still names exactly four semantic types, and this is a fifth kind of
-- finding rather than a fifth semantic type.
--
-- The rule key on the row stays `quality.divergence`, which is the §6.4 trigger
-- every message about it cites.
--
-- Forward-only and additive: the check constraint only widens, so no existing
-- row changes and nothing reading the table today behaves differently.

alter table alignment_findings drop constraint if exists alignment_findings_kind_check;

alter table alignment_findings
  add constraint alignment_findings_kind_check
  check (kind in ('structure', 'relink', 'dependency', 'conflict', 'gap', 'divergence'));
