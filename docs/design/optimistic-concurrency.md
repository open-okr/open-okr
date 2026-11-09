# Optimistic concurrency on every update

Status: approved 10 November 2026 and built, for release 0.7.0 (plan D3). Q1 was answered as proposed: field comparison, no version column, no migration.

Authority: TECHNICAL-PLAN §14 ("Optimistic concurrency. Updates carry a version. A mismatch returns a conflict and the client refetches or shows an inline comparison").

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The rule | TECHNICAL-PLAN §14 | Updates carry a version; a mismatch is a conflict. §14 records the field-comparison form built here |
| The comparison | `packages/core/src/operations/unchanged.ts` | `sameField`, `requireUnchanged` (P9-T06a, moved out of the OKR tree in D3 part 1), and for the six actions `readOf`, `readsEveryChange`, `requireReadUnchanged` and `changedFields` |
| The OKR tree | `goals.patch`, `goals.patchKeyResult`, `goals.changeTarget` | `read` required. The screen offers keep mine or take theirs (`data-testid="okr-conflict"`) |
| The six update actions | `initiatives.update`, `tasks.update`, `documents.update`, `kpis.update`, `spaces.update`, `cycles.update` | `read` optional (V3). The edit screens send it and show the same choice (`data-testid="conflict"`) |
| Everything else | Members, settings | Last write wins, silently |

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| V1 | **Field comparison, not a row version.** Every update action of a protected aggregate takes an optional `read`: the values the caller read for the fields it changes. A field whose stored value differs is a conflict | Built and proven on the busiest editor. A row version conflicts on edits that touch different fields, so two people editing a task's title and its due date would refuse each other for nothing. And it needs no column, no backfill and no write path changed to bump it |
| V2 | **One helper**, in `packages/core/src/operations/unchanged.ts`. `requireUnchanged(tx, { workspaceId, subjectType, subjectId, read, stored })` throws `OperationError("conflict")` with the stored values and the last writer from the activity log. `requireReadUnchanged` wraps it for the six: it does nothing without `read`, compares exactly the fields the call changes, and loads the stored row `for update` so two saves cannot pass the same comparison | One comparison, one answer shape, one place the screen's keep-mine and take-theirs read |
| V3 | **Optional, so nothing breaks.** A caller that sends no `read` writes as today. The browser always sends it; the API, the command line and agents may. A `read` that leaves out a field the call changes is refused, as the OKR tree's is | Requiring it would break every integration and agent on upgrade. An agent proposal is checked again when it is approved, which is its own staleness guard |
| V4 | **Where, in 0.7.0**: `initiatives.update`, `tasks.update`, `documents.update` (title and metadata; the body has its own rule, V5), `kpis.update`, `spaces.update`, `cycles.update`. Each edit screen sends what it read and shows the conflict with keep mine and take theirs (§5) | The aggregates people edit side by side. Settings and members change rarely and by administrators; they follow if anyone asks |
| V5 | **Rich text is not compared.** An initiative's or a task's description and a document's body are never in `read`. Their `_version` column is the editor schema's version (TECHNICAL-PLAN §3), not a concurrency version, so two people saving one body is still last write wins | A body edited by two people is a merge question, not a field compare. Comparing two documents for equality is cheap, but showing a useful comparison of them is not this row |

## 2. Question for Akmal

**Q1. Field comparison (V1) instead of a version column?** Answered 10 November 2026: **field comparison**, as proposed. No migration.

## 3. Acceptance criteria

- Given two people with a task open, when one changes its title and the other then changes its due date, then both saves succeed.
- Given two people with a task open, when both change its title, then the second save answers `conflict` with the first one's title and name, and the screen offers keep-mine or take-theirs.
- Given an API call to `tasks.update` with no `read`, then it writes as it does today.

## 4. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/unchanged.test.ts` | The comparison: equal, different, blank, null, numbers, dates, lists and the records in them |
| Integration | `packages/core/test/optimistic-concurrency.test.ts` | Each of the six: a conflict on the same field with the stored value and who changed it, no conflict on a different field, none without `read`. Also a `read` missing a changed field, the activity recording the fields and never the read, a number read as text, and a list compared as a list |
| Unit | `apps/web/test/update-conflicts.test.tsx` | Each screen's save sends only what changed with what it read, nothing when nothing changed, a conflict comes back with what was sent, a name already taken is still a refusal, and the form's keep mine and take theirs |
| Browser | `e2e/s34e-space-edit-conflict.spec.ts` | On the space's manage card: take theirs, keep mine, and a field nobody else touched still saving |

One integration file and one browser spec rather than a case in each action's existing file: the three questions are the same for all six, and one file asks them the same way.

## 5. How each screen sends what it read

A form carries what it was drawn with in one hidden `read` field (`apps/web/lib/read-field.ts`), as JSON. Its server action sends only the fields whose submitted value differs from what was read, each with its read (`onlyChanged` in `apps/web/lib/conflict.ts`), and saves nothing when nothing changed. A control that saves on its own (a select, a date) sends its last saved value as the read. A conflict comes back as `conflict` in the action's state: what is stored, who changed it, and what this person sent.

| Action | Screen | Fields compared from it | How |
|---|---|---|---|
| `initiatives.update` | S-26 list and initiative page: the status and capacity selects (`apps/web/app/initiatives/inline-select.tsx`) | status, capacity | The select's last saved value |
| `tasks.update` | Task page: the due date (`apps/web/app/tasks/[id]/controls.tsx`) | dueOn | The field's last saved value |
| `documents.update` | None. The document editor saves only the body, which V5 leaves out | title, for API callers | No screen edits a document's title |
| `kpis.update` | KPI page: how it is judged, owner and tier (`apps/web/app/kpis/[id]/page.tsx`) | targetType, the four thresholds, ownerMemberId, tier | `ActionForm` with `read` |
| `spaces.update` | Space page: the manage card (`apps/web/app/spaces/[id]/manage.tsx`) | name, mission | `SpaceForm` with `read` |
| `cycles.update` | Cycle workspace: phase 1's setup card (`apps/web/app/cycle/phase-forms.tsx`) and the publication deadline (`apps/web/app/cycle/cycle-admin.tsx`) | sponsorId, facilitatorId, firstCycle, sessionDates; publicationDeadline | `ActionForm` with `read`; the card's last read deadline |

**Keep mine** sends the same save again with the stored values as what was read, so it is written over theirs. **Take theirs** drops it and reads the page again; a form is keyed on what it read, so it is drawn again from the stored values. One notice (`apps/web/lib/conflict-notice.tsx`) draws both, with `labels` turning a stored id or key into words.

Two screen writes reach `kpis.update` without a `read` and stay last write wins: filing a KPI into a tree, and giving a new driver its tree, both on the trees screen, where the KPI is chosen in the same form and so was never read. A write that sends nothing is V3's case, not a gap in the comparison.
