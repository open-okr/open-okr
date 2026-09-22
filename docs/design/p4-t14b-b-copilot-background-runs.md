# P4-T14b-b: a copilot run that outlives the request

Written for whoever reviews this row, and for whoever next changes the copilot.

## The problem

An answer existed only inside one HTTP response.

`streamAnswer` produces prose into the request that asked for it and records
what arrived in a `finally`. Close the tab five seconds in and the run stops
with it. There is nothing still going, and nothing to come back to.

The acceptance criterion is a member asking for something that takes a minute,
reloading, and rejoining the run. None of that is reachable from inside a
response the reader has just abandoned.

## The decision, and the two it was taken over

Nothing can predict which question will take a minute. Agung settled the fork
on 20 September 2026.

| Option | What it costs |
|---|---|
| **Every answer is a background run** (chosen) | One code path, reattach is free, no predictor. Every question waits one relay poll before its first token, and the P4-T14a-b inline path changes |
| Only a run the member sends to the background | Nothing shipped changes, and the member is asked to predict the thing nobody can predict. The common case, asked without thinking and closed the tab, still loses its run |
| Only when tools run | The narrowest reading of the row's words. A plain question that happens to take a minute is still lost, which is the case the criterion describes |

**The fallback is the old path.** `OPENOKR_RELAY=off` is how an operator moves
the relay to its own instance, and enqueuing on a process that drains nothing
would be enqueuing into nothing. That process answers inline exactly as before.

**The limitation worth knowing**: a deployment that serves requests from
processes with the relay off and drains from a separate one gets the inline
path, and with it no rejoining. A process can only ask whether it drains the
queue itself.

## The shape

```
POST /api/copilot
  copilot.ask { background: true }        one transaction:
      the question                          a member message
      an empty assistant message            run_started_at set
      an outbox row                         copilot.run
  subscribe  workspace:<ws>:copilot:<thread>
  stream what the job publishes

relay -> copilot.run
  resolveAgentRunCostCap                  halts here if it may not spend
  groundQuestion                          retrieval, availability
  drafter.answerGrounded
  publish copilot.sources / text / done
  copilot.completeRun                     content, citations, cost, completion

reload -> GET /api/copilot/live?threadId=
  copilot.thread authorises, then the same three events
```

## What is published, and what is persisted

| | Where it lives | Why |
|---|---|---|
| Prose, as it is produced | The realtime channel | A reader watching gets it without holding the request that asked |
| The finished answer | `ai_messages.content` | One write, one audit row |
| Whether a run is going | `run_started_at`, `run_completed_at` | The question a returning page asks, and the partial index in 0098 is on exactly it |
| Why it stopped early | `run_halted_reason` | A run that stopped silently leaves a short answer that looks finished |

**A chunk is not written as it arrives.** A write per chunk is a write per
token, and every write in this product carries an audit row, which would turn
one answer into hundreds of audit entries saying nothing.

**So a reader who rejoins halfway does not get a replay.** They hear the rest
live, see "Still writing" while it runs, and see the whole answer the moment it
completes and the thread is re-read. That is stated here rather than
discovered.

## The schema

Migration 0098 adds three columns to `ai_messages` and narrows one constraint.
No new table, so no new policy: `ai_messages` has carried the tenant floor and
soft delete since P4-T14a-a.

`ai_messages_content_present` from 0052 said a message has words in it, which
was true of every message the product could write. A run writes its row before
there is an answer, and a halted run writes none at all. The replacement
permits an empty message only where `run_started_at` is set, so a question with
no words in it is still refused.

## Acceptance criteria

**Given** a member asking something that takes a minute,
**when** they reload the page,
**then** the run is still going and they rejoin it.

**Given** a workspace whose cost cap is zero,
**when** a run starts,
**then** it halts before spending anything and the reader is told why.

**Given** the relay delivering the same run twice,
**when** the second delivery arrives,
**then** it finds the work done and no second answer is charged.

**Given** an instance with `OPENOKR_RELAY=off`,
**when** a member asks,
**then** the answer streams inline exactly as it did before.

## Where the tests are

| What | Where |
|---|---|
| The run, driven the way the relay drives it | `packages/core/test/copilot-background.test.ts` |
| The budget halting before a token is spent | the same file |
| Redelivery not charging twice | the same file |
| The panel rejoining after a reload | `e2e/s39-copilot-background.spec.ts` |

The run is driven through `dispatchOutbox` rather than by calling
`runCopilotAnswer` directly, so a row enqueued with no handler fails the test
rather than dead-lettering in production.

## What this does not do

- **No streaming from the provider.** The drafter port answers whole, so the
  job publishes one `copilot.text` with the answer in it. Streaming would mean
  a streaming port, which is a change to `packages/adapters` this row does not
  need and which the inline path already has for its own case.
- **No stop control on a background run.** Stopping used to be cancelling the
  request; there is no request now. A member who wants a run to stop has
  nothing to press, and that is a gap worth a row rather than something to
  improvise here.
- **No replay of prose already published**, for the reason above.
