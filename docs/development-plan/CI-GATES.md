# The gates, and how to pass them

Every check CI runs, what only it can catch, and the exact command to run it
before pushing. Written for whoever is doing the work, human or agent.

`IMPLEMENTATION-PLAN.md` says what to build and `CLAUDE.md` says how to work.
This file says what will refuse the work, and why each refusal exists.

## Run these before every push

In this order. The first four take seconds; the rest take minutes. **All of
them, every time.** CLAUDE.md's rule is that a push leaves continuous
integration green, and a push happens only when Agung asks for one, so there is
always time to run the list.

```
pnpm typecheck        # strict types across all ten packages
pnpm lint             # Biome. Read the whole tail, not the last few lines
pnpm dead-code        # knip
pnpm db:lint          # migration rules, then soft-delete usage
pnpm check:boundaries # the architecture gate
pnpm check:licences   # dependency licences
pnpm check:contract   # the committed OpenAPI document against the registry
pnpm method:check     # packages/method against METHOD.md
pnpm test             # unit and integration, needs a database. One at a time
pnpm build            # then pnpm test:e2e
pnpm check:signoff origin/main HEAD   # CI runs this on pull requests only
```

**`pnpm test` at the root stops the whole run when one package fails**, and
`packages/db`'s pooling spike always fails here for want of PgBouncer, which
would take `packages/core` down with it. Run them apart:

```
TEST_DB_PORT=5432 pnpm exec turbo run test \
  --filter=!@openokr/core --filter=!@openokr/db -- --no-file-parallelism
TEST_DB_PORT=5432 pnpm --filter @openokr/db exec vitest run --no-file-parallelism
TEST_DB_PORT=5432 pnpm --filter @openokr/core exec vitest run --no-file-parallelism
```

The last one takes about half an hour. Start it and do document work while it
goes, but **do not edit the package mid-run** or the result is stale.

**Read `pnpm lint`'s last three lines, not its last one.** Biome counts errors,
warnings and infos on three separate lines in that order, so a `tail` short
enough to cut the first one shows two clean-looking numbers over a red build.
That has cost this branch twice. The script also passes
`--max-diagnostics=400`: the default cap of 20 stops Biome *emitting* the rest,
so an error past the cap is neither shown nor counted, and this repository is
long past 20.

**`pnpm lint` refuses a TypeScript parameter property, and that rule earns its
place.** `noParameterProperties` is on because `constructor(readonly x: string)`
is valid TypeScript that **every entry point in this repository refuses at
runtime**: they all run under Node's `--experimental-strip-types`, which erases
types without transpiling. Vitest transpiles, so a suite stays green while the
real command dies on its first import. It has happened twice. `pnpm
import:flowyteam` died on `mappers/reconcile.ts` at P6-T04a with 107 tests
green, and again on `ports/realtime.ts` at P6-T04c with 153 green, that second
time because the importer started importing the adapters barrel for one driver
and the barrel loads every port. Turning the rule on found a third in
`packages/agents/src/structured-extraction.ts` that nothing had run yet. Write
the field out and assign it in the constructor body.

If all of those pass locally, CI passes, with one exception named under
**Sign-off** below that no local command checks unless you ask it to.

## What CI runs, job by job

| Job | Steps | Skipped when |
|---|---|---|
| Types, lint and dead code | `turbo run typecheck --affected`, `pnpm lint`, `pnpm dead-code`, `pnpm db:lint`, `pnpm check:boundaries`, `pnpm method:check`, `pnpm check:contract` | The push changed no code |
| Tests | `pnpm test:ci`, sharded, against a real Postgres | The push changed no code |
| End to end | `pnpm db:up`, Chromium, `pnpm build`, `pnpm test:e2e` | The push changed no code |
| Accessibility and web vitals | Part of the same end-to-end job (P7-T05). `s43-accessibility.spec.ts` scans every screen the route tree lists and fails on a `serious` or `critical` axe finding; `s43b-accessibility-keyboard.spec.ts` drives the primary flows with no mouse; `s44-web-vitals.spec.ts` fails on a §13.1 paint or interaction budget. A screen added with no coverage is scanned anyway, because the list is derived rather than maintained | With the end-to-end job |
| Compose target | Builds the Docker image and drives the first-run wizard | The push changed no code |
| Helm chart | Chart checks, then a real install into a kind cluster | The push changed no code |
| Flakiness report | Merges the shard reports and fails on real failures | Tests were skipped |
| Build | `turbo run build --affected` | The push changed no code |
| Licences and sign-off | `pnpm check:licences`, `pnpm check:signoff` | Sign-off runs on pull requests only |
| Dependency review | `actions/dependency-review-action`, `fail-on-severity: moderate` plus the licence allow list | Pull requests only. Nothing local checks it |

**Dependency review is the second gate no local command covers**, and the
first is sign-off above. It runs on pull requests only, reads the advisory
database rather than the repository, and fails on **moderate**, so it can turn
red on a branch that has not changed a single dependency: an advisory
published today against a package installed last month is enough. It refused
PR #40 on 3 September 2026 over two moderate advisories against a transitive
`qs`, while every other check on the same commit passed.

The fix is usually a lockfile refresh rather than an override. `qs` arrives
under `@modelcontextprotocol/sdk` through `express` and `body-parser`, and
`body-parser` declares `^6.15.2`, so the patched `6.16.0` satisfied a range the
tree already had: `pnpm update -r --depth Infinity qs` was the whole change.
Reach for `overrides` only when the parent's own range excludes the fix, and
say why in the change.

