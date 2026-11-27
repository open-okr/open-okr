# FlowyTeam import: stand-alone key result check-ins and tasks with no project

Status: approved 27 November 2026. §2.4 added the same day after the OKRI.io preview, approved by the owner (option B).
Owner decisions: 27 November 2026 (Agung), recorded in §6.
Related: TECHNICAL-PLAN §7.2 (rows `objective_checkins`, `key_result_checkins`, `tasks`), [flowyteam-connect](flowyteam-connect.md).

## 1. Problem

The FlowyTeam importer was built against a FlowyTeam company that keeps an objective check-in for every period and puts every task in a project. OKRI.io data (the same codebase, OKR Institute's deployment) has neither. A dump of 1,652 OKRI.io companies, last written October 2024, shows:

| Source fact | Count | What the importer does today |
|---|---|---|
| `key_result_checkins` rows | 1,055 | Read only through an `objective_checkins` row of the same objective and period |
| of which no matching `objective_checkins` row | 1,038 (98%), in 40 of 52 companies | **Not read and not reported.** The check-in domain shows "read 0" |
| `tasks` rows | 272 | Placed in the space of their project's initiative |
| of which no project | 272 (100%) | Skipped: "belongs to no project that imported" |

The first is a silent drop, which the importer rules forbid. The second loses every task on OKRI.io, and with them their checklists, comments, watchers and files.

## 2. Change 1: key result check-ins with no objective check-in

### 2.1 Reading

One new catalogue query, `checkIns.standaloneKeyResults`. It returns every live `key_result_checkins` row of the company that has no `objective_checkins` row for the same objective, `start_date` and `end_date`:

```sql
select k.id, k.key_result_id, r.objective_id, k.user_id, k.start_date, k.end_date,
       k.current_value, k.confidence, k.remarks, k.created_at
  from key_result_checkins k
  join key_results r on r.id = k.key_result_id
  join objectives o on o.id = r.objective_id
 where k.company_id = :company and k.deleted_at is null and o.deleted_at is null
   and not exists (select 1 from objective_checkins c
                    where c.company_id = k.company_id and c.objective_id = r.objective_id
                      and c.start_date <=> k.start_date and c.end_date <=> k.end_date)
 order by r.objective_id, k.start_date, k.end_date, k.created_at, k.id
```

Rows that do have an objective check-in keep today's path, unchanged.

### 2.2 Mapping

One OpenOKR check-in per objective per period (`start_date`, `end_date`). A row with no dates forms its own period keyed on the date part of `created_at`.

| OpenOKR field | Taken from |
|---|---|
| Values | Each row's `current_value`, as the snapshot of its key result. Two rows for one key result in one period: the later `created_at` wins, the earlier is reported as superseded |
| Confidence | The lowest confidence among the group's rows, banded through `packages/method` as today |
| Author | The `user_id` of the latest row. When the group has more than one author, a flag names them |
| Date | The latest row's `created_at`, through `sourceInstant` as today |
| Narrative | Each row's remark on its own line, prefixed with its key result's title. Empty remarks are left out. No remarks at all: no check-in, the values go to the key result history instead (§2.4) |
| Legacy key | `key_result_checkins:<lowest id in the group>`, so a second run finds it and writes nothing |

A row whose key result, objective or author did not import is skipped with a reason that names it, the same way an objective check-in is.

### 2.3 Report

The check-in domain counts these rows as read. A new line under "Changed on the way in": "N key result check-ins had no objective check-in and were grouped into M check-ins, one per objective and period."

### 2.4 Groups with no remark at all

Measured on OKRI.io company 2543: 55 of 67 stand-alone key result rows have no remark, and across the dump 589 of 1,055. A check-in needs a narrative (METHOD.md), and inventing one would invent the history. Skipping them loses the values.

So a group whose rows all have an empty remark writes no check-in. Each of its rows becomes one dated point in its key result's value history.

| Rule | Detail |
|---|---|
| Where it is counted | The "key result history" domain, beside `key_result_records`. The check-in domain no longer reads these rows |
| Write path | New action `goals.importValue` (`agentSurface: false`, access `full`, legacy key required for the audit trail). Inserts one `key_result_values` row with `source = 'import'`, the source's `at` and author, note "Imported from {source}". **It does not move the key result's current value**: the current value comes from `key_results.current_value`, which the objectives domain already imported |
| Date and author | The row's `created_at` through `sourceInstant`, falling back to `end_date`, then `start_date`. The author is the row's own `user_id` when that person imported, otherwise none. A row with no date is skipped with a reason |
| Every row, not only the latest | Each row is a real reading on a real day, so a key result with two rows in one period gets two points |
| Idempotency | `key_result_values` has no legacy columns, and adding them is a migration. The action writes nothing when a row with the same key result, `source = 'import'`, `at` and value already exists, and answers `created: false` |
| Interaction with `key_result_records` | These rows are dated, so they count like a check-in value: the undated record replay defers to them and flags the key result, as it does for check-ins today |
| Skips that stay | Objective, key result or author resolution failures keep the reasons in §2.2. A row whose author did not import keeps the skip only when the group would have become a check-in; a values-only row records the value with no author |

Report line: "N key result check-ins had no remark, so their values were added to the key result history instead of a check-in."

## 3. Change 2: tasks with no project

A task's space is chosen by the first rule that gives one. The task keeps its key result link whichever rule placed it.

| Order | Rule | OKRI.io dump |
|---|---|---|
| 1 | Today's rule: the space of the task's project's initiative | 0 of 272 |
| 2 | The space of the team that owns the objective of the task's key result | 16 |
| 3 | The space of the assignee's own team (`employee_details.department_id`) | 146 |
| 4 | One space the import creates, named "Tasks from {source}" (OKRI.io by default), created only when a task needs it, with every imported member as a member | 110 |

Rule 3 needs `department_id` on the `organisation.users` row, a one-column change to that catalogue query.

Rule 4 creates structure nobody chose, so the report says so: "N tasks had no project, team or assignee team and were put in the new space Tasks from OKRI.io. Move them to the right space." The space carries a legacy key, legacy table `teams` with id `tasks-space` (one workspace holds one company), so a second run reuses it.

The report also gives the count per rule, so an admin sees how many tasks were placed by which rule.

## 4. The catalogue on both sides

The catalogue is hashed into a version, and the export endpoint refuses a different version with 409. Both changes alter the catalogue, so:

1. `packages/core/src/imports/flowyteam/queries.ts` gains `checkIns.standaloneKeyResults` and `department_id` in `organisation.users`.
2. `pnpm gen:contract` (or the catalogue generator) writes the new JSON and version.
3. The same JSON ships with the OKRI.io export endpoint, which compares versions.
4. OKRI.io must run that export build before an OKRGoal with this change connects to it. Until then every preview is refused with "OKRI.io needs an update before this import", which is the existing refusal and needs no new text.

## 5. Acceptance criteria

- **Given** a company whose key result check-ins have no objective check-in, **when** a preview runs, **then** the check-in domain reads every such row and would write one check-in per objective and period.
- **Given** one objective, one period and two key result rows with confidences 0.8 and 0.4 by two people, **when** imported, **then** one check-in carries both values, the lower confidence's band and the later row's author, and the report flags both authors.
- **Given** a group of key result rows where no row has a remark, **when** imported, **then** no check-in is written, each row is one dated point in its key result's history with `source = 'import'`, the key result's current value is unchanged, and the report names the count.
- **Given** those values were imported once, **when** the import runs again, **then** no value is written twice.
- **Given** a key result row whose key result did not import, **when** imported, **then** it is skipped with a reason that names the key result.
- **Given** the import ran once, **when** it runs again, **then** no check-in is written twice.
- **Given** a task with no project whose key result's objective belongs to a team, **when** imported, **then** the task is in that team's space and linked to the key result.
- **Given** a task with no project, no team objective and an assignee in a team, **when** imported, **then** the task is in the assignee's team space.
- **Given** a task with none of the above, **when** imported, **then** one space "Tasks from OKRI.io" exists, holds the task, and the report names how many tasks went there.
- **Given** the import ran once, **when** it runs again, **then** the "Tasks from OKRI.io" space is reused, not created again.
- **Given** a company where every task has a project and every key result check-in has an objective check-in, **when** imported, **then** nothing differs from today.
- **Given** the catalogue changed, **when** OKRGoal connects to an OKRI.io export with the old catalogue, **then** the preview is refused with the existing "needs an update" refusal.

## 6. Owner decisions

| Question | Decision (27 November 2026) |
|---|---|
| Where a task with no project goes | Rules 2, 3 and 4 above, in that order, including a created space |
| How key result rows group into a check-in | One per objective and period, lowest confidence, latest author, remarks joined |
| Groups with no remark at all | Values into the key result history, no check-in (§2.4, option B) |
| Release order | One new catalogue in both repositories; OKRI.io deploys the export build first |

## 7. Not in this change

- Blocker categories on check-ins (TECHNICAL-PLAN §7.2, L-14) stay as they are.
- `objective_accesses`, `task_boards` and `task_category` stay unread.
