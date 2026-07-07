# FlowyTeam data model reference (OKR, KPI, Tasks)

Ground truth for the **second** importer source and the design authority for OpenOKR's native strategy modules. This describes the FlowyTeam source schema (Laravel 10, PHP 8, **MySQL**) that `packages/importer` reads for the OKR, KPI, and Tasks domains. It is the companion of `legacy-data-model.md` (which covers the first source, the Rails project tool). Where the two sources disagree on a concept, OpenOKR's target schema in `../TECHNICAL-PLAN.md` §4.12 is the reconciliation.

Extracted from an analysis of the FlowyTeam codebase (models in `app/Models`, migrations in `database/migrations`, controllers, services, observers, and the v2/MCP API), July 2026. Column lists are the load-bearing columns, not every column. Before writing importer code, cross-check against a real `mysqldump --no-data` of the target instance; FlowyTeam instances differ by version.

> Terminology note. FlowyTeam calls the KPI concept **Indicator** in code (there is no `Kpi` model). "Department" is not a separate model either: it is a row in the `teams` table. This doc uses FlowyTeam's code names and flags each rename OpenOKR should make.

---

## 1. How to read this source reliably

- **ORM:** Eloquent. Most business logic lives in controllers and `app/Services/*`, not the DB. Scoring, RAG status, cycle generation, and the KPI formula engine are all computed in PHP, so the DB stores inputs and cached results, not the rules. The importer recomputes derived values; it does not trust them.
- **Multi-tenancy:** every business table carries `company_id`. A single FlowyTeam database holds **many companies**. A global scope (`ModelObserverService::bootModel`, `app/Services/ModelObserverService.php`) adds `WHERE company_id = <current company>` to every query. The current company is always the authenticated user's own `users.company_id`; there is no subdomain or session tenant switch. **Importer consequence:** you must pick which company to import with a `--company <id>` flag, or loop and import each company as its own workspace. See §11.
- **Polymorphic ownership:** OKRs and KPIs are owned by a `model_id` + `model_type` pair, where `model_type` is one of `App\Models\Company`, `App\Models\Team`, `App\Models\EmployeeDetails`. This is the real owner discriminator. Do not trust the `objective_type` / `type` string columns (see §3.1 gotcha).
- **Soft deletes:** most tables added `deleted_at` in 2022–2025 migrations. Import only non-deleted rows unless asked otherwise.
- **Enums are MySQL `enum` columns**; the exact allowed values are listed below. Some code writes values outside the declared enum (a known bug), so map by meaning, not by raw string.
- **Money/values as integers:** several value columns (`key_results.initial_value/target_value/current_value`, `indicators.target_value`) were changed from `float` to `bigint` in 2023. Fractional targets entered before that were truncated. OpenOKR uses `numeric` and accepts decimals.

---

## 2. Domain map (OKR / KPI / Tasks tables)

| Domain | Tables |
|---|---|
| Performance / OKR | `performance_settings`, `performance_cycles`, `objectives`, `key_results`, `key_result_records`, `objective_checkins`, `key_result_checkins`, `objective_accesses`, `objective_discussions`, `keyresult_discussions`, `key_result_files`, `performance_records` |
| Check-in sessions | `checkins`, `checkin_reviews` |
| KPI / Indicators | `indicators`, `indicator_types` (= categories), `indicator_records`, `indicator_accesses`, `indicator_calculates`, `indicator_data_sources`, `indicator_datasource_dbs`, `keyresult_indicator` (KR↔KPI pivot) |
| Tasks | `tasks`, `sub_tasks`, `task_category`, `taskboard_columns`, `task_boards`, `task_board_accesses`, `tasks_accesses`, `task_comments`, `task_files`, `ticket_tasks`, `project_time_logs` (shared) |
| Org / owners | `teams` (= teams **and** departments, nested-set tree), `employee_details`, `designations`, `other_departments` (user↔team pivot), `employee_teams` (secondary pivot) |
| Rewards / points (optional) | `reward_settings`, `scores` |
| Reviews (adjacent) | `message_settings`, `reviews`, `checkin_reviews` |
| Runtime (SKIP) | Zapier resthook queues, notification rows, universal-search cache, google-sheet/analytics sync state |

---

## 3. OKR (performance) tables

All core OKR tables are created in one migration, `database/migrations/2019_12_26_174126_create_performance_settings_table.php`, then altered by many later migrations. All carry `company_id` and a `company` global scope.

### 3.1 `objectives`

