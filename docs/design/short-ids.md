# Short identifiers on every addressable aggregate

Status: approved 10 November 2026 for release 0.7.0 (plan D1), Q1 and Q2 answered as proposed. A schema change on seven tables, so it was designed first (CLAUDE.md). Built in three commits; §6 records where the build moved from what was written here. The not-null half, plan 0.8.0 C1, is "The 0.8.0 step" at the end of §6, built 11 November 2026.

Authority: TECHNICAL-PLAN §3 ("Public identifiers are separate") and DATABASE.md §1.

## 0. What existed

| Piece | Where | Today |
|---|---|---|
| The rule | TECHNICAL-PLAN §3, DATABASE.md §1 | Cycles, goals, key results, KPIs, initiatives, tasks, documents and sessions carry a `short_id`, a random base58 string unique per workspace, used in URLs, the REST API, agent tools, the command line and chat commands. Internal keys are never exposed. An unknown or malformed one answers not-found |
| KPIs | `kpis.short_id`, migration 0026; `shortId()` in `packages/core/src/actions/kpis.ts:317`; unique on `(workspace_id, short_id)` | The only table with one |
| The jump | `search.jump`, `packages/core/src/actions/search.ts:193` | Answers a KPI's short id and null for anything else |
| Everything else | Screens, REST paths, the contract, MCP tools, `okr`, chat commands | Address the seven by UUID |

