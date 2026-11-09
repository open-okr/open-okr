# Short identifiers on every addressable aggregate

Status: approved 10 November 2026 for release 0.7.0 (plan D1), Q1 and Q2 answered as proposed. A schema change on seven tables, so it was designed first (CLAUDE.md). Built in three commits; §6 records where the build moved from what was written here.

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
| Browser | `e2e/short-links.spec.ts` | Copy link, open it, land on the page |

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

Inputs left on `z.uuid()` on purpose, because only the importer, the agent runner or the copilot's own bookkeeping sends them, each with a key it already holds: `comments.importComment`, `subscriptions.importWatcher`, `copilot.recordProposal`, `copilot.completeRun`, `copilot.recordAnswer`, `agents.startRun` and `audit.list`'s `targetId`.

### The 0.8.0 step, not built here

0.8.0's migration sets `short_id` not null on the seven tables. It must refuse to run while any row is still empty, naming the table and the count, the way migration 0144 refused while prose waited for its document, so an instance that skipped data change 0034 is told to run it rather than failing on the constraint. `docs/runbooks/upgrade.md` says the same to the operator.