Model `app/Models/Objective.php`. Soft deletes. `CustomFieldsTrait`. Observer `ObjectiveObserver` (sets `company_id`, writes a universal-search row, deletes access rows on delete).

| Column | Type | Meaning / import note |
|---|---|---|
| `id` | int unsigned PK | |
| `company_id` | int unsigned | tenant key |
| `model_id` / `model_type` | int / string | **polymorphic owner.** `model_type` ∈ {`App\Models\Company`, `App\Models\Team`, `App\Models\EmployeeDetails`}. This is the authoritative owner + level. |
| `objective_type` | enum `('user','team','company')` default `user` | **Unreliable.** The enum was never widened, but services write the literal `'personal'` for individual OKRs, which MySQL stores as `''` in strict mode. Derive level from `model_type`, not this. |
| `leader_model_id` / `leader_model_type` | int / string | responsible lead, always `EmployeeDetails`. Separate from ownership. |
| `title` | string | |
| `description` | text | rich text |
| `performance_cycle_id` | int unsigned | FK `performance_cycles`. Binds the OKR to a cycle. |
| `started_at`, `finished_at` | date | usually inherit the cycle's dates. |
| `weight` | float default 1 | objective weight, clamped `[1,100]` on write. |
| `confidence` | tinyint default 0 | 0–10. Drives the status bucket (§3.9). |
| `result_percentage` | float default 0 | cached weighted score 0–100. **Recompute, do not trust.** |
| `key_result_count` | int default 0 | cached count of direct KRs. |
| `objective_parent_id` | int null | alignment: parent **objective**. |
| `key_result_parent_id` | int null | alignment: parent **key result** (the KR this objective rolls up into). Primary cascade pointer. |
| `planning_strategy_id` | bigint null | link back to the Planning module (out of scope). |
| `order` | int | manual ordering. |
| `created_at`, `updated_at`, `deleted_at` | timestamps | |

### 3.2 `key_results`

Model `app/Models/KeyResult.php`. Soft deletes. `protected $touches = ['objective']` (any KR save bumps the objective). Observer `KeyResultObserver`.

| Column | Type | Meaning / import note |
|---|---|---|
| `id` | int unsigned PK | |
| `company_id` | int unsigned | |
| `objective_id` | int unsigned | FK `objectives`, cascade. |
| `title` | string | |
| `description` | text | |
| `unit_value` | string default `%` | **free-text unit label** (`%`, `$`, `pcs`, ...). There is no KR "type" enum. |
| `initial_value`, `target_value`, `current_value` | bigint default 0 | numeric range. Progress = direction-aware linear interpolation (§3.7). Was `float` before 2023. |
| `current_percentage` | float default 0 | cached progress 0–100. Recompute. |
| `weight` | float default 1 | KR weight, clamped `[1,100]`. |
| `confidence` | tinyint default 5 | 0–10. |
| `objective_override` | bool default 0 | KR overrides objective linkage. |
| `leader_model_id` / `leader_model_type` | int / string | KR lead (`EmployeeDetails`). |
| `task_id` | int unsigned null | FK `tasks` SET NULL. A KR can be **driven by a task** (single). |
| `planning_strategy_target_id` | bigint null | link to a Planning target (out of scope). |
| `order` | int | ordering. |
| `created_at`, `updated_at`, `deleted_at` | | |

KR relationships that matter: `linkedObjectives()` = child objectives aligned under this KR (`objectives.key_result_parent_id`), `keyResultRecords()` = value history, `checkins()` = `key_result_checkins`, `tasks()` = `tasks.key_results_id`, `indicators()` = `belongsToMany` via `keyresult_indicator` (KPI link).

### 3.3 `performance_cycles`

Model `app/Models/PerformanceCycle.php`. Soft deletes. No observer.

| Column | Type | Meaning |
|---|---|---|
| `id` | int unsigned PK | |
| `company_id` | int unsigned | |
| `name` | string | e.g. `Q3 2026`, `H1 2026`, `2026`. |
| `cycle_type` | enum `('annually','semiannually','quarterly','monthly','biweekly','weekly')` default `quarterly` | cadence. |
| `started_at`, `finished_at` | date | cycle bounds. |
| `previous_cycle_id` | int default 0 | prior cycle link. |
| `results_value` | float default 0 | archived aggregate. |
| `display_lock` | bool default 0 | freeze the alignment diagram. |
| `type` | string default `org` | cycle scope type. |
| timestamps + `deleted_at` | | |