So the rule is written and broken everywhere but KPIs. Fixing it is not one change: every URL, every contract input and every chat command that names one of the seven would move.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| S1 | **Stage it.** D1 in 0.7.0 is the column, its backfill, and *accepting* a short id wherever an id is accepted. Moving URLs and outputs to short ids is a later row, per surface | Accepting both is additive and safe for a rolling upgrade. Changing what every URL and output says is a breaking change for every bookmark, integration and agent, which PLAN §5.1 spreads over two releases |
| S2 | **The column**: `short_id text`, unique on `(workspace_id, short_id)`, on cycles, goals, key results, initiatives, tasks, documents and sessions (migration 0163). Ten base58 characters from the KPI alphabet. The generator moved from `kpis.ts:317` to `newShortId()` in `packages/db/src/id.ts`, beside `newId()`, drawing from `crypto.randomInt` instead of `Math.random`; `packages/core/src/ids/short.ts` adds the collision retry a write uses (`freshShortId`) and the two shape tests (`isShortId`, `isUuid`) | One generator for all eight tables, the shape KPI links already have. 58^10 is about 4 × 10^17 per workspace, so a collision is retried, never expected. Access is checked on every read, so an id is not a secret, but a predictable generator is no reason to keep |
| S3 | **Two releases for the not-null** (PLAN §5.1). 0.7.0's migration adds the column nullable with the unique index; every write fills it; data change 0034 backfills existing rows in batches. 0.8.0's migration makes it not null | A rolling upgrade has a replica of 0.6 writing rows without one. A not-null column added in the same release refuses its inserts |
| S4 | **One resolver**, `resolveAddress(tx, kind, value)`: a UUID is looked up as today; anything else is looked up as a short id, case-sensitive; both through the access getter, so a short id a reader cannot see answers not-found exactly as a UUID does | The format is not an oracle (§3). One function so no surface accepts one form and refuses the other |
| S5 | **Where it is accepted in 0.7.0**: `search.jump` for all eight kinds; every registry action input that takes one of the seven ids (the contract's schemas widen from `uuid` to "UUID or short id"); the `okr` command line and chat commands, which read the contract | The contract is the one place these are defined, so widening it reaches REST, MCP, the command line and chat in one move |
| S6 | **Where it is shown in 0.7.0**: a "Copy link" on each of the seven's pages and drawers copies a short-id URL, and the routes accept it. Outputs keep returning the UUID as `id` and gain `shortId` beside it | A person can start sharing short links now, and nothing that reads `id` breaks |
| S7 | **Importer**: the FlowyTeam and CSV importers write a short id like any other write. TECHNICAL-PLAN §7.2 gains nothing: a short id has no legacy source | It is generated, never carried |
| S8 | **Archives**: the workspace archive carries short ids, and the archive import keeps them unless one collides in the target workspace, which gets a fresh one. KPIs too, whose colliding row the import used to skip. An archive from before 0.7.0, or one carrying a value that is not a short id, gets fresh ones | A moved workspace's shared links keep working where they can |

## 2. Questions for Akmal

**Q1. Is S1's staging right for 0.7.0**, or should D1 move wholly to 0.8.0? Proposed: **stage it, as S1.** The column, the backfill and accepting both forms are additive; the URL and output switch is a breaking change and belongs to a release whose notes can say so.

**Q2. Ten characters, as KPIs have?** Proposed: **yes**, so every short link has one shape and existing KPI links are unchanged.

## 3. Acceptance criteria

- Given an upgraded instance, when data change 0034 has run, then every row of the seven tables has a short id unique within its workspace.
- Given a goal, when `search.jump` is asked its short id, then it answers the goal's page; given a short id the reader cannot see, then null, as an unknown one.
- Given `goals.read` called with a goal's short id, then it answers as with its UUID; with a malformed value, then not-found, never a validation error.
- Given a replica of 0.6 inserting a goal during the rolling upgrade, then the insert succeeds and data change 0034 fills its short id on its next run.
- Given a workspace archive moved to another instance, when it is imported, then its goals keep their short ids.

## 4. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/short-ids.test.ts` | The generator, collision retry, every create filling one, the resolver's two forms and its not-found |
| Integration | `packages/db/test/data-change.test.ts` | 0034 backfills, batches, keeps what is there, and sees every workspace under the tenant floor |
| Integration | `packages/core/test/portability-import.test.ts` (existing) | A moved goal keeps its short id, and a colliding one gets a fresh one |
| Integration | `packages/core/test/search-palette.test.ts` (existing) | `search.jump` for all eight kinds, a guest, a deleted goal and `kinds` |
| Integration | `packages/core/test/mcp-research.test.ts` (existing) | `fetch` of a short link, and another workspace's reader holding it |
| Contract | `pnpm check:contract` | The widened inputs |
| Unit | `apps/web/test/short-links.test.ts` | The path each Copy link copies, and the redirect keeping its query |
| Browser | `e2e/short-links.spec.ts` | Copy link on a goal and the clipboard, each of the seven's link landing on its page, a key result's link landing on its row, REST by short id, and an unknown one not found |

## 5. What this does not do

- No URL or output switches to short ids in 0.7.0 (S1).
- No vanity or human-readable ids.
- No change to internal joins: UUIDs stay the keys.

## 6. As built

Where the build moved from §1, and why.

| # | Written | Built | Why |
|---|---|---|---|
| B1 | The generator in `packages/core/src/ids/short.ts` | `newShortId()` in `packages/db/src/id.ts`; `ids/short.ts` re-exports it and adds `freshShortId`, `isShortId` and `isUuid` | Data change 0034 lives in `packages/db`, which cannot import `packages/core`. One generator in the lower package is still one; two copies of the alphabet is how a backfilled row stops looking like a written one, the reason `newId` is single too |
| B2 | Data change 0035 | 0034 | The next free number |
| B3 | Unique on `(workspace_id, short_id)` | Not partial, unlike `kpis_short_id_idx` | A deleted row keeps its address, so restoring it never collides and a link to it never comes to mean something else. `freshShortId` checks deleted rows too |
| B4 | Every write fills it | Each service's insert calls `freshShortId`; the Drizzle column also carries `$defaultFn(newShortId)`, as `id` carries `newId` | The default is the backstop for an insert that names none, so 0.8.0's not-null cannot be broken by a write path nobody remembered. The performance dataset (`perf/large-dataset.ts`) draws one per row too, so its index is measured |
| B5 | `resolveAddress(tx, kind, value)` | `resolveAddress(tx, reader, kind, value)` in `packages/core/src/ids/address.ts`, answering `{ id, shortId }`. `reader` is the workspace and the member, or a null member for the system, which no rule narrows | The access getter needs to know who is asking |
| B6 | Each surface accepts both | Inputs use `ADDRESS.goal` (and `.cycle`, `.keyResult`, `.initiative`, `.task`, `.document`, `.session`) instead of `z.uuid()`, and `subjectAddress()` where a sibling `subjectType` says the kind. Both action builders call `resolveAddresses` after the input parses and before the handler runs: it finds the address fields once per schema, leaves a UUID as it is, and turns anything else into the key through `resolveAddress`. About 225 fields in 30 action files; no handler changed | One place, so no surface can take one form and refuse the other, and a nested call (`goals.read` inside an assist) already holds the key |
| B7 | The rule per kind | A goal, initiative or task through `getAccessScoped` on itself; a key result through its goal; a document by the draft rule then its subject; a session by the workspace and `sessions.read`'s room rule; a cycle and a KPI through the workspace. Deleted rows are found, so `goals.restore` takes the address of what it restores | The kind's own read, so the resolver never lets through what the action would refuse, nor refuses what it would show |
| B8 | Malformed answers not-found | The address schema takes any string of 1 to 64 characters, and the resolver answers "No such goal, or you do not have access to it." for malformed, unknown and unseen alike. A number or an empty string is still a validation error | Anything else would make the schema an oracle |
| B9 | `search.jump` for all eight | It takes an optional `kinds`, so a page asks for its own kind; with none it tries goal, key result, KPI, initiative, task, document, session, cycle in that order and answers the first the reader can open. A deleted row is not offered | Uniqueness is per table, so two kinds could share a short id; the order breaks the tie |
| B10 | Not in S5 | The agent's `fetch` tool takes a short link (`/goals/<short id>`, `openokr://goal/<short id>`) and cites the goal by its key | An agent handed a copied link has to be able to read it |
| B11 | The contract | An address field is `{ "type": "string", "minLength": 1, "maxLength": 64 }`, with no `format`. The MCP field descriptions say "id or short id" for the seven | A description on the schema itself would replace the per-field sentence an agent reads |

| B12 | Outputs gain `shortId` | Beside `id`, nullable until data change 0034 reaches the row: `goals.read` and `goals.list` (each goal and each key result), `initiatives.read` and `initiatives.list`, `tasks.read`, `documents.read`, every action answering a session, and every action answering a cycle | What a page needs for its Copy link, and what an integration needs to start sharing short links |
| B13 | "Copy link" on each of the seven's pages and drawers | On the goal, initiative, task, document, session and cycle pages, and on each key result's row of its goal page (a key result has no page or drawer of its own). `apps/web/lib/copy-link.tsx` puts the tab's own origin in front of the path, so a link copied on an instance reached by another name opens there. A row the data change has not reached copies its UUID link | A longer link is still a link |
| B14 | The routes accept it | Each page reads its row first and, when the address was a short id, redirects to the same page at its UUID with the query it came with (`apps/web/lib/short-links.ts`). The cycle screen matches `?cycle=` against the cycles' short ids. A key result's link is `/key-results/<short id>`, a new route that asks `search.jump` and redirects to `/goals/<goal>#kr-<key result>` | In 0.7.0 the page still lives at its UUID (S1), and every link, form and live channel on it is built from that |

Inputs left on `z.uuid()` on purpose, because only the importer, the agent runner or the copilot's own bookkeeping sends them, each with a key it already holds: `comments.importComment`, `subscriptions.importWatcher`, `copilot.recordProposal`, `copilot.completeRun`, `copilot.recordAnswer`, `agents.startRun` and `audit.list`'s `targetId`.

### The 0.8.0 step (plan 0.8.0 C1)

0.8.0's migration sets `short_id` not null on the seven tables. As written in 0.7.0, it must refuse to run while any row is still empty, naming the table and the count, the way migration 0144 refused while prose waited for its document, so an instance that skipped data change 0034 is told to run it rather than failing on the constraint. `docs/runbooks/upgrade.md` says the same to the operator.

#### What building it found, 10 November 2026

The refusal as written strands an operator, and it fails the nightly upgrade rehearsal. Checked against the code on `main`:

| Fact | Where |
|---|---|
| Any release upgrades directly to any later release in the same major, with no stops | `docs/runbooks/upgrade.md`, "How far behind you can be"; PLAN §5.1; `.github/workflows/upgrade.yml` |
| Every provisioned workspace has at least one row with no `short_id` until 0034 runs: provisioning has created the current cycle since v0.1.2 | `packages/core/src/workspaces/provisioning.ts` (`ensureCurrentCycleInTx`), the same in v0.1.2 and v0.6.0 |
| Nothing runs the data changes on its own. `./openokr up` and `upgrade` do not; the Helm chart has no data-change step (plan row H10) | `deploy/docker/openokr`, `deploy/helm/templates/` |
| On Compose the migrations run in the app container's entrypoint, so a refusing migration stops the container. `./openokr data-change` is `compose exec` into that container, which is then not running | `deploy/docker/entrypoint.sh`, `deploy/docker/openokr` (`data-change`) |
| On Helm the migrations run in a pre-upgrade hook. A refusal fails the upgrade and leaves the old release's pods, which on 0.6 do not have data change 0034 at all | `deploy/helm/templates/` (migration hook) |
| The nightly rehearsal seeds a workspace on its pinned baseline, v0.1.2, then runs `./openokr upgrade` without data changes | `.github/workflows/upgrade.yml` |

So with the refusal as written:

| Who | What happens |
|---|---|
| An instance upgrading from 0.6 or earlier, on any deployment | The upgrade refuses, every time |
| A 0.7 instance whose operator never ran `./openokr data-change` | The same, for rows written before 0.7 |
| A Compose operator told to run the data change | Cannot, because the container that would run it is the one that refuses to start |
| A Helm operator | No 0.8 pod exists to run it from |
| The nightly rehearsal from v0.1.2 | Fails, from the night C1 lands |

#### Options

| # | Option | Cost |
|---|---|---|
| A | **The migrator runs the data change a migration needs, first.** A migration declares it (`-- openokr:requires-data-change: 0034_short_ids`). Before applying it, the migrator asks the data-change ledger, and if that script is not complete it runs it with the data-change runner, batched and resumable as always, then applies the migration. The backfill stays out of the SQL and runs in its own transactions, so schema and data still never mix in one statement | An instance that skipped 0034 has its start held for as long as 0034 takes: seconds for an ordinary workspace, a minute or two for the hundred-thousand-goal performance set. The runbook's "an upgrade is never held open by a long backfill" gains one stated exception: a backfill a migration depends on, which the start log names |
| B | **Keep the refusal, and make it recoverable.** `./openokr data-change` falls back to a one-off container with migrations skipped when the app is not running; the Helm docs give a one-off pod on the new image; the rehearsal learns refuse, run, start again | Every operator who skipped the data changes meets a failed upgrade first, and Helm's path is a manual pod. The rehearsal encodes a failure as the expected path |
| C | **Leave the column nullable.** Every write since 0.7 fills it, and the Drizzle default is the backstop | The database never guarantees what every reader assumes. Only safe because no writer forgets, which is the assumption the not-null exists to remove |

**Recommended: A.** It is the only option that keeps both promises, the direct upgrade and the not-null, without stranding anybody. It also covers the next migration that needs a backfill first, which today would meet the same wall. The exception to "never held open" is narrow: it applies only to a backfill a migration names, only on an instance that skipped it, and the log says so.

#### With A, what C1 builds

| Piece | What |
|---|---|
| Migration 0165 | Sets `short_id` not null on the seven tables. Declares `requires-data-change: 0034_short_ids`. Keeps a guard like 0144's as a backstop that names any table still holding empty rows, which should now never fire |
| The migrator | Reads the declaration; consults the ledger; runs the named data change through the existing runner when incomplete; logs what it ran and how long it took |
| `docs/runbooks/upgrade.md` | The 0.7 to 0.8 section; the stated exception under "Backfills never hold up a boot" |
| Tests | The migrator runs a required data change before its migration and skips a complete one; 0165 applied over rows a 0.6-shaped write left empty ends with none empty |

**C1-Q1, decided by Akmal on 11 November 2026: A**, as recommended, with "design approved".

#### As built (C1)

| # | Written | Built | Why |
|---|---|---|---|
| C1-B1 | Migration 0165 | `0165_short_ids_not_null.sql`. The declaration is a comment line of its own, `-- openokr:requires-data-change: 0034_short_ids`; the same words inside a sentence are prose | One shape a reader and the runner both see |
| C1-B2 | The migrator reads the declaration | `runMigrations` takes `dataChanges` (the registry by default, without the root key; both migrators pass it with the key) and `log`. Before any migration applies, it refuses a pending one that names a script the release does not carry. Before each migration that names one, it asks `_data_changes` and, when the script is not complete, runs it alone through `runDataChanges`, logging the start, the batches, the rows and the seconds. A failure applies nothing of the migration and keeps the finished batches | A name the release lacks is a fault in the release, so nothing moves. The data change keeps its own lock, ledger and transactions, so it is the runner an operator already knows |
| C1-B3 | The guard names the table and the count | It does, and says what to do: 0034 is recorded complete, so remove its ledger row and start again, and the migrator runs it first. It lifts FORCE on the seven tables for its own transaction, as 0144's did | It fires only when rows arrived after 0034 finished, and then the ledger is what stops 0034 coming back |
| C1-B4 | Not in the design | The Drizzle columns are `.notNull()` beside the default | The types say what the database now guarantees |
| C1-B5 | Not in the design | Data change 0004 writes the cycle's short id when it creates one. Its `expects` is unchanged | 0004 inserts a cycle by hand. After the migrator has run 0034, a cycle 0004 writes later with none would be refused. Adding the column to `expects` would change 0004's checksum for no gain |
| C1-B6 | Not in the design | Every hand-written insert into the seven tables in tests gives a short id: `cycle-closing.test.ts` and eleven session inserts in nine browser specs. The data-change tests that write rows as an older release did run on the migrations before 0165 | The column refuses them otherwise |
| C1-B7 | The runbook gains the exception | So does PLAN §5.1's "Backfills never block a boot", which the runbook repeats; `data-change-conventions.md` says how a migration declares one | One rule, said the same way in both places |

**A rollout straight from 0.6 to 0.8 on Kubernetes.** PLAN §5.1's rolling rule covers release N serving beside N+1. Upgrading straight from 0.6, its pods serve beside 0.8's for the length of the rollout, and an insert they make into one of the seven tables names no short id, so 0165 refuses it until the old pods are gone. Every change spread over two releases behaves this way on a jump over the first. Compose stops one container before it starts the next, so it never meets this. Left as it is; a database-side default would be a second copy of the generator (B1).
