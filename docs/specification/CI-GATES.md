# The gates, and how to pass them

Every check continuous integration runs, what only it can catch, and the exact
command to run it before pushing. Written for whoever is doing the work, human
or agent.

`CONTRIBUTING.md` says how to get a development instance running and
`CLAUDE.md` says how an agent works in this repository. This file says what
will refuse the work, and why each refusal exists.

## Run these before every push

In this order. The first few take seconds; the rest take minutes. A push should
leave continuous integration green, and every one of these is cheaper to run
locally than to discover on a pull request.

```
pnpm typecheck        # strict types across every package
pnpm lint             # Biome. Read the whole tail, not the last line
pnpm dead-code        # knip
pnpm db:lint          # migration rules, shipped migrations unchanged, then soft-delete usage
pnpm check:boundaries # the architecture gate
pnpm check:licences   # dependency licences
pnpm check:air-gap    # the air-gap checklist, against the guide
pnpm check:docs       # links, reachability and commands in docs/
pnpm check:contract   # the committed OpenAPI document against the registry
pnpm method:check     # packages/method against METHOD.md
pnpm test             # unit and integration, needs a database. One run at a time
pnpm build            # then pnpm test:e2e
pnpm check:signoff origin/main HEAD   # CI runs this on pull requests only
pnpm check:changeset origin/main HEAD # and this one
```

**`pnpm test` needs a PostgreSQL with `pgvector`.** `pnpm db:up` starts one in
Docker, with PgBouncer and the MySQL the FlowyTeam connector's suites read.
`TEST_DB_PORT` points the suite at a PostgreSQL you already run instead. Never
run two suites against the same database at once: the harness creates and
drops a database per worker, so a second run tears the first one's out from
under it.

**Read `pnpm lint`'s last three lines, not its last one.** Biome counts errors,
warnings and infos on three separate lines in that order, so a tail short
enough to cut the first one shows two clean-looking numbers over a red build.
The script passes `--max-diagnostics=400`, because the default cap of 20 stops
Biome emitting the rest, and an error past the cap is neither shown nor
counted.

**`pnpm lint` refuses a TypeScript parameter property, and that rule earns its
place.** `constructor(readonly x: string)` is valid TypeScript that every entry
point in this repository refuses at run time: they all run under Node's
`--experimental-strip-types`, which erases types without transpiling. Vitest
transpiles, so a suite stays green while the real command dies on its first
import. Write the field out and assign it in the constructor body.

If all of those pass locally, CI passes, with the two exceptions named under
**Dependency review** and **Sign-off** below.

## What CI runs, job by job

| Job | Steps | Skipped when |
|---|---|---|
| Types, lint and dead code | `turbo run typecheck --affected`, `pnpm lint`, `pnpm dead-code`, `pnpm db:lint`, `pnpm check:boundaries`, `pnpm check:air-gap`, `pnpm check:docs`, `pnpm method:check`, `pnpm check:contract` | The push changed no code |
| Tests | `pnpm test:ci`, sharded, against a real Postgres | The push changed no code |
| End to end | `pnpm db:up`, Chromium, `pnpm build`, `pnpm test:e2e` | The push changed no code |
| Accessibility and web vitals | Part of the same end-to-end job. `s43-accessibility.spec.ts` scans every screen the route tree lists and fails on a `serious` or `critical` axe finding; `s43b-accessibility-keyboard.spec.ts` drives the primary flows with no mouse; `s44-web-vitals.spec.ts` fails on a TECHNICAL-PLAN §13.1 paint or interaction budget. A screen added with no coverage is scanned anyway, because the list is derived rather than maintained | With the end-to-end job |
| Compose target | Builds the Docker image and drives the first-run wizard | The push changed no code |
| Helm chart | Chart checks, then a real install into a kind cluster | The push changed no code |
| Flakiness report | Merges the shard reports and fails on real failures | Tests were skipped |
| Build | `turbo run build --affected` | The push changed no code |
| Licences and sign-off | `pnpm check:licences`, `pnpm check:signoff` | Sign-off runs on pull requests only |
| Changeset | `pnpm check:changeset` | Refuses a branch that changes what an instance does and names no version bump. Pull requests only |
| Dependency review | `actions/dependency-review-action`, `fail-on-severity: moderate` plus the licence allow list | Pull requests only. Nothing local checks it |
| CodeQL | GitHub code scanning | Its own workflow. Nothing local checks it |

A documentation-only change skips every code job. That is why a `.md` edit comes
back green in a minute and a one-line code change does not.

### Dependency review

It runs on pull requests only, reads the advisory database rather than the
repository, and fails on **moderate**. So it can turn red on a branch that has
not changed a single dependency: an advisory published today against a package
installed last month is enough.

The fix is usually a lockfile refresh rather than an override. When a
transitive package has a patched version inside the range its parent already
declares, `pnpm update -r --depth Infinity <package>` is the whole change.
Reach for `overrides` only when the parent's own range excludes the fix, and
say why in the change.

`gh pr checks <number>` shows it, because a green `pnpm test:ci` says nothing
about it.

## The gates that catch what review does not

Each entry says what the gate refuses, and why.

### `pnpm db:lint`

Two linters. The migration linter reads every `.sql` file; the soft-delete
linter reads every query in the workspace.