Cycles are **auto-generated on demand** by `PerformanceSetting::currentCycle()` and `getNextPerformanceCycle()` from the company's `cycle_type` (Carbon start/end-of-quarter math, honoring the company timezone). The importer imports the cycle rows as they exist; OpenOKR regenerates future cycles itself.

### 3.4 `performance_settings` (one row per company)

Model `app/Models/PerformanceSetting.php`. Holds cadence, quotas, the RAG thresholds, label overrides, and the OKR edit-permission matrix.

| Column group | Columns | Meaning |
|---|---|---|
| Cadence & quota | `cycle_type`, `max_objective_per_cycle` (default 3), `max_result_per_objective` (default 5) | |
| RAG thresholds | `color_pass` (default 75), `color_fail` (default 50) | percent thresholds green/amber/red (§3.9). |
| Levels enabled | `allow_company_objective`, `allow_team_objective`, `allow_personal_objective` (enum yes/no) | |
| Edit matrix | `employee_edit_personal_objective`, `employee_edit_own_result`, `employee_edit_own_progress`, `leader_edit_personal_objective/result`, `employee_view_team`, `leader_edit_team_objective/result`, `member_edit_team_objective/result`, `employee_view_company`, `leader_edit_company_objective/result`, `member_edit_company_objective/result` | booleans, role × level. OpenOKR maps these to real RBAC permissions. |
| Labels | `label_okr`, `label_kpi`, `label_objective`, `label_keyresult`, `label_task`, `label_vision`, `vision` | UI term overrides. |

### 3.5 Check-in snapshot tables

Two dated snapshot tables record a value + confidence + remark each time someone checks in. Both created in `2021_01_16_062335_add_confidencein_objectives_table.php`. No soft deletes.

**`objective_checkins`** — `id`, `company_id`, `objective_id`, `user_id`, `checkin_id` (groups into a session, → `checkins`), `start_date`, `end_date`, `confidence` (0–10), `current_percentage`, `remarks`, `category` enum `('challenge','blocker','risk','suggestion','solution','resource_request')`.

**`key_result_checkins`** — `id`, `company_id`, `key_result_id`, `user_id`, `checkin_id`, `start_date`, `end_date`, `confidence`, `current_value`, `current_percentage`, `remarks`, `attachment`, `key_result_file_id` (→ `key_result_files`), `category` (same 6 values).

### 3.6 Check-in session tables

**`checkins`** — model `Checkin` (`2020_10_11_061824`). A weekly (or per-cadence) check-in session per user: `id`, `company_id`, `user_id`, `start_date`, `end_date`, `feeling` (int mood 0–n), `question`/`answer` (JSON text), `submitted` (enum yes/no), `reviewed` (yes/no), `draft`, `objective_checkin`/`key_result_checkin` (yes/no flags for what the session covered). Has many `objective_checkins`, `key_result_checkins`, `checkin_reviews`.

**`checkin_reviews`** — a manager review of a submitted check-in: `id`, `company_id`, `user_id`, `checkin_id`, question/answer, `submitted`, `reviewed`.

### 3.7 Other OKR side tables

| Table | Model | Columns / meaning |
|---|---|---|
| `key_result_records` | (accessed via `KeyResult::keyResultRecords()`) | value history: `id`, `company_id`, `key_results_id` (note plural), `history_value` (float), `history_confidence` (tinyint), timestamps. |
| `objective_accesses` | `ObjectiveAccess` | per-objective sharing: `objective_id`, `user_id`, `is_owner` (bool), `permissions` enum `('read','update')`, `view_options` enum `('me','manager','team','everyone')`, `department_id`. |
| `objective_discussions` | `ObjectiveDiscussion` | threaded comments: `objective_id`, `user_id`, `parent_id` (self-ref), `message`, `edited_at`. |
| `keyresult_discussions` | `KeyResultDiscussion` | same shape on `key_result_id`. |
| `key_result_files` | `KeyResultFile` | attachment on a KR check-in: local + Google Drive + Dropbox + external URL columns. |
| `performance_records` | `PerformanceRecord` | archived per-owner-per-cycle rollup (§3.10). |

### 3.8 OKR scoring (recompute this)

Computed in PHP, not the DB (`Objective::getScore()`/`updateScore()`, `KeyResult::accomplishRate()`/`updateScore()`).

**Key result progress** — direction-aware linear interpolation, then capped at 100:

```
if target > initial:  round((current - initial) * 100 / (target - initial))   # increase goal
if target < initial:  round((initial - current) * 100 / (initial - target))   # decrease goal (e.g. cut defects)
if target == initial: 0
```

