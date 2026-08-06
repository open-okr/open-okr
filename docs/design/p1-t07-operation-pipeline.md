# P1-T07: the Operation pipeline, the action registry and the audit spine

Not a phase design gate. Written because three decisions here shape every write
the product will ever make, and two of them are readings of the plan rather than
transcriptions of it.

Authority: TECHNICAL-PLAN.md §8.1 layer 3, §8.2, §14, §4.1, §4.11.

## What the pipeline guarantees

| Guarantee | How |
|---|---|
| No partial writes | One transaction covers the change, the activity row, the audit row and the outbox rows |
| The audit trail cannot drift from state | `execute` must return its audit row for the operation to compile |
| A side effect never fires for a rolled-back write | Side effects are outbox rows in the same transaction; the relay reads committed rows only |
| A write cannot skip the pipeline | The boundary lint fails a Drizzle mutation outside an operation |
| History cannot be quietly edited | Append-only grants, an append-only trigger, and a per-workspace hash chain |

## Decision 1: authorisation runs inside the write transaction

The plan says "authorise against freshly loaded, access-scoped rows, then one
transaction covering the change". Read literally, authorisation happens in an
earlier transaction.

**We authorise first, inside the same transaction, before any write.**

Reading it as a separate earlier transaction opens a window: a binding is
revoked after the check and the write proceeds anyway. Doing it first inside the
one transaction satisfies both "freshly loaded" and "before the change", and
closes the window. This is strictly stronger than the literal reading, and no
weaker on any axis.

Recorded here because it is a deliberate interpretation. If the intent was the
literal ordering, this is the line to change.

## Decision 2: the audit chain serialises writes within a workspace

Each audit row hashes the one before it, so two concurrent writes in a workspace
must not claim the same predecessor.

**A per-workspace advisory lock, taken immediately before the audit insert.**

| Option | Verdict |
|---|---|
| Advisory lock before the audit insert | **Chosen.** Correct, verifiable, and held only for the tail of the transaction |
| No lock, unique index catches collisions | One writer does all its work then loses to the index. Same serialisation, wasted work |
| Per-workspace sequence with asynchronous chaining | Faster, but the trail can lag the state it describes, which §8.1 forbids |

The cost is real: concurrent writes in one workspace serialise at the end. An
OKR workspace's write rate is human-paced, so this should not bind. **P7-T01
measures it.** If it does bind, the fallback is a sequence column with retry,
which keeps verifiability and trades away the single lock.

## Decision 3: append-only is enforced twice

| Guard | Stops | Does not stop |
|---|---|---|
| No UPDATE or DELETE grant to the application role | The application, including any bug in it | The owner, a superuser |
| A trigger that raises on UPDATE and DELETE | Everybody, including a psql prompt | Someone who disables the trigger |
| The hash chain | Nobody | Nothing, but it makes all of the above detectable |

The third row is the point. The first two raise the cost of tampering; only the
chain makes tampering *visible*. A test disables the trigger, edits a row,
re-enables it, and asserts the verifier names the sequence number.

TRUNCATE is deliberately not blocked: it empties the table, which is obvious the
moment anybody verifies, and anyone who can truncate can drop the table anyway.
Blocking it would only break the test harness's per-test reset.

The grants live in `packages/db/grants.ts`, not in a migration, because the
application role's name belongs to the deployment. One function is called by the
test harness and by the P1-T09 wizard, so the tests and production cannot
disagree about what the role may do.

## The verifier must not pass while blind

`verifyAllChains` needs to enumerate workspaces. The tenant floor hides them
from any connection with no workspace setting, and `force row level security`
applies that to the table owner too, so only a superuser or a BYPASSRLS role can
list tenants.

The first implementation returned an empty list and the command printed
"0 chain(s) intact", which reads as a pass. It now refuses with exit code 2 and
says why. Naming workspaces as arguments works from any role, because that
supplies the tenant setting.

This is the same failure shape as the soft-delete gate found in P1-T06: a check
that cannot see anything reporting success. Worth watching for in every gate.

## What is still a seam

| Seam | Filled by | Today |
|---|---|---|
| `resolveActor`'s level | P2-T02 `can()` | Every active member resolves to `full` |
| Access bindings written by an operation | P2-T01 | Not written; the pipeline has the slot |
| Typed activity catalogue and per-kind payloads | P2-T07 | `kind` is a free string; the table is real |
| `context_id` on activities | P2-T07's fail-closed resolver | Nullable, unset |
| REST, OpenAPI, MCP, CLI, chat projections | P5-T07 onwards | The internal typed client is the first projection |
| Optimistic concurrency versions (§14) | P3-T04 | Nothing here has a conflict to lose yet |

The level comparison in `runOperation` is real machinery over a placeholder
answer. When P2-T02 lands, one function changes and no handler does.

## Acceptance criteria

| Given | When | Then |
|---|---|---|
| Any committed mutation | The chain is verified | It is intact |
| A mutation that throws after its change | The transaction ends | No audit row, no activity row, no outbox row, no change |
| A rolled-back mutation, then another | The chain is read | Sequence numbers are contiguous; the failure consumed none |
| A member who is not in the workspace | They run an operation | Not-found, and nothing is written |
| A suspended member | They run an operation | Not-found, the same answer an outsider gets |
| The application role | It updates `audit_events` | Permission denied |
| A superuser | It updates `audit_events` | The trigger refuses |
| Someone who disables the trigger and edits a row | The chain is verified | Broken, at that sequence number |
| Five concurrent writes in one workspace | The chain is read | Contiguous and verifiable |
| A role that cannot enumerate workspaces | `audit:verify` runs | It refuses and explains, rather than reporting success |