| It refuses | Because |
|---|---|
| A table created without `force row level security` in the same file | `enable` alone is not the tenant floor. The table owner bypasses the policy, and the owner is the role migrations run as |
| A table with no row-level security policy in the same migration | A policy added later leaves a window where the table was open |
| A business table with no `deleted_at` and no `-- openokr:hard-delete: <reason>` marker | Soft delete is the repository default. Hard delete is allowed, with a stated reason |
| A query using `from(table)` with no soft-delete scope | Deleted rows come back. Use `activeOnly(table, ...)`, or `includeDeleted(table, ...)` when reviving a row is the point |
| A character in a migration that a non-UTF8 database cannot store | You do not control the encoding of somebody else's install. `§` and `—` are safe; box drawing (`─`, `│`, `└`) is not |
| A migration the newest release tag (`v*`) holds that is now different or gone, comments and blank lines included | Every instance that ran it refuses to upgrade with "was edited after it ran", and a fresh-database CI run cannot see that. Compared through the runner's own checksum. Needs the tags in the checkout; without them the linter says it did not compare |

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

**A migration that has run somewhere is never edited.** `_migrations` records
a checksum per file, and an edit raises "Applied migration X was edited after
it ran" on every database that applied it. Migrations are forward-only: fix
forward with a new one.

### `pnpm check:docs`

| It refuses | Because |
|---|---|
| A relative link in `docs/` that resolves to nothing | A reader follows it and believes the page exists. Renaming a page is the usual cause |
| A page under `docs/install`, `docs/admin` or `docs/runbooks` that nothing in `docs/README.md` leads to | A page nobody can find is a page nobody wrote |
| `pnpm <script>` on a page when `package.json` defines no such script | An instruction that cannot be followed, which is worse than no instruction |
| A threshold `docs/handbook/numbers.md` quotes that the method registry disagrees with | A handbook telling a practitioner something the product does not do |
| `docs/api/reference.md` drifting from the contract | The registry moved and the page did not. `pnpm gen:docs` rewrites it |

`docs/specification`, `docs/design` and `docs/mockups` are linked from the
index by folder rather than page by page.

### `pnpm check:air-gap`

| It refuses | Because |
|---|---|
| A CDN or font service named in shipped source | An isolated instance cannot reach one, and the page that names it fails with nothing to show |
| `next/font/google` on any screen | It fetches while it builds, so an air-gapped build fails |
| `curl`, `wget`, `apk add` or a package install in the image's runtime stage | A container that installs at boot needs a registry it does not have |
| `ai_providers.enabled` defaulting to true | An instance nobody configured would call out |
| `fetch` on an absolute address outside `packages/adapters` | `outboundFetch` validates the literal host and the resolved address, follows no redirect and caps size and time. A direct call does none of that |
| A component registry fetched at render time | Components are added at build time, so an air-gapped install already carries them |
| A checklist row in `docs/runbooks/air-gap.md` with no check, or a check with no row | The guide is a claim about the product, and a claim nothing tests stops being true without anybody noticing |

Two of the guide's claims are deliberately not here: watching for egress with
`tcpdump`, and proving a restarted container still works without the network.
Both are about a machine on an isolated network. The guide writes them out for
whoever commissions the instance.

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
the colon and a reason. A marker without them is invisible to the gate.

### `pnpm dead-code`

Reports files nothing imports and exports nothing names. It is the only gate
that catches a **server action written and never wired to a component**, which
looks finished in review and is unreachable in the product.

When it flags something, wire it or delete it. An ignore entry in `knip.json` is
a last resort, and it carries a comment saying when it comes out again.

### The test suites

The unit and integration suites are the only gate that catches a write that
**refuses at run time**. Typecheck and lint cannot see an action that throws the
moment somebody calls it.

**A migration that adds a table needs a row in TECHNICAL-PLAN §7.2.**
`packages/importer/test/mapping-coverage.test.ts` fails naming each table with
no row, and each row naming a table that does not exist. The row either names
the FlowyTeam source or says `No legacy source` with a reason.

`pnpm test` runs Turbo's per-package tasks, so it caches and only re-runs what
changed. `pnpm test:ci` is the whole repository as one suite, which is what CI
shards and what you want before a pull request. If you run Vitest directly,
pass `--config vitest.ci.config.ts`: it sets `projects: ["packages/*",
"apps/*"]`, which is what gives each package its own `include`, `exclude` and
environment. Without it React tests run in a node environment and the
deliberately flaky fixtures in `packages/test-support/fixtures/flaky/` are swept
in, and the run reports failures that are the invocation rather than the code.

**Creating a database in a test:** name the encoding, and copy `template0`
rather than `template1`, which carries the cluster's own encoding:

```sql
create database x encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0
```

## Sign-off

Every commit needs a `Signed-off-by` trailer, the Developer Certificate of
Origin. Commit with `-s`:

```
git commit -s -m "Fix the scoring stage for company reviews"
```

CI checks this **on pull requests only**, so a branch can look green for days
and fail the moment a pull request opens. Check it yourself first:

```
pnpm check:signoff origin/main HEAD
pnpm check:changeset origin/main HEAD
```

To fix commits that already exist:

```
git commit --amend -s               # the most recent one
git rebase --signoff origin/main    # several
```

The rebase rewrites every commit on the branch, so agree it with whoever else is
working there before running it.

## What a green gate does not tell you

Every gate above can pass while the product is broken. A comment thread the page
never rendered, a write refusing at run time, a chart drawing every value
backwards: each of those is green under typecheck and lint. So a change is done
when both of these hold:

1. Every gate above is green.
2. The change was driven **in a real browser against a real database**, when it
   is something a person sees.

Say in the pull request which of the two actually happened.

## When a gate is wrong

It happens. The answer is never to weaken it quietly.

- If a rule is wrong, say so in the pull request with the reasoning. Rules in
  `METHOD.md`, and the thresholds in its §11 registry, are maintainer
  decisions (GOVERNANCE.md), never a side effect of a code change.
- If a gate needs an exception, the exception carries its reason in the file
  itself.
- If a test asserts a number the canon owns, the test is wrong rather than the
  canon. Read the number from the registry the way the engine does, so the next
  tuning does not break it.