If a KR has child objectives aligned under it (`key_result_parent_id`), its progress is the weighted average of those child objectives' `result_percentage` instead of the value math (roll-up mode).

**Objective score** — weighted average of its KRs' capped progress, **including the KRs of child objectives**:

```
result_percentage = round( Σ( min(KR.progress, 100) * KR.weight ) / Σ(KR.weight) )
```

**Cascade:** score changes walk **upward** through the alignment tree. Updating a KR calls its objective's `updateScore()`; if that objective is aligned under a parent KR (`key_result_parent_id`), the parent KR's `updateScore()` runs, and so on. Child objective → parent KR → parent objective.

### 3.9 Status is derived, never stored

There is no status enum on objectives or key results. Two numbers derive everything:

**RAG color from progress %** (thresholds from `performance_settings.color_pass`/`color_fail`):

| Condition | Color |
|---|---|
| `progress ≥ color_pass` (default 75) | green |
| `progress ≥ color_fail` (default 50) | amber |
| else | red |

**Status bucket from confidence (0–10)** (`PerformanceRecordService`):

| Confidence | Bucket |
|---|---|
| 9–10 | Completed |
| 5–8 | Ongoing (on track) |
| 1–4 | At risk |
| 0 / other | Not tracked |

### 3.10 Cycle archival & scorecard rollup

`PerformanceSetting::archivePerformanceCycle($cycleId)` aggregates, per owner, `SUM(result_percentage * weight) / SUM(weight)` into `performance_records` (`model_id`/`model_type`, `performance_cycle_id`, `result_value`, plus objective/KR counts per RAG bucket: `total_obj`, `total_obj_atrisk/ongoing/complete/nottrack`, and the `total_kr_*` equivalents). If the rewards module is on and `reward_settings.calculate_okr = 1`, it also writes `scores` rows (points) and bumps `score_period`/`score_all` on the owning Company/Team/EmployeeDetails.

---

## 4. KPI (indicator) tables

FlowyTeam's KPI is the **Indicator**. See the fuller notes in the KPI analysis; the load-bearing schema:

### 4.1 `indicators`

Model `app/Models/Indicator.php`. Soft deletes. Base migration `2020_07_26_151408_create_indicators_table.php` + many alters.

| Column | Type | Meaning / import note |
|---|---|---|
| `id` | bigint PK | |
| `company_id` | int unsigned | |
| `indicator_type_id` | bigint | FK `indicator_types` = **KPI category**. |
| `title` | string | |
| `type` | enum `('personal','team','company')` default `personal` | owner kind (drives `model_type`). |
| `model_id` / `model_type` | int / string | **polymorphic owner** ({Company, Team, EmployeeDetails}), same pattern as objectives. |
| `occurance` | enum `('daily','weekly','monthly','quarterly','yearly')` default `daily` | **frequency / period** (note the misspelling; OpenOKR renames to `frequency`). |
| `unit_value` | string null | free-text unit label. |
| `direction` | enum `('up','down','none')` default `none` | higher- vs lower-is-better. Present but lightly wired; the active RAG path assumes higher-is-better. |
| `target_value` | bigint default 0 | default/fixed target (integer only at this level). |
| `target_fixed` | bool default 0 | if 1, per-period target cannot be edited. |
| `aggregate` | enum `('sum','avg','max','min','count')` default `sum` | roll-up function across sub-periods (for calculated KPIs). |
| `calculated` | bool default 0 | this KPI is a formula of other KPIs. |
| `calculated_value` | text null | formula tokens (§4.5). |
| `color_fail` | int default 50 | RAG lower threshold (percent). |
| `color_pass` | int default 75 | RAG upper threshold (percent). |
| `score` | int default 0 | reward points granted when a period hits target. |
| `indicator_parent_id` | bigint null | parent KPI (tree). |
| `remark` | bool default 0 | capture a remark per record. |
| `start_date`, `end_date` | date null | active window. |
| `created_by` | int null | → users. |
| `planning_strategy_target_id` | bigint null | link to a Planning target (out of scope). |
| `sort` | int default 0 | ordering. |
| timestamps + `deleted_at` | | |

Owner has **no Eloquent `morphTo`**; `model_id`/`model_type` are set by hand in controllers. `type=personal` → `EmployeeDetails`, `team` → `Team`, `company` → `Company`.

### 4.2 `indicator_types` (= KPI category)

Model `IndicatorType`. `id`, `company_id`, `name`, timestamps, `deleted_at`. Exposed by the v2 API under `indicator-category`. (The v2 category controller references `status`/`description` columns that **do not exist** — dead code; do not replicate.)

