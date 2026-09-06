-- Where a proposal came from, and which nudge carries it (P4-T05c-a).
--
-- 1. `proposed_changes.ai_generated`.
--
-- AI-NATIVE-PLAN.md §6.2 requires a proposal to be marked as AI-generated. Not
-- every proposal is: METHOD.md §6.5's recovery draft is a template, a pure
-- function golden-master tested at P3-T14, and it works with the provider off.
-- `run_id` already says a proposal came from an agent; this says whether a model
-- wrote its content. The two are different questions and a reviewer needs the
-- second one, because how much to trust the words depends on who chose them.
--
-- False by default, so nothing existing is retroactively described as written
-- by a model. P4-T05c-b sets it true where a model actually drafts.
--
-- 2. `nudges.proposal_id`.
--
-- §6.4's acceptance is "a nudge containing a drafted change they can review and
-- apply in one action". Without the link, a nudge and its proposal are two rows
-- a reader has to guess belong together, matched by subject and hope. `on delete
-- set null` rather than cascade: deleting a proposal must not delete the record
-- that the product spoke, because the nudge row is the audit trail of what was
-- said.
--
-- Nullable, and most nudges will always leave it null. A reminder to do
-- something yourself carries no draft.
--
-- Forward-only and additive. Both columns are nullable or defaulted, so every
-- existing row is valid without a backfill and nothing reading either table
-- today behaves differently.

alter table proposed_changes
  add column ai_generated boolean not null default false;

alter table nudges
  add column proposal_id uuid references proposed_changes (id) on delete set null;

-- The review inbox reads "what is due for me, with anything attached", so the
-- lookup is by recipient. Partial, because the column is null on most rows and
-- an index over those would be mostly empty pages.
create index nudges_proposal_idx
  on nudges (workspace_id, recipient_member_id, proposal_id)
  where proposal_id is not null and deleted_at is null;
