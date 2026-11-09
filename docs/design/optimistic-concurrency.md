# Optimistic concurrency on every update

Status: proposed 9 November 2026 for release 0.7.0 (plan D3), waiting for "design approved". The plan lists it as a schema change; §1 proposes doing it without one, which is itself a decision for Akmal.

Authority: TECHNICAL-PLAN §14 ("Optimistic concurrency. Updates carry a version. A mismatch returns a conflict and the client refetches or shows an inline comparison").

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The rule | TECHNICAL-PLAN §14 | Updates carry a version; a mismatch is a conflict |
| What is built | P9-T06a; `sameField` and the compare in `packages/core/src/actions/goal-tree.ts:913-990`; `goals.patch`, `goals.patchKeyResult`, `goals.changeTarget` | An edit from the OKR tree sends the values it read for the fields it changes. The server compares field by field and answers `conflict` with the stored values and who changed them last. The screen offers keep-mine or take-theirs. §14 already records this narrower form |
| Everything else | Initiatives, tasks, documents, KPIs, spaces, cycles, members, settings | Last write wins, silently |

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| V1 | **Field comparison, not a row version.** Every update action of a protected aggregate takes an optional `read`: the values the caller read for the fields it changes. A field whose stored value differs is a conflict | Built and proven on the busiest editor. A row version conflicts on edits that touch different fields, so two people editing a task's title and its due date would refuse each other for nothing. And it needs no column, no backfill and no write path changed to bump it |
| V2 | **One helper**, moved out of `goal-tree.ts` to `packages/core/src/operations/unchanged.ts`: `requireUnchanged(stored, read)`, throwing `OperationError("conflict")` with the stored values and the last writer from the activity log, as goals do | One comparison, one answer shape, one place the screen's keep-mine and take-theirs read |
| V3 | **Optional, so nothing breaks.** A caller that sends no `read` writes as today. The browser always sends it; the API, the command line and agents may | Requiring it would break every integration and agent on upgrade. An agent proposal is checked again when it is approved, which is its own staleness guard |
| V4 | **Where, in 0.7.0**: `initiatives.update`, `tasks.update`, `documents.update` (title and metadata; the body has its own version), `kpis.update`, `spaces.update`, `cycles.update`. Each screen's form sends what it read and shows the existing conflict comparison | The aggregates people edit side by side. Settings and members change rarely and by administrators; they follow if anyone asks |
| V5 | **Rich text keeps its own version column** (TECHNICAL-PLAN §3) and is not compared value by value: a body edited by two people is a merge question, not a field compare | Comparing two documents for equality is cheap, but showing a useful comparison of them is not this row |

## 2. Question for Akmal

**Q1. Field comparison (V1) instead of a version column?** Proposed: **field comparison.** It is what §14 already says is built, it refuses only real collisions, and it needs no migration. The alternative is a `version integer` on eight tables, bumped by every write, and a conflict whenever anything on the row changed.

## 3. Acceptance criteria

- Given two people with a task open, when one changes its title and the other then changes its due date, then both saves succeed.
- Given two people with a task open, when both change its title, then the second save answers `conflict` with the first one's title and name, and the screen offers keep-mine or take-theirs.
- Given an API call to `tasks.update` with no `read`, then it writes as it does today.

## 4. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/unchanged.test.ts` | The helper: equal, different, absent, null, numbers and dates |
| Integration | One existing test per action in V4 | Conflict on the same field, no conflict on different fields, none without `read` |
| Browser | One existing spec per screen | Keep-mine and take-theirs |