### 4.3 `indicator_records` (target vs actual per period)

Model `IndicatorRecord`. The tracking rows.

| Column | Type | Meaning |
|---|---|---|
| `id` | bigint PK | |
| `company_id` | int unsigned | |
| `indicator_id` | bigint | FK `indicators`, cascade. |
| `period_key` | **date** | the period bucket, **always normalized to the start of the period** (start of day/week/month/quarter/year). Primary period identity. |
| `current_value` | float default 0 | the **actual**. |
| `target_value` | float default 0 | the **target** for the period (overrides the indicator default unless `target_fixed`). |
| `remark` | string null | note (only if `indicators.remark = 1`). |
| `updated_by` | int null | → users. |
| timestamps + `deleted_at` | | |

No DB unique constraint; dedup is code-level on `(indicator_id, company_id, period_key)`. **OpenOKR adds a unique index.**

### 4.4 `indicator_accesses`, `indicator_calculates`, data sources, KR pivot

| Table | Meaning |
|---|---|
| `indicator_accesses` | per-user access + per-user view frequency: `indicator_id`, `user_id`, `occurance`, `permissions` (`read`/`update`), `view_options` (`me`/`manager`/`team`/`everyone`), `department_id`. OpenOKR replaces this with RBAC + a share table. |
| `indicator_calculates` | formula dependency edges: `indicator_id` (dependent) ← `indicator_calc_id` (source). Used to cascade recompute. |
| `indicator_data_sources` / `indicator_datasource_dbs` | external feeds (Google Sheets, Google Analytics, SQL) that auto-populate `indicator_records`. Import the config as reference; the sync jobs are out of scope for v1. |
| `keyresult_indicator` | **KR↔KPI pivot** (`2024_01_18_011630`): `key_result_id`, `indicator_id`. Bare pivot, no id/timestamps. Links a key result to one or more KPIs. |

### 4.5 KPI achievement & the formula engine (recompute)

**Achievement %** for a record: `current_value / target_value * 100`, compared to `color_fail`/`color_pass` for RAG (same three-band rule as OKRs). Direction `down` (lower is better) should invert; in the current code the active path assumes higher-is-better, so verify per instance.

**Calculated KPIs.** `calculated_value` holds a comma-separated token list: `kpi_<id>` references, numeric literals, and operators `op_plus`/`op_minus`/`op_multiply`/`op_divide`/`op_open`/`op_close`. Evaluation replaces each `kpi_<id>` with the source KPI's value for the matching `period_key`; when a source KPI has a finer frequency than the target, its records are aggregated with the `aggregate` function (`sum`/`avg`/`max`/`min`/`count`) over the period, then the expression is evaluated (PHP `eval()` today) and written back as a record for the parent KPI. Cascades recursively through `indicator_calculates`. **OpenOKR models this as a typed expression tree, evaluated safely (no `eval`), with the dependency graph stored explicitly.**

### 4.6 KPI reminders / feeds

No dedicated KPI notification class. KPI update nudges ride on the daily `EmailReminderJob` digest. External feeds (`GoogleSheetJob`, `GoogleAnalyticsJob`, the `datasource-sql` command) write `indicator_records` on a daily schedule.

---

## 5. Tasks tables

FlowyTeam has its own `tasks` model. OpenOKR **unifies tasks into `work_packages`** (see `../TECHNICAL-PLAN.md` §4.12); this section is the source truth for that mapping.

### 5.1 `tasks`

Model `app/Models/Task.php`. Soft deletes. `CustomFieldsTrait`. `$guarded = ['id']`. Observer `TaskObserver` (sets `company_id`, purges search + notifications on delete).

| Column | Type | Meaning / import note |
|---|---|---|
| `id` | int unsigned PK | |
| `company_id` | int unsigned | |
| `heading` | string | the task title (→ `work_packages.subject`). |
| `description` | mediumtext | rich text. |
| `start_date`, `due_date` | date | (`due_date` is NOT NULL). |
| `estimate_to_complete` | datetime null | |
| `user_id` | int unsigned | **single assignee** (→ `work_packages.assignee_id`). |
| `created_by` | int null | owner/creator (→ `author_id`). |
| `project_id` | int null | FK `projects` (tasks can be project-less). |
| `milestone_id` | int null | FK `project_milestones`. |
| `key_results_id` | int null | **FK `key_results` — the OKR link.** Bidirectional: the code also writes `key_results.task_id` back. Tasks never link to KPIs directly. |
| `task_category_id` | int null | FK `task_category`. |
| `priority` | enum `('low','medium','high')` default `medium` | |
| `status` | enum `('incomplete','completed')` default `incomplete` | **derived** from the board column slug, not authoritative. |
| `taskboard_id` | int null | FK `task_boards` (NULL = default board). |
| `board_column_id` | int default 1 | **FK `taskboard_columns` — the real Kanban state.** |
| `column_priority` | int | card order within its column. |
| `completed_on` | datetime null | set when moved to a `completed`-slug column. |
| `recurring_task_id` | int null | self-FK: links generated repeat instances to the base task. |
| `dependent_task_id` | int null | self-FK: this task depends on / is blocked by that task. |
| timestamps + `deleted_at` | | |

