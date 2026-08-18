# The gates, and how to pass them

Every check CI runs, what only it can catch, and the exact command to run it
before pushing. Written for whoever is doing the work, human or agent.

`IMPLEMENTATION-PLAN.md` says what to build and `CLAUDE.md` says how to work.
This file says what will refuse the work, and why each refusal exists.

## Run these before every push

In this order. The first four take seconds; the rest take minutes.

```
pnpm typecheck        # strict types across all ten packages
pnpm lint             # Biome
pnpm dead-code        # knip
pnpm db:lint          # migration rules, then soft-delete usage
pnpm check:boundaries # the architecture gate
pnpm check:licences   # dependency licences
pnpm test             # unit and integration, needs a database
pnpm build            # then pnpm test:e2e
```

If all of those pass locally, CI passes, with one exception named under
**Sign-off** below that no local command checks unless you ask it to.

## What CI runs, job by job

| Job | Steps | Skipped when |
|---|---|---|
| Types, lint and dead code | `turbo run typecheck --affected`, `pnpm lint`, `pnpm dead-code`, `pnpm db:lint`, `pnpm check:boundaries` | The push changed no code |
| Tests | `pnpm test:ci`, sharded, against a real Postgres | The push changed no code |
| End to end | `pnpm db:up`, Chromium, `pnpm build`, `pnpm test:e2e` | The push changed no code |
| Compose target | Builds the Docker image and drives the first-run wizard | The push changed no code |
| Helm chart | Chart checks, then a real install into a kind cluster | The push changed no code |
| Flakiness report | Merges the shard reports and fails on real failures | Tests were skipped |
| Build | `turbo run build --affected` | The push changed no code |
| Licences and sign-off | `pnpm check:licences`, `pnpm check:signoff` | Sign-off runs on pull requests only |

A documentation-only change skips every code job. That is why a `.md` edit comes
back green in a minute and a one-line code change does not.

## The gates that catch what review does not

These four have actually caught defects here. Each entry says what it refuses,
and what the defect looked like when it slipped past a human reading the diff.

### `pnpm db:lint`

Two linters. The migration linter reads every `.sql` file; the soft-delete
linter reads every query in the workspace.

| It refuses | Because |
|---|---|
| A table created without `force row level security` in the same file | `enable` alone is not the tenant floor. The table owner bypasses the policy, and the owner is the role migrations run as |
| A table with no row-level security policy in the same migration | A policy added later leaves a window where the table was open |
| A business table with no `deleted_at` and no `-- openokr:hard-delete: <reason>` marker | Soft delete is the repository default. Hard delete is allowed, with a stated reason |
| A query using `from(table)` with no soft-delete scope | Deleted rows come back. Use `activeOnly(table, ...)`, or `includeDeleted(table, ...)` when reviving a row is the point |

A marker needs the colon and a reason after it. `-- openokr:hard-delete` with no
colon reads as prose, and the check still fails.

**Also true, and not linted.** A policy needs `with check` as well as `using`,
or it constrains reads and leaves writes free to carry another workspace's id.
Use the missing_ok form of `current_setting` so an unscoped request returns
nothing instead of raising:

```sql
alter table t enable row level security;
alter table t force row level security;

create policy tenant_isolation on t
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
```

### `pnpm check:boundaries`

| It refuses | Because |
|---|---|
| A vendor SDK imported outside `packages/adapters` | Every runtime-sensitive capability goes through a port |
| `.insert`, `.update` or `.delete` outside the Operation pipeline | A write that commits with no audit row, no activity row and no outbox row |
| Application code reaching a driver directly on a write path | The same reason |

A helper called only from inside an Operation's `execute` still trips this,
because the checker cannot see the caller. Mark it:

```ts
// openokr:allow-mutation: the calling Operation's own transaction.
await tx.update(table).set(...)
```

The marker sits on the line **immediately above the statement**, and it needs
the colon and a reason. A marker without them is invisible to the gate, which is
how three writes once shipped unmarked and unnoticed.

### `pnpm dead-code`

Reports files nothing imports and exports nothing names. It is the only gate
that catches a **server action written and never wired to a component**, which
looks finished in review and is unreachable in the product.

When it flags something, wire it or delete it. An ignore entry in `knip.json` is
a last resort for work genuinely in flight, and it belongs on the task's
`STATUS.md` row with the sentence that says when it comes out again.

### The test suites

The unit and integration suites are the only gate that catches a write that
**refuses at run time**. Typecheck and lint cannot see an action that throws the
moment somebody calls it.

On this machine the harness needs pointing at the native Postgres, and the
worker count kept down:

```
TEST_DB_HOST=localhost TEST_DB_PORT=5432 TEST_DB_SUPERUSER=postgres TEST_DB_PASSWORD=postgres
node node_modules/vitest/vitest.mjs run --no-file-parallelism
```

`--no-file-parallelism` is not optional here. The default worker count opens
more connections than this machine's `max_connections` allows, and the failures
that produces look like real bugs in unrelated code.

## Sign-off

Every commit needs a `Signed-off-by` trailer. Commit with `-s`:

```
git commit -s -m "P4-T02: the title"
```

CI checks this **on pull requests only**, so a branch can look green for days
and fail the moment a pull request opens. Check it yourself first:

```
pnpm check:signoff origin/main HEAD
```

To fix commits that already exist:

```
git commit --amend -s               # the most recent one
git rebase --signoff origin/main    # several
```

The rebase rewrites every commit on the branch, so agree it with whoever else is
working there before running it. On a branch two people share, that is a
conversation, not a command.

## Two mechanics of this machine

**Commit messages.** `git commit -m` with double quotes inside the message
breaks on this shell. Write the message to a file and use `-F`:

```
git commit -s -F /path/to/message.txt
```

**Never rewrite a source file through PowerShell's `Get-Content | Set-Content
-Encoding utf8`.** It mangles every non-ASCII character in the file, and this
repository's comments are full of section signs. Use an editor.

## What a green gate does not tell you

Every gate above can pass while the product is broken. Six defects reached this
repository with `typecheck` and `lint` green, and every one was found by running
the product or a gate that reads more than types:

| Defect | Green under | Found by |
|---|---|---|
| A comment thread the page never rendered | typecheck, lint | Opening the page |
| Three tables with the tenant floor open | typecheck, lint | `pnpm db:lint` |
| Every comment write refusing at run time | typecheck, lint | The database suite |
| A chunker that could not terminate | typecheck, lint | The suite dying on it |
| Two writes reachable at `view` level | typecheck, lint | The registry test |
| A chart drawing every value backwards | typecheck, lint, tests | Looking at it |

So the Definition of Done has two separate requirements, and a task meets both
or neither:

1. Every gate above is green.
2. The change was driven **in a real browser against a real database**.

The `STATUS.md` row says which of the two actually happened. Writing "quality
checks passed" when only the first happened is the failure this list is made of.

## When a gate is wrong

It happens. The answer is never to weaken it quietly.

- If a rule is wrong, say so on the task's `STATUS.md` row with the reasoning,
  and ask the human. Rules in `METHOD.md`, and the thresholds in its §11
  registry, are human decisions and never a developer's.
- If a gate needs an exception, the exception carries its reason in the file
  itself, and the row says when it is removed.
- If a test asserts a number the canon owns, the test is wrong rather than the
  canon. Read the number from the registry the way the engine does, so the next
  tuning does not break it.
