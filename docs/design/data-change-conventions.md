# The data-change runner: conventions

P2-T12. This is the reference for anyone writing a script for `pnpm db:change`. The runner itself
is `packages/db/src/data-change.ts`; registered scripts live in `packages/db/src/data-changes/`.

## When a data change, not a migration

A schema migration reshapes a table: adds a column, an index, a constraint. It runs once, forward
only, and is immutable once shipped (EXECUTION-GUIDE §9).

A data change reshapes the rows already in a table. It exists because a migration that adds a
column cannot also know what value every existing row should have — that is a product decision,
often one that needs a query too slow or too large to run inside the migration's own transaction.

Never put a backfill inside a migration file. Never put a schema change inside a data-change
script — the runner has no schema-diffing machinery and is not the place for one.

## The three things every script must be

1. **Versioned.** A script's `name` sorts like a migration's filename: `0001_...`, `0002_...`. The
   runner applies registered scripts in name order.
2. **Batched.** A script's `runBatch` processes a bounded slice of rows — hundreds, not the whole
   table — and returns whether it is `done`. The runner commits after every batch, so a script
   never holds one open transaction over a table with millions of rows.
3. **Idempotent.** Running a script's batch twice over the same rows must never double-apply. In
   practice this almost always falls out of the predicate itself: `where timezone is null` cannot
   match a row a previous batch already set. A script whose effect is not naturally idempotent this
   way needs its own marker column or condition — do not rely on the ledger alone, which only
   guards against re-running a *finished* script, not a batch repeated after a resume.

## Frozen column expectations

Declare every column your SQL reads or writes in `expects`, with the type
`information_schema.columns.data_type` reports for it (`"text"`, `"uuid"`, `"jsonb"`,
`"boolean"`, `"integer"`, `"timestamp with time zone"`, and so on — check with a `\d` in `psql`
if unsure, this is not always the type name you wrote in the Drizzle schema).

The runner checks every expectation before the script's first batch, on every single run, not
once at review time. If a later migration renames or retypes a column a script still assumes,
the run refuses loudly instead of quietly doing something the script's author never intended.

Do not add a column to `expects` "just in case." Only the columns the SQL actually touches —
the point is a precise, checkable contract, not a defensive list.

## Resuming

`runBatch(client, cursor)` receives `null` on a script's first call ever, and otherwise whatever
`cursor` its own previous batch returned. The cursor is opaque to the runner: a script can put
anything string-shaped in it, as long as it is what that same script needs to find its own next
batch. A keyset on a time-ordered primary key (`id`) is almost always the right shape here — cheap
to resume from, and immune to rows shifting position the way an `OFFSET` is not.

A script's batch must select its next slice using the *same* predicate that will still be true
after this batch runs (`where timezone is null and id > $cursor`), never a fixed row count that
assumes nothing else changed the table concurrently.

## The worked example

`packages/db/src/data-changes/0001_backfill_member_timezone.ts` sets a member's `timezone` from
their workspace's own settings, wherever it is still null. Read it end to end before writing a
second script — every convention above appears in it once, with the reasoning next to the code
rather than only here.

## Registering a script

Add it to the `scripts` array `packages/db/src/bin/data-change.ts` passes to `runDataChanges`.
There is no separate registry file the way `packages/core/src/actions/registry.ts` has one — a
short, growing list in the one binary that runs them is enough at this scale, and if that changes
it is easy to extract later without touching any script's own file.

## Running it

```
pnpm db:change
```

Connects with `DATABASE_ADMIN_URL` when set, falling back to `DATABASE_URL` — the same convention
`pnpm db:migrate` uses. Safe to run repeatedly: a completed script is skipped, and an in-progress
one resumes rather than restarting.