### 5.2 Supporting task tables

| Table | Model | Meaning / import note |
|---|---|---|
| `sub_tasks` | `SubTask` | lightweight checklist item: `task_id`, `assign_to` (single), `title`, `start_date`, `due_date`, `status` enum `('incomplete','complete')` — note `complete` not `completed`. **No company_id, no soft delete, no % rollup.** OpenOKR maps to `checklist_items`. |
| `taskboard_columns` | `TaskboardColumn` | the Kanban columns / statuses: `company_id` (NULL = global default), `taskboard_id`, `column_name`, `slug`, `label_color`, `priority` (order). Only slugs `incomplete` and `completed` carry app meaning; every other column (`in_progress`, `to_do`, `backlog`, `testing`, custom names) is free-form. Seeded defaults: "Incomplete" (id 1, slug `incomplete`, red) and "Completed" (slug `completed`, green). |
| `task_boards` | `TaskBoard` | multi-board (2023): `company_id`, `created_by`, `title`, `slug` (unique). A board owns its own columns. |
| `task_board_accesses` | `TaskBoardAccess` | board visibility grants: `user_id`, `taskboard_id`. |
| `tasks_accesses` | `TasksAccesses` | **watchers / per-task access**: `task_id`, `user_id`. Creator + assignee + `employee_access[]` each get a row. → `work_package_watchers`. |
| `task_category` | `TaskCategory` | flat per-company list (singular table name): `company_id`, `category_name`. No color, no board link. Closest thing to a label. → `categories`. |
| `task_comments` | `TaskComment` | `comment`, `user_id`, `task_id`, `parent_id` (1-level threaded), `edited_at`. **No company_id.** → `comments`. |
| `task_files` | `TaskFile` | attachments: local + Google Drive + Dropbox + external URL. → `attachments`. |
| `ticket_tasks` | `TicketTasks` | pivot: a task created from a support ticket. |
| `project_time_logs` | `ProjectTimeLog` | **shared** time tracking (not task-specific): `project_id`, `task_id` (nullable), `user_id`, `start_time`, `end_time`, `memo`, `total_hours`, `total_minutes`, `earnings`. → `time_entries`. |

### 5.3 Task business rules the importer/rebuild must preserve

- **State = board column, not `status`.** On a move, if the target column's `slug == 'completed'` set `status='completed'` + `completed_on=now()`, else `incomplete`. Custom columns map to OpenOKR statuses (with `is_closed` only on `completed`-slug columns).
- **Dependency guard:** a task cannot be completed while any task with `dependent_task_id = this.id` is still incomplete. Maps to a `blocks`/`precedes` relation in `work_package_relations`.
- **Recurring tasks:** driven by request flags (`repeat`, `repeat_type` day/week/month/year, `repeat_count` interval, `repeat_cycles` capped 31/16/12/3). Cloned copies carry `recurring_task_id`. This is a **new** capability for OpenOKR (the first source has none); design a recurrence rule.
- **Single assignee** + watchers via `tasks_accesses`. Subtasks are a flat checklist with no rollup.
- **Task → Key Result** is the load-bearing OKR link; `whereNull('key_results_id')` is how the UI separates "OKR tasks" from normal tasks.

---

## 6. Org / owner model

### 6.1 Teams are also departments (nested-set tree)

Model `app/Models/Team.php` (`teams` table). Uses `Kalnoy\Nestedset\NodeTrait` (`_lft`, `_rgt`, `parent_id`) for an org-chart tree, plus `HasObjectiveTrait` (owns OKRs) and soft deletes. `EmployeeDetails::department()` points at a `teams` row via `department_id`; there is **no separate departments table**. Key columns: `team_name`, `company_id`, `leader_id` (→ users), `checkin_default_visibility` enum `('me','admin','adminmanager','manager','team','all')`, `description`, reward aggregates (`score_all`, `score_period`), nested-set columns.

