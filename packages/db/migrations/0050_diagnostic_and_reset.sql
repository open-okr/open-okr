-- The diagnostic and the reset decisions (DATABASE.md §11, METHOD.md §8.6 and
-- §8.8, P4-T11c-a).
--
-- Stage seven's second half reads the cycle score against the rhythm score and
-- says which of three problems the quarter had. Stage nine closes every
-- objective deliberately.

-- openokr:soft-delete: a review's record is history the minutes read.
create table review_diagnostics (
  id            uuid        primary key,
  workspace_id  uuid        not null references workspaces (id) on delete cascade,
  session_id    uuid        not null references okr_sessions (id) on delete cascade,
  -- **Stored, not recomputed on read.** §8.6 calls this the most valuable output
  -- of the review, and the minutes at P4-T12 have to show what the room was
  -- told. A diagnostic recomputed a month later would quietly change its verdict
  -- as scores were corrected, which is the one thing a record must not do. Same
  -- reasoning as the check-in snapshot (P3-T07).
  cycle_score   numeric     not null,
  rhythm_score  numeric,
  verdict       text        not null,
  -- The deterministic sentence, always. With an AI provider on, a narrative adds
  -- specifics from this cycle; with it off the verdict reads the same, which is
  -- what makes the diagnostic whole with AI disabled.
  narrative     text        not null,
  ai_narrative  text,
  recorded_by_id uuid       not null references workspace_members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- **The method package's own words, not a second vocabulary.** TECHNICAL-PLAN
  -- §4 wrote this verdict as 'delivered' while `packages/method` calls the same
  -- verdict 'results_delivered', and two names for one thing is a translation
  -- layer nobody asked for and somewhere to get it backwards. The stored value
  -- is `DiagnosisKind` verbatim, and the plan row is corrected in this change.
  constraint review_diagnostics_verdict
    check (verdict in ('results_delivered', 'strategy_or_quality', 'rhythm')),
  constraint review_diagnostics_cycle_score check (cycle_score between 0 and 1),
  constraint review_diagnostics_rhythm_score
    check (rhythm_score is null or rhythm_score between 1 and 5)
);

-- One diagnostic per review. Reading it again replaces it, because a room that
-- re-reads after correcting a score has one answer and not two.
create unique index review_diagnostics_one_per_session_idx
  on review_diagnostics (workspace_id, session_id)
  where deleted_at is null;

alter table review_diagnostics enable row level security;
alter table review_diagnostics force row level security;

create policy review_diagnostics_tenant on review_diagnostics
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: the close decision is the record of how a cycle ended.
create table review_decisions (
  id             uuid        primary key,
  workspace_id   uuid        not null references workspaces (id) on delete cascade,
  session_id     uuid        not null references okr_sessions (id) on delete cascade,
  goal_id        uuid        not null references goals (id) on delete cascade,
  decision       text        not null,
  -- **Required.** §8.8 asks for "one decision and a one-line why", and a
  -- decision nobody explained is the default carry-over §8.8 exists to stop.
  why            text        not null,
  decided_by_id  uuid        not null references workspace_members (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint review_decisions_decision
    check (decision in ('keep', 'modify', 'abandon')),
  constraint review_decisions_why_present check (length(btrim(why)) > 0)
);

-- One decision per objective per review. §8.8 closes every objective
-- deliberately, which is one decision each, not a history of opinions.
create unique index review_decisions_one_per_goal_idx
  on review_decisions (workspace_id, session_id, goal_id)
  where deleted_at is null;

alter table review_decisions enable row level security;
alter table review_decisions force row level security;

create policy review_decisions_tenant on review_decisions
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
