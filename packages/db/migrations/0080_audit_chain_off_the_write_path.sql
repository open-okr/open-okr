-- The audit chain leaves the write path (P7-T02a, TECHNICAL-PLAN §8.2).
--
-- **Measured, not suspected.** `appendAudit` took
-- `pg_advisory_xact_lock(hashtext('audit:' || workspace_id))` for the tail of
-- every write so each row could commit to the one before it. P7-T02's load run
-- put a number on the cost: at ten concurrent members in one workspace every
-- scenario is inside its §13.1 budget, and at fifty the reads degrade one to
-- two and a half times while the write degrades thirty, to 14.8 seconds at the
-- 95th percentile, with throughput barely moving. That shape is a queue, and
-- the queue is this lock. The comment on it said "P7-T01 measures it", and it
-- did.
--
-- Agung chose on 10 September 2026 to build the chain outside the write path
-- rather than take the recorded sequence-and-retry fallback, which would have
-- replaced one contention mechanism with another under exactly the contention
-- that was measured.
--
-- **What changes, and what deliberately does not.** The audit row is still
-- written inside the same transaction as the change, its actor, its action and
-- its payload: nothing about *whether* an event is recorded moves. What moves
-- is the row's position in the chain. A row arrives with `seq`, `prev_hash`
-- and `row_hash` unset, and a single writer fills them in insertion order
-- afterwards. Tampering is still detected, because the hash still covers every
-- field; it is detected once the row is chained rather than at the instant it
-- is written.
--
-- **The window is real and is stated rather than hidden.** Between a write and
-- the chainer's next pass, a row is recorded but not yet committed to. An
-- attacker who can write to the table directly could alter such a row without
-- breaking a hash. They could also, in that same position, insert a row into
-- any other table, so this widens an existing exposure by seconds rather than
-- creating a new one. `verifyWorkspaceChain` reports unchained rows as pending
-- and counts them, so "not yet chained" can never be read as "verified".
--
-- Forward-only, and safe for a rolling upgrade in both directions. This only
-- relaxes NOT NULL: the previous release still writes all three columns and
-- keeps working, and the new release reads null as "not chained yet". Nothing
-- is dropped, so the expand-then-contract rule in PLAN.md §5.1 has nothing to
-- contract here.
--
-- No new policy. `audit_events` carries `workspace_id` and its row-level
-- security from migration 0003.

alter table audit_events
  alter column seq drop not null,
  alter column prev_hash drop not null,
  alter column row_hash drop not null;

-- The chainer's own query: the oldest unchained rows in one workspace, in
-- insertion order. Partial, so it indexes the handful of pending rows rather
-- than the whole table, and `id` is the order because it is a time-ordered
-- UUIDv7 and therefore already insertion order.
create index audit_events_unchained_idx
  on audit_events (workspace_id, id)
  where seq is null;

-- **Append-only becomes: the content is immutable, the position is
-- write-once.**
--
-- Migration 0006 refused every UPDATE with a statement-level trigger, so that
-- a hash chain could not be quietly rewritten by whoever holds an owner
-- connection. That is exactly the property to keep, and the chainer needs to
-- fill three columns that were deliberately left null. Refusing it outright
-- would mean weakening the guarantee to "the application role cannot update"
-- and relying on a grant, which is the two-places-one-property problem
-- `grants.ts` was written to avoid.
--
-- So the rule is stated precisely instead. A row-level trigger permits one
-- shape of update and nothing else: `seq`, `prev_hash` and `row_hash` moving
-- from null to a value, with every other column identical. Content that means
-- anything, the actor, the action, the target, the payload and the time, still
-- cannot change by any route. A chained row cannot be re-chained, because its
-- `seq` is no longer null. DELETE is still refused outright.
--
-- What an attacker with an owner connection gains: they can set a bogus
-- position on a pending row. The verifier recomputes each hash from the
-- content, which they cannot touch, so a wrong hash is caught on the next
-- verification exactly as a tampered payload is.
--
-- Row-level rather than statement-level, because a statement-level trigger
-- cannot see which columns moved, and that distinction is the whole rule.

create or replace function audit_events_append_only() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_events is append-only: DELETE is not permitted'
      using errcode = 'restrict_violation';
  end if;

  -- The one permitted update: an unchained row gaining its position.
  if old.seq is null and new.seq is not null
     and old.prev_hash is null and new.prev_hash is not null
     and old.row_hash is null and new.row_hash is not null
     and new.id = old.id
     and new.workspace_id = old.workspace_id
     and new.actor_member_id is not distinct from old.actor_member_id
     and new.actor_kind = old.actor_kind
     and new.action = old.action
     and new.target_type = old.target_type
     and new.target_id is not distinct from old.target_id
     and new.payload = old.payload
     and new.at = old.at
  then
    return new;
  end if;

  raise exception 'audit_events is append-only: only an unchained row may gain its seq, prev_hash and row_hash, and nothing else may change'
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

drop trigger audit_events_no_update on audit_events;

create trigger audit_events_no_update
  before update or delete on audit_events
  for each row execute function audit_events_append_only();
