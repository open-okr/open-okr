# The work split: Agung and Obed

Who takes which task, what can run at the same time, and what has to wait.
Rewritten 2026-08-14, after Phase 3 landed and the two lanes were merged.

`IMPLEMENTATION-PLAN.md` is the authority. This file only reads its dependency
lines and turns them into two lanes. If the two ever disagree, the plan wins and
this file gets fixed.

## Where things stand

**Phase 3 is complete.** All eighteen tasks have landed on `agung`. Ten rows are
`done`, seven are `in_review`, one is `in_progress`. Only a human sets `done`, so
those eight are waiting on a read rather than on work.

Two Phase 4 tasks are already under way, both Obed's, both started in parallel
with the end of Phase 3:

| Task | State |
|---|---|
| P4-T00 design gate | All three design documents drafted. Eight items were blocked on P3-T14 to P3-T17 and are now unblocked |
| P4-T13 embeddings | Schema, chunker and service in. Needs integration tests and the outbox worker |

## The dependency map

| Task | Size | Depends on | Unblocks |
|---|---|---|---|
| P4-T00 Coaching design gate | M | Phase 3 complete | T01 |
| P4-T01 The method package | L | T00 | T02, T04 |
| P4-T02 Quality engine and Draft Coach | L | T01, P3-T04 | T03 |
| P4-T03 Publish gates | M | T02, P3-T03 | end of branch |
| P4-T04 Nudge engine and escalation | L | T01, P3-T08 | T05, T07 |
| P4-T05 The OKR Champion agent | L | T04, P2-T17 | T06 |
| P4-T06 The OKR Coach agent | L | T05 | T15 |
| P4-T07 Weekly session: confidence, voting, blockers | L | T04, P3-T07 | T08 |
| P4-T08 Weekly session: commitments, digest, streaks | M | T07 | T09 |
| P4-T09 Monthly review and decision log | M | T08 | T10 |
| P4-T10 Quarterly review: shell, scoring, narratives | L | T09 | T11 |
| P4-T11 Quarterly review: retro, diagnostic, reset | L | T10 | T12 |
| P4-T12 Minutes, exports and review feed-forward | M | T11, P3-T15 | end of branch |
| P4-T13 Embeddings and retrieval | L | P2-T15 | T14 |
| P4-T14 Copilot | L | T13, P1-T07 | T15 |
| P4-T15 Coaching and rhythm assists | M | T14, T06 | end of phase |

Two lanes are genuinely independent. The retrieval lane (T13, then T14) shares
nothing with the coaching lane (T01 through T12). They meet once, at T15.

## The split

**Agung takes the method core and the sessions. Obed takes the design gate he
has already drafted, retrieval, and the coach surfaces.**

This differs from the first version of this document in one place: P4-T00 was
Agung's and Obed drafted it. Reality wins over the plan on a task already done.

| Stage | Agung | Obed | At the same time? |
|---|---|---|---|
| 0 | Review the drafts, fill the eight items P3-T14 to P3-T17 have now unblocked | Same, as their author | Together, then the human approves |
| 1 | P4-T01 method package | Finish P4-T13: integration tests, the outbox worker | Yes |
| 2 | P4-T04 nudge engine | P4-T14 copilot | Yes |
| 3 | P4-T02 waits on T01, so Obed takes it; Agung starts T07 | P4-T02 Draft Coach, then P4-T03 publish gates | Yes |
| 4 | P4-T07, T08, T09, T10, T11, T12 in that order | P4-T05 Champion, then P4-T06 Coach, then P4-T15 assists | Yes |

Eight tasks each. Five of Obed's are size L against four of Agung's, but the
session chain is six tasks that cannot be split, so the wall-clock is closer
than the count suggests.

### Handoffs

Two moments where one lane waits on the other, both from Agung to Obed.

| Handoff | What has to be true |
|---|---|
| P4-T01 to P4-T02 | The method package exports the twenty-six-check catalogue and the threshold registry, and its conformance suite passes |
| P4-T04 to P4-T05 | The nudge table, the rule registry and the escalation ladders are in, with the trigger catalogue resolving rule keys |

## The gate before any of it

P4-T00 needs an explicit "design approved" from the human, with the rule corpus
and the trigger catalogue reviewed line by line. Fifty-eight items; eight of them
were blocked on Phase 3 and are now answerable. Nothing in stage 1 starts before
that approval.

## File ownership