### 6.2 Employees, designations, memberships

| Table | Model | Meaning |
|---|---|---|
| `employee_details` | `EmployeeDetails` | the individual OKR/KPI owner. FKs: `user_id`, `department_id` (→ teams, primary), `team_id` (→ teams, original), `designation_id`, `reports_to` (→ employee_details, manager chain), reward aggregates. |
| `designations` | `Designation` | job titles only (`name`, `description`, `company_id`). Not an owner. |
| `other_departments` | `OtherDepartment` | **user↔team many-to-many pivot** (the active one): `user_id`, `team_id`. |
| `employee_teams` | `EmployeeTeam` | a second, less-used membership pivot. |

**Ownership summary:** an objective or indicator's owner is `model_type` → `Company` (workspace-wide), `Team` (a team/department), or `EmployeeDetails` (a person). OpenOKR denormalizes this to an `owner_type` enum + nullable `team_id`/`user_id` (see target schema).

### 6.3 Rewards / points (optional cross-module score)

`reward_settings` (one row per company) configures how OKR + KPI + attendance + task progress combine into an employee's points: `calculate_okr`/`calculate_kpi`/`calculate_attendances`/`calculate_task_progress` flags, `score_okr` multiplier, KPI min/max score bands per level, who can award, expiry. `scores` is the points ledger (`employee_id`, `team_id`, `performance_cycle_id`, `model_id`/`model_type`, `score`, `reason`, `expiry_date`, `status`). OpenOKR treats this as an optional scorecard/points layer, off by default.

### 6.4 Reviews (adjacent, not core OKR)

Performance reviews live in `message_settings` (`review_occurance` cadence, open/close-day windows, self/peer/manager/staff flags) and a `reviews` table (type, reviewer, date range, rating/ranking, Q&A JSON). Related to OKR by cadence, not by foreign key. Out of scope for the first OpenOKR OKR/KPI slice; documented so the importer recognizes the tables.

---

## 7. Permissions & roles (as-is)

FlowyTeam has **almost no real permission gating** for OKR/KPI:

- **Tasks** use Spatie abilities: `add_tasks`, `view_tasks`, `edit_tasks`, `delete_tasks` (checked in controllers, not as route middleware).
- **OKR / KPI** are gated only by **module enablement** (`in_array('performances', $user->modules)` for OKR/check-ins, `in_array('kpi', ...)` for indicators) plus the `performance_settings` edit matrix and per-row `objective_accesses` / `indicator_accesses`. There are **no** `objective`/`keyresult`/`kpi`/`indicator`/`scorecard`/`checkin` permission strings, and the seeded `*_performance` permissions are dead (referenced only in commented-out code).
- **Roles** seeded per company: `admin`, `employee`, `client`, plus `project_admin` and a `users.super_admin` flag.

**Rebuild stance:** OpenOKR designs real RBAC for these from scratch (see `../TECHNICAL-PLAN.md` §4.12.8). The FlowyTeam matrix booleans and access rows are inputs to the mapping, not a permission model to copy.

---

## 8. Public shape: v2 REST + MCP tools

FlowyTeam exposes these entities over a Sanctum v2 API and an MCP server. The MCP tool field lists are the cleanest canonical shape and are the reference for OpenOKR's own REST/MCP surface.

| Tool / resource | Key fields (canonical) |
|---|---|
| `objectives` | `title` (req), `objective_type` (`personal`/`team`/`company`), `description`, `performance_cycle_id`, `started_at`, `finished_at`, `weight` (0–100); read adds `key_results[]`, `score`, cycle name, owner name. |
| `key-result` | `objective_id` (req), `title` (req), `description`, `initial_value` (0), `target_value` (100), `current_value`, `unit_value` (`%`), `weight` (0–100), `confidence` (0–10); read adds `current_percentage`, `accomplish_rate`. |
| `performance-cycle` | `name` (req), `cycle_type` (quarterly/annual/monthly), `started_at` (req), `finished_at` (req); admin-only writes; a per-employee status mode mirrors `performance_records`. |
| `indicators` | `title` (req), `category_id`, `employee_id`, `target_value`, `unit_value`, `occurance` (daily…yearly, default monthly), `description`; also writes an access row. |
| `indicator-record` | `indicator_id` (req), `period_key` (req, Y-m-d), `current_value`, `target_value`, `remark`; POST = upsert on `(indicator_id, period_key)`. |
| `indicator-category` | `name`/`indicator_type_name` (req). |
| `tasks` | `heading` (req), `description`, `priority` (low/medium/high), `project_id`, `assigned_to`, `due_date`, `start_date`, `task_category_id`, `status` (incomplete/completed), `employee_access[]`, `key_results_id`. |
| `task-category` | `category_name` (req). |

