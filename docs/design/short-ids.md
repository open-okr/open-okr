# Short identifiers on every addressable aggregate

Status: proposed 9 November 2026 for release 0.7.0 (plan D1), waiting for "design approved". A schema change on seven tables, so it is designed first (CLAUDE.md).

Authority: TECHNICAL-PLAN §3 ("Public identifiers are separate") and DATABASE.md §1.

## 0. What exists

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
| S2 | **The column**: `short_id text not null`, unique on `(workspace_id, short_id)`, on cycles, goals, key results, initiatives, tasks, documents and sessions. Ten base58 characters from the KPI alphabet, the generator moved from `kpis.ts:317` to `packages/core/src/ids/short.ts`, drawing from `crypto.randomInt` instead of `Math.random` | One generator for all eight tables, the shape KPI links already have. 58^10 is about 4 × 10^17 per workspace, so a collision is retried, never expected. Access is checked on every read, so an id is not a secret, but a predictable generator is no reason to keep |
| S3 | **Two releases for the not-null** (PLAN §5.1). 0.7.0's migration adds the column nullable with the unique index; every write fills it; data change 0035 backfills existing rows in batches. 0.8.0's migration makes it not null | A rolling upgrade has a replica of 0.6 writing rows without one. A not-null column added in the same release refuses its inserts |
| S4 | **One resolver**, `resolveAddress(tx, kind, value)`: a UUID is looked up as today; anything else is looked up as a short id, case-sensitive; both through the access getter, so a short id a reader cannot see answers not-found exactly as a UUID does | The format is not an oracle (§3). One function so no surface accepts one form and refuses the other |
| S5 | **Where it is accepted in 0.7.0**: `search.jump` for all eight kinds; every registry action input that takes one of the seven ids (the contract's schemas widen from `uuid` to "UUID or short id"); the `okr` command line and chat commands, which read the contract | The contract is the one place these are defined, so widening it reaches REST, MCP, the command line and chat in one move |
| S6 | **Where it is shown in 0.7.0**: a "Copy link" on each of the seven's pages and drawers copies a short-id URL, and the routes accept it. Outputs keep returning the UUID as `id` and gain `shortId` beside it | A person can start sharing short links now, and nothing that reads `id` breaks |
| S7 | **Importer**: the FlowyTeam and CSV importers write a short id like any other write. TECHNICAL-PLAN §7.2 gains nothing: a short id has no legacy source | It is generated, never carried |
| S8 | **Archives**: the workspace archive carries short ids, and the archive import keeps them unless one collides in the target workspace, which gets a fresh one | A moved workspace's shared links keep working where they can |

## 2. Questions for Akmal

**Q1. Is S1's staging right for 0.7.0**, or should D1 move wholly to 0.8.0? Proposed: **stage it, as S1.** The column, the backfill and accepting both forms are additive; the URL and output switch is a breaking change and belongs to a release whose notes can say so.

**Q2. Ten characters, as KPIs have?** Proposed: **yes**, so every short link has one shape and existing KPI links are unchanged.

## 3. Acceptance criteria

- Given an upgraded instance, when data change 0035 has run, then every row of the seven tables has a short id unique within its workspace.
- Given a goal, when `search.jump` is asked its short id, then it answers the goal's page; given a short id the reader cannot see, then null, as an unknown one.
- Given `goals.read` called with a goal's short id, then it answers as with its UUID; with a malformed value, then not-found, never a validation error.
- Given a replica of 0.6 inserting a goal during the rolling upgrade, then the insert succeeds and data change 0035 fills its short id on its next run.
- Given a workspace archive moved to another instance, when it is imported, then its goals keep their short ids.

## 4. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/short-ids.test.ts` | The generator, collision retry, the resolver's two forms and its not-found |
| Integration | `packages/db/test/data-change.test.ts` | 0035 backfills, batches and resumes |
| Integration | `packages/core/test/search.test.ts` (existing) | `search.jump` for all eight kinds |
| Contract | `pnpm check:contract` | The widened inputs |
| Browser | `e2e/short-links.spec.ts` | Copy link, open it, land on the page |

## 5. What this does not do

- No URL or output switches to short ids in 0.7.0 (S1).
- No vanity or human-readable ids.
- No change to internal joins: UUIDs stay the keys.