| Area | Owner |
|---|---|
| `packages/method` | Agung during P4-T01. Shared after, and any change is a message to the other lane |
| Nudge tables, review-inbox surfaces, admin S-36 nudge card | Agung |
| Session tables and screens S-22 to S-25 | Agung |
| `packages/agents` | Obed |
| `packages/adapters` ai and embedding drivers | Obed |
| Goal page coach strip, drafting surface S-09, alignment studio review tab | Obed |
| Copilot panel S-39 | Obed |

The one shared file with real collision risk is `packages/method`. Everything
else lands in one lane or the other.

## Rules the merge taught us, which both lanes now follow

The first merge of the two lanes brought in six defects. Every one of them
passed `pnpm typecheck` and `pnpm lint`, because neither of those can see any of
this. These are not suggestions.

**Run the gates that actually catch things.** Before a task is called done:

| Command | What only it catches |
|---|---|
| `pnpm db:lint` | A table shipped without `force row level security`, a policy with no `with check`, a query with no soft-delete scope |
| `pnpm check:boundaries` | A write outside the Operation pipeline, a vendor SDK outside `packages/adapters` |
| `pnpm dead-code` | A server action written and never wired to a component |
| The real-database suite | A write that refuses at run time. `TEST_DB_HOST=localhost TEST_DB_PORT=5432 TEST_DB_SUPERUSER=postgres TEST_DB_PASSWORD=postgres`, and `--no-file-parallelism` on this machine |

**`enable row level security` is not the tenant floor.** Without `force`, the
table owner bypasses the policy, and the owner is the role migrations run as.
Every policy needs `with check` as well as `using`, or it constrains reads and
leaves writes free to carry another workspace's id. Use the missing_ok form,
`nullif(current_setting('app.workspace_id', true), '')::uuid`, so an unscoped
request returns nothing instead of raising.

**A read never has `context.actor.memberId`.** Only `runOperation` resolves an
actor, against rows loaded inside the writing transaction. A read action has to
resolve the member itself from the user id.

**`set_config(..., true)` is transaction-local.** Outside a transaction it is
discarded the instant the statement that set it commits. Use `withWorkspace`.

**Migration numbers.** The tree is at 0032; the next is **0033**. 0029 is a
permanent gap: it was P3-T16's original number, renumbered when the lanes
collided, and closing the gap now would mean rewriting history for cosmetics.
Agree the number before writing the file when both lanes have one in flight.

**0031 and 0032 were edited in place** to close the tenant holes, with the
human's approval. The migration runner hashes content, so anyone who applied
either before 2026-08-14 has to recreate their development database.

## Open decisions, for the human

1. **Does "Phase 3 complete" mean every row `done`?** P4-T00's dependency line
   says complete; eight rows sit at `in_review` awaiting a read.
2. **The write-access floor.** The registry invariant read "every write needs at
   least `edit`". That would force `comments.create` up to `edit` and hand every
   commenter the right to rewrite the objective. The floor is now `edit`
   everywhere except the `comments` and `reactions` domains, plus a new
   assertion that no write anywhere is reachable at `view`. Recorded on the
   P3-T16 row and reversible.
3. **METHOD.md §3.6, the forecast on sparse data.** Three values inside two days,
   projected six weeks out, reads 672 for a key result whose target is 60.
   Whether the section should require a minimum span before a forecast is shown
   is a practice decision, not a developer's.
4. **The branch policy.** Both lanes are on `agung` today, which worked only
   because the merge was a fast-forward. Two people writing at once need either
   a branch each or a shared integration branch.

## AI credentials: what needs them and when

Every deterministic path has to work with the provider switched off, and
continuous integration proves it. Credentials verify the AI half; they do not
build the product.

| Task | What it needs |
|---|---|
| P4-T13 | An embedding provider, or a local embedding model. The earliest task that cannot finish without one |
| P4-T14 | A chat provider, for streaming answers |
| P4-T05, P4-T06, P4-T15 | A chat provider, to verify drafting and rewriting |
| Everything else | Nothing. Deterministic by design |

Before storing a key: set `OPENOKR_ENCRYPTION_KEY` in `apps/web/.env`. Without
it a fresh root key is generated on every process start, so anything sealed
locally stops opening after a restart.

## The working rules stay the same

Both lanes follow the task loop in `EXECUTION-GUIDE.md` and `CLAUDE.md`.

- A human names the task. Nobody starts the next one on their own.
- Restate the task and confirm the Definition of Ready before writing code.
- Tests first, failing for the right reason.
- Update the `STATUS.md` row, including what is **not** done. Only a human sets
  `done`.
- One commit per task, titled `<TASK-ID>: <title>`, signed off with `-s`.
- Nobody merges their own work.