---

## 9. Content format

Rich text (objective/KR descriptions, task descriptions, discussions, remarks) is CKEditor/TinyMCE-style **HTML** stored in `text`/`mediumtext` columns (not Markdown, unlike the first source). Mentions and internal links are plain HTML anchors. The importer converts HTML to OpenOKR's Markdown-with-format-tag storage and runs the same two-phase reference-rewrite pass (remap task/objective/KR/user ids after load). Attachments are referenced by filename against `task_files` / `key_result_files`, which may point at local disk, Google Drive, Dropbox, or an external URL — the importer copies local bytes and records external links as `file_links`.

---

## 10. Reminders & scheduled jobs (as-is)

One daily digest drives all OKR/KPI/check-in/task nudges: `flowy:sendemailreminder` at 06:00 → `EmailReminderJob` → the `ActivityReminder` mail, built per-user from the weekday opt-in columns `users.email_day_0..6` and each user's `email_type` selection (OKR / KPI / check-in / tasks). There are no per-event notification classes and no push/Slack OKR reminders. OpenOKR rebuilds reminders on its notification spine (check-in due, cycle open/close, KR at-risk, task due) with per-user, per-channel settings.

---

## 11. Importer-critical notes (FlowyTeam source)

**Source is MySQL, read-only.** The first source is PostgreSQL; the FlowyTeam mapper needs a read-only MySQL client. Open with `SET SESSION TRANSACTION READ ONLY` and never write, lock, or migrate the source. Adding a MySQL driver is a new runtime dependency for `packages/importer` — confirm with the human before adding (CLAUDE.md rule).

**One database, many companies.** Every table is scoped by `company_id`. The importer requires a `--company <id>` selector (or a loop that maps each company to its own OpenOKR workspace). Never import across companies into one workspace.

**FK import order** (topological, per company):

1. `teams` (rebuild the tree from `parent_id`, drop `_lft`/`_rgt`), `designations`, `employee_details`, membership pivots (`other_departments`).
2. `performance_settings`, `performance_cycles`.
3. `indicator_types`, `indicators` (parents before children), `indicator_records`, `indicator_calculates` (formula edges).
4. `objectives` (two-pass for `objective_parent_id`), `key_results`, `keyresult_indicator`, `key_result_records`.
5. `objective_checkins`, `key_result_checkins`, `checkins`, `checkin_reviews`, discussions, files.
6. `task_boards`, `taskboard_columns`, `task_category`, `tasks` (two-pass for `dependent_task_id`/`recurring_task_id`), `sub_tasks`, `tasks_accesses`, `task_comments`, `task_files`, `project_time_logs`.
7. `performance_records`, `reward_settings`, `scores` (optional points layer).
8. Two-phase reference rewrite of rich-text bodies.

**Idempotency:** keep `legacy_id` + `legacy_type = 'flowyteam'` on every imported row; upsert on `(workspace_id, legacy_type, legacy_id)`. This coexists with the first source's rows (`legacy_type = 'openproject'`) in the same target tables.

**Known lossy / hard spots** (log each, raise to human):

| Area | Issue |
|---|---|
| `objective_type` string | broken enum; derive owner level from `model_type`. |
| KR value columns | `bigint` since 2023 truncated fractional targets; import as-is, note the precision loss. |
| Calculated KPIs | `calculated_value` token string + `eval()`; translate to OpenOKR's expression tree; unparseable formulas dropped with a warning. |
| KPI `direction=down` | lower-is-better may be mis-scored in the source; recompute progress correctly, flag rows that change. |
| Derived scores | `result_percentage`, `current_percentage`, `performance_records`, `scores` are all recomputed; never trust stored values. |
| Passwords | out of scope for these modules; handled by the identity importer. |
| `sub_tasks` / `task_comments` | no `company_id`; scope through the parent task. |
| External file links | Google Drive / Dropbox / external URLs become `file_links`, not copied bytes. |
| Planning links | `planning_strategy_id` / `planning_strategy_target_id` reference the out-of-scope Planning module; import as null unless Planning is added. |
| Reviews / rewards | adjacent modules; import only if the human funds them, else log-and-skip. |

**Never** write to, lock, migrate, or dump-with-lock the source database. Open it read-only.
