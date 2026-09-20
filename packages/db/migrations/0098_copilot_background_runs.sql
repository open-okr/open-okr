-- A copilot answer that outlives the request that asked for it (P4-T14b-b).
--
-- **Why a message needs a state at all.** Until now an assistant message was
-- written once, whole, when the answer finished, and the reader watched the
-- prose arrive over the request they had open. Close the tab and the answer is
-- gone: `streamAnswer` records what had arrived in a `finally` and the reader
-- has nothing to come back to. P4-T14b-b's acceptance criterion is a member
-- asking for something that takes a minute, reloading, and rejoining the run,
-- and none of that is possible while the answer exists only inside one HTTP
-- response.
--
-- So the answer is produced by a background job, the row is created empty when
-- the question is asked, and the text accumulates into it. A reader who comes
-- back reads the row and subscribes to the rest. Agung chose this shape on
-- 20 September 2026 over two narrower readings; `docs/design/p4-t14b-b-copilot-background-runs.md`
-- records what the other two cost.
--
-- No new table, so no new policy. These columns join `ai_messages`, which has
-- carried the tenant floor and soft delete since P4-T14a-a.

-- When the background run began.
--
-- Null on every message written before this migration and on every message a
-- synchronous answer still writes, which is what an instance with no relay
-- draining its queue falls back to. A null here means "there was never a run
-- to rejoin", which is the right answer for both.
alter table ai_messages add column run_started_at timestamptz;

-- When it finished, however it finished.
--
-- Set on success, on a provider that would not answer, and on a budget that
-- ran out. **A run is in flight when `run_started_at` is set and this is
-- null**, and that is the one question every reader of this table asks.
alter table ai_messages add column run_completed_at timestamptz;

-- Why it stopped early, in words for the reader.
--
-- The cost cap is the case the row exists for: "a run whose budget is spent
-- halts and says so" is half of P4-T14b-b's test plan, and saying so means
-- putting a sentence on the screen rather than leaving a short answer that
-- looks finished. Null when the run ended the way it meant to.
alter table ai_messages add column run_halted_reason text;

-- A run that started and never finished is the only interesting query here,
-- and it is asked on every page load of a thread. Partial, because a finished
-- message is the overwhelming majority and indexing it would be indexing the
-- answer to a question nobody asks.
create index ai_messages_in_flight_idx
  on ai_messages (workspace_id, thread_id)
  where run_started_at is not null
    and run_completed_at is null
    and stopped_at is null
    and deleted_at is null;

-- A message may be empty while, and only while, a run owns it.
--
-- **0052's constraint did not know about a run.** `ai_messages_content_present`
-- says a message has words in it, which was true of every message the product
-- could write: a question is what somebody typed, and an answer was recorded
-- whole when it finished. A background run writes its row before there is an
-- answer, and a run that halts writes no answer at all, and both are empty on
-- purpose.
--
-- The replacement keeps the original rule for every other row. An empty
-- message is permitted only where `run_started_at` is set, which is to say
-- only where a run either has not finished or finished with nothing to say and
-- `run_halted_reason` says why. A question with no words in it is still
-- refused, because a member message never carries a run.
alter table ai_messages drop constraint ai_messages_content_present;

alter table ai_messages
  add constraint ai_messages_content_present
  check (
    length(btrim(content)) > 0
    or run_started_at is not null
  );