`gh pr checks <number>` is how to see it, because a green `pnpm test:ci` says
nothing about it. Note that a run listed as failed against an older head sha
stays in `gh run list` forever; what matters is the checks on the current head.

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

`pnpm test` is the shorter route and runs Turbo's per-package tasks, so it
caches and only re-runs what changed. The command below is the whole repository
as one suite, which is what CI shards and what you want before a pull request.

On this machine the harness needs pointing at the native Postgres, and the
worker count kept down:

```
TEST_DB_HOST=localhost TEST_DB_PORT=5432 TEST_DB_SUPERUSER=postgres TEST_DB_PASSWORD=postgres
node node_modules/vitest/vitest.mjs run --config vitest.ci.config.ts --retry=2 --no-file-parallelism
```

`--no-file-parallelism` is not optional here. The default worker count opens
more connections than this machine's `max_connections` allows, and the failures
that produces look like real bugs in unrelated code.

**`--config vitest.ci.config.ts` is not optional either**, and leaving it off is
worse than forgetting the database, because the run finishes and reports
failures rather than refusing. That config sets `projects: ["packages/*",
"apps/*"]`, which is what makes each package use its own `include`, `exclude`
and environment. Without it, one default configuration is applied to every file
in the repository, and two things go wrong at once: React tests needing a DOM
run in a node environment, and `packages/test-support/fixtures/flaky/` is swept
in. That directory exists to fail on the first attempt and pass on the retry,
which is how the flakiness reporter is tested, so `--retry=2` belongs with it.

This cost a run here: 46 failures across 16 files, every one of them the
invocation rather than the code. The same commit was green on CI at the same
moment. If a local run fails in files your change never touched, check the
command before you start reading the diff.

#### What still cannot run without Docker

`packages/db/test/pooling-spike.test.ts` needs PgBouncer, which arrives with
`pnpm db:up`. Without Docker it fails four tests with `ECONNREFUSED` on port
56432. That is the machine, not the change. Everything else in the repository
runs against a native Postgres.

#### The encoding trap

The Windows Postgres installer initialises a cluster as **WIN1252**, while the
Linux Postgres CI runs is **UTF8**. A `create database` with no encoding clause
inherits whichever the cluster has, so the same SQL succeeds on CI and fails on
a developer's machine with:

```
character with byte sequence 0xe2 0x94 0x80 in encoding "UTF8"
has no equivalent in encoding "WIN1252"
```

Two rules follow.

**Creating a database in a test:** name the encoding, and copy `template0`
rather than `template1`, which carries the cluster's own encoding and will
refuse the copy.

```sql
create database x encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0
```

**Writing a migration:** every character in the file has to survive the target
database's encoding, and you do not control what that is on somebody else's
install. `§` and `—` exist in WIN1252 and are safe. Box drawing (`─`, `│`, `└`)
does not, and a decorative rule made of it stops the migration dead.

`pnpm db:lint` refuses this now, naming the character and how many times it
appears. The rule was added after migration 0032 shipped 123 box-drawing
characters in two decorative comment rules, and nobody found out until a
developer on Windows could not run the test suite. It is mechanical, so nobody
has to remember it.

If you ever do need to edit a migration that has already run somewhere,
`_migrations` records a checksum per file and the change raises **"Applied
migration X was edited after it ran"** on every database that applied it. There
is no command that repairs the ledger: drop the database and migrate again. That
is why editing one is a decision rather than a fix, and why it is on the
ask-a-human list in `CLAUDE.md`.

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

## What this machine cannot run, and what covers it

Added 7 September 2026, alongside CLAUDE.md's rule that a push must leave every
CI job green. **A gate you did not run is not a gate that passed**, so this is
the list of the ones to name rather than quietly skip.

| Gate | Why not here | Where it does run |
|---|---|---|
| `deploy/helm/check.sh` | `helm` is not installed | The `helm` CI job |
| `deploy/helm/cluster-test.sh` | Needs `helm` and a kind cluster | The `helm` CI job |
| `deploy/docker/smoke-test.sh` | Needs Docker | The `deploy` CI job |
| `packages/db/test/pooling-spike.test.ts` | Needs PgBouncer, which needs Docker | Every `test` shard |
| The S3 round trip in `storage-s3.test.ts` | Needs an S3-compatible service | Nowhere yet. Point `TEST_S3_*` at a MinIO |
| The FlowyTeam connector's three suites | Need a MySQL | Every `test` shard |
| CodeQL, Dependency review | Not runnable locally at all | Their own workflows |

Everything else runs here. `TEST_DB_PORT=5432` against the native Postgres is
what makes the unit suites and the end-to-end suite work without Docker, and
CLAUDE.md's Commands section has the exact lines.

**So the only way to know those seven are green is to watch the run**, which
CLAUDE.md now requires after every push. On 6 September 2026 three of them went
red at once behind a single change and nobody noticed for a day: the Helm chart
check, CodeQL and Dependency review, all from the commit that added the S3
driver. Every local gate was green throughout.

**A push to `agung` with no open pull request produces no run at all**, because
`ci.yml` triggers on `push` to `main` and on `pull_request`. That is the state
most likely to be mistaken for success.

**The four `pooling-spike` failures are the expected local result**, not a
regression: 105 of 109 in `packages/db` pass and those four need PgBouncer. Say
so rather than reporting the suite as red or as green.

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
