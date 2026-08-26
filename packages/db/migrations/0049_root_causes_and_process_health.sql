-- Root causes and the process-health survey (DATABASE.md §11, METHOD.md §8.4
-- and §8.5, P4-T11b).
--
-- Stage seven gives every key result under the threshold exactly one primary
-- cause. Stage eight scores the practice rather than the results, anonymously.

-- openokr:soft-delete: a review's record is history the minutes read.
create table root_causes (
  id            uuid        primary key,
  workspace_id  uuid        not null references workspaces (id) on delete cascade,
  session_id    uuid        not null references okr_sessions (id) on delete cascade,
  key_result_id uuid        not null references key_results (id) on delete cascade,
  -- 1 to 8, indexing METHOD.md §8.4's taxonomy. The cause text is canon and
  -- lives in `packages/method`; storing it here would let a workspace edit a
  -- taxonomy §11 lists as unchangeable structure, and would leave old rows
  -- naming a cause the method no longer has.
  cause_key     smallint    not null,
  -- §8.4 asks for one cause and then "ask why until it stops being a symptom".
  -- The detail is where that lands, and it is optional because a room that has
  -- named the cause honestly has already done the required part.
  detail        text,
  named_by_id   uuid        not null references workspace_members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint root_causes_cause check (cause_key between 1 and 8)
);

-- **Exactly one primary cause per key result per review.** §8.4's own word is
-- "primary", and a key result with two causes has had the question dodged
-- rather than answered.
create unique index root_causes_one_per_key_result_idx
  on root_causes (workspace_id, session_id, key_result_id)
  where deleted_at is null;

alter table root_causes enable row level security;
alter table root_causes force row level security;

create policy root_causes_tenant on root_causes
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: a withdrawn response should read as withdrawn.
create table process_health_responses (
  id             uuid        primary key,
  workspace_id   uuid        not null references workspaces (id) on delete cascade,
  session_id     uuid        not null references okr_sessions (id) on delete cascade,
  -- 1 to 5, indexing METHOD.md §8.5's five statements. Canon text, same reason
  -- as `root_causes.cause_key`.
  statement_key  smallint    not null,
  score          smallint    not null,
  -- **No member id, on purpose.** §8.5 says anonymous, and a column holding the
  -- respondent would make every future join one careless line away from
  -- attributing an answer.
  respondent_hash text       not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint process_health_statement check (statement_key between 1 and 5),
  constraint process_health_score check (score between 1 and 5)
);

-- One answer per respondent per statement, without knowing who the respondent
-- is. This is the whole reason the hash exists rather than nothing at all.
create unique index process_health_one_per_statement_idx
  on process_health_responses (workspace_id, session_id, statement_key, respondent_hash)
  where deleted_at is null;

alter table process_health_responses enable row level security;
alter table process_health_responses force row level security;

create policy process_health_responses_tenant on process_health_responses
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The salt behind `respondent_hash`, one per review, written when the first
-- response arrives.
--
-- **What it buys, precisely.** A hash of the member id alone would be the same
-- string in every review, so somebody holding the table could follow one
-- unnamed person's answers across quarters without ever learning their name. A
-- per-review salt breaks that link. It also survives root-key rotation, which an
-- HMAC keyed on the instance secret would not: a rotation would leave every
-- stored hash unmatchable and silently break the one-response rule mid-review.
--
-- **What it does not buy.** It is not anonymity against somebody holding both
-- this database and the member list: a room is small enough to enumerate. What
-- the product guarantees is narrower and real: no read returns an attribution,
-- and no column carries one.
alter table okr_sessions
  add column process_health_salt text;
