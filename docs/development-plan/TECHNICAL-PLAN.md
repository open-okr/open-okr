# TECHNICAL-PLAN.md

Target technical design for `OpenOKR`. This turns REQUIREMENTS.md (what) and PLAN.md (principles) into concrete schema, module, and importer design decisions. IMPLEMENTATION-PLAN.md turns this into ordered tasks.

Authority: below PLAN.md, above IMPLEMENTATION-PLAN.md. When this doc and PLAN.md disagree, PLAN.md wins. When code and this doc diverge during a task, update this doc in the same PR.

Cross-references: legacy facts live in `reference/legacy-data-model.md` (schema) and `reference/legacy-feature-inventory.md` (features/permissions).

---

## 1. Stack and layout (from PLAN.md, restated as the contract)

- **Runtime:** Next.js App Router (React, TypeScript strict). Server Components for reads, Server Actions + tRPC for writes.
- **API:** tRPC for the app's own UI; a versioned REST surface (`/api/rest/v1`) for integrations and the importer's verification tooling.
- **Data:** PostgreSQL via Drizzle ORM only. `DATABASE_URL` is the sole connection. Row Level Security on every business table.
- **Auth:** Better Auth (email+password, passkeys, TOTP, OIDC, SAML). No hand-rolled sessions.
- **UI:** Tailwind + shadcn/ui on **Base UI** primitives (not Radix), **SmoothUI** animated components on **Motion** (build-time vendored via the shadcn MCP registries), TanStack Query + Table.
- **Validation:** Zod at every boundary.
- **Adapters:** `packages/adapters` for jobs, realtime, storage, mailer, cache, search, ai. Two driver sets (container / serverless). Feature code never imports a vendor SDK.
- **Monorepo:** Turborepo + pnpm. Packages: `core`, `db`, `adapters`, `importer`, `ui`, `config`; app in `apps/web`.

### Package responsibilities

| Package | Owns | May depend on |
|---|---|---|
| `packages/db` | Drizzle schema, migrations, RLS policies, seed | nothing app-specific |
| `packages/core` | Domain services, permission checks, scheduling engine, query DSL | `db` |
| `packages/adapters` | Ports + drivers (only place vendor SDKs live) | `config` |
| `packages/importer` | legacy DB reader + mappers + CLI | `db` (write), a read-only pg client (read) |
| `packages/ui` | Shared shadcn components | — |
| `apps/web` | Next.js routes, tRPC routers, REST, React UI | `core`, `adapters`, `ui`, `db` (types) |

## 2. Multi-tenancy and identity model

- Top-level tenant is a **workspace** (`workspaces` table). Every business row carries `workspace_id` and an RLS policy keyed on a session GUC (`app.workspace_id`) set per request.
- A single self-hosted institution runs one workspace; a future cloud runs many. Same schema.
- **Users are global** to a deployment (a person has one login) but **membership is per workspace**. This mirrors the legacy system where users are instance-global and members are per project. Map: The legacy system instance -> one workspace by default (see importer §7).
- Within a workspace: **projects** form the tree; **members** grant **roles**; roles carry **permissions**. RLS enforces workspace isolation; the `core` permission layer enforces role/permission checks; never rely on the UI.

## 3. Naming and ID strategy

- New primary keys are `uuid` (v7, time-ordered) generated app-side, so the importer can assign IDs deterministically and rewrite cross-references in a second pass.
- Every table importable from the legacy system carries `legacy_id bigint` and, where one new table merges several legacy ones, `legacy_type text`. Unique index `(workspace_id, legacy_type, legacy_id)` gives idempotent upserts.
- Enumerated values (status categories, field formats, relation types, notification reasons) are TypeScript string unions persisted as `text` with a check constraint, not integer codes. The importer maps the legacy system's integer/string codes to these.

## 4. Target domain model (new schema, by module)

Tables listed with the columns that matter for design and import. All get `id uuid pk`, `workspace_id uuid`, `created_at`, `updated_at`, `legacy_id`, and an RLS policy unless noted. "Rich text" columns are Markdown stored with a `format` tag and a `version int` (co-edit-ready per PLAN.md §7).

### 4.1 Identity & access

| Table | Key columns | Notes |
|---|---|---|
| `workspaces` | `name`, `slug`, `settings jsonb` | tenant root; no `workspace_id` on itself |
| `users` | `email`, `name`, `kind` (`user`/`placeholder`), `status`, `locale`, `timezone` | global; Better Auth owns credentials/sessions |
| `groups` | `name` | a principal |
| `group_members` | `group_id`, `user_id` | |
| `memberships` | `principal_id`, `principal_kind`, `project_id?`, `shared_entity_type?`, `shared_entity_id?` | project membership or shared-object membership (WP sharing) |
| `roles` | `name`, `scope` (`project`/`global`/`work_package`), `builtin` (`none`/`non_member`/`anonymous`) | |
| `membership_roles` | `membership_id`, `role_id`, `inherited_from_membership_id?` | group inheritance recomputed, not imported |
| `role_permissions` | `role_id`, `permission` (text enum) | one row per permission |
| `audit_events` | `actor_id`, `action`, `target_type`, `target_id`, `payload jsonb`, `at` | append-only, day one (PLAN.md §6) |

Permission strings: reuse the legacy system's names where sensible (`view_work_packages`, `edit_work_packages`, `manage_members`, ...) so the mapping is 1:1. The full list is in `reference/legacy-feature-inventory.md` §2.

### 4.2 Projects & versions

| Table | Key columns | Notes |
|---|---|---|
| `projects` | `name`, `identifier`, `parent_id`, `public`, `archived`, `templated`, `status`, `status_explanation`, `settings jsonb` | tree via `parent_id`; derive materialized path or use recursive CTE, not nested set |
| `project_enabled_modules` | `project_id`, `module` (text) | feature toggles per project |
| `project_hierarchy` | `ancestor_id`, `descendant_id`, `depth` | optional closure table for fast subtree queries |
| `versions` | `project_id`, `name`, `status` (`open`/`locked`/`closed`), `sharing`, `start_date`, `effective_date` | milestones/sprints |
| `categories` | `project_id`, `name`, `default_assignee_id?` | |

### 4.3 Work packages

| Table | Key columns | Notes |
|---|---|---|
| `work_packages` | `project_id`, `type_id`, `subject`, `description` (rich), `status_id`, `priority_id?`, `assignee_id?`, `responsible_id?`, `author_id`, `version_id?`, `category_id?`, `parent_id?`, `start_date?`, `due_date?`, `duration?`, `schedule_manually`, `ignore_non_working_days`, `estimated_hours?`, `remaining_hours?`, `story_points?`, `done_ratio?`, `lock_version` | `derived_*` are computed, not stored authoritatively (see §6) |
| `work_package_versions` | `work_package_id`, `version_id`, `kind` (`target`/`observed_in`) | lossless carry of the legacy system's 2026 multi-version links; v1 UI edits a single target version (`version_id` mirrors the sole target row) |
| `work_package_hierarchy` | `ancestor_id`, `descendant_id`, `depth` | closure table, rebuilt from `parent_id` |
| `work_package_relations` | `from_id`, `to_id`, `relation_type`, `lag?`, `description?` | app prevents cycles |
| `work_package_watchers` | `work_package_id`, `user_id` | |
| `types` | `name`, `is_milestone`, `is_default`, `color`, `form_config jsonb` | `form_config` replaces YAML `attribute_groups` |
| `statuses` | `name`, `is_closed`, `is_default`, `is_readonly`, `default_done_ratio`, `excluded_from_totals`, `color` | |
| `workflows` | `type_id`, `role_id`, `old_status_id`, `new_status_id`, `author_only`, `assignee_only` | state machine |
| `priorities` | `name`, `is_default`, `active`, `position` | was `enumerations` STI |

### 4.4 Custom fields

| Table | Key columns | Notes |
|---|---|---|
| `custom_fields` | `customized_type` (`work_package`/`project`/`user`/`version`/`time_entry`), `name`, `field_format`, `is_required`, `is_multi`, `regexp?`, `min_length?`, `max_length?`, `default_value?`, `searchable`, `section_id?` | |
| `custom_field_options` | `custom_field_id`, `value`, `position` | list options |
| `custom_field_values` | `custom_field_id`, `customized_type`, `customized_id`, `value` (text or option ref) | one row per value; multi = many rows |
| `custom_field_activations` | `custom_field_id`, `scope_type` (`project`/`type`/`role`), `scope_id` | replaces the several legacy join tables |
| `custom_field_sections` | `name`, `scope`, `position` | grouping |

Design the value storage so it can be queried in filters. Consider a typed sidecar (`value_text`, `value_number`, `value_date`, `value_option_id`) to index by format; decide in the custom-fields design doc.

### 4.5 Queries & views (the new query DSL)

The legacy system stores filters as serialized Ruby YAML. The new system defines a **JSON query DSL** and stores it in a `jsonb` column.

| Table | Key columns | Notes |
|---|---|---|
| `queries` | `project_id?`, `name`, `definition jsonb`, `owner_id?`, `visibility` (`private`/`public`), `starred` | `definition` = filters+columns+sort+group+sums+display |
| `views` | `query_id`, `type` (`table`/`cards`/`gantt`/`calendar`/`team_planner`/`board`), `options jsonb` | |
| `query_orderings` | `query_id`, `work_package_id`, `position` | manual card/list order |

`definition` shape (design doc formalises with Zod):

```json
{
  "filters": [{ "field": "status", "operator": "open", "values": [] }],
  "columns": ["id", "subject", "status", "assignee"],
  "sort": [["id", "asc"]],
  "groupBy": "status",
  "sums": ["estimated_hours"],
  "display": { "hierarchy": true, "timeline": { "zoom": "days" } }
}
```

The importer maps each the legacy system filter class + operator to a `{field, operator}` pair. Operators map: `=`→`is`, `!`→`is_not`, `~`→`contains`, `o`→`open`, `c`→`closed`, `<t+`/`>t-` date operators→named date operators. Unknown filter classes are dropped with a logged warning.

### 4.6 History, comments, notifications

Instead of the legacy system's temporal `journals`, use two simpler structures:

| Table | Key columns | Notes |
|---|---|---|
| `comments` | `subject_type`, `subject_id`, `author_id`, `body` (rich), `internal` (bool), `created_at` | WP/wiki/meeting/news comments; `internal` = enterprise internal comments |
| `activities` | `subject_type`, `subject_id`, `actor_id`, `kind`, `changes jsonb`, `at` | field-change feed (from/to), append-only |
| `reactions` | `subject_type`, `subject_id`, `user_id`, `emoji` | on comments |
| `notifications` | `recipient_id`, `reason`, `subject_type`, `subject_id`, `read_at?`, `mailed_at?` | |
| `notification_settings` | `user_id`, `project_id?`, `channel`, `involved`, `watched`, `mentioned`, `assignee`, `date_alerts jsonb` | global + per-project rows |
| `reminders` | `work_package_id`, `user_id`, `remind_at`, `note?` | |

Rationale: co-edit-readiness (PLAN.md §7) needs structured content + version columns on the *live* rows, which we have. It does not need the legacy system's byte-perfect version snapshots. History import is tiered (data-model §8).

### 4.7 Time, cost, budgets

| Table | Key columns | Notes |
|---|---|---|
| `time_entries` | `work_package_id?`, `project_id`, `user_id`, `logged_by_id`, `activity_id`, `hours`, `spent_on`, `comment?`, `ongoing` | `ongoing` = running timer |
| `time_entry_activities` | `name`, `is_default`, `active`, `position` | |
| `cost_types` | `name`, `unit`, `unit_plural`, `default_rate` | |
| `cost_entries` | `work_package_id?`, `project_id`, `user_id`, `cost_type_id`, `units`, `spent_on`, `comment?` | |
| `rates` | `kind` (`hourly`/`default_hourly`/`cost`), `user_id?`, `cost_type_id?`, `project_id?`, `amount`, `valid_from` | valid-from history |
| `budgets` | `project_id`, `subject`, `fixed_date` | |
| `budget_items` | `budget_id`, `kind` (`labor`/`material`), `units?`, `amount?`, `user_id?`, `cost_type_id?`, `comment?` | |

Cost/rate visibility uses the `view_hourly_rates` / `view_own_hourly_rate` / `view_cost_entries` permissions (feature inventory §2).

### 4.8 Collaboration (wiki, meetings, forums, news, documents)

| Table | Key columns | Notes |
|---|---|---|
| `wikis` | `project_id`, `start_page` | one per project |
| `wiki_pages` | `wiki_id`, `slug`, `title`, `parent_id?`, `body` (rich), `protected` | tree via `parent_id`; versions via `activities`/history tier |
| `forums` | `project_id`, `name`, `description` | P2 |
| `messages` | `forum_id`, `parent_id?`, `subject`, `body` (rich), `author_id`, `sticky`, `locked` | P2 |
| `news` | `project_id`, `title`, `summary`, `body` (rich), `author_id` | P2 |
| `documents` | `project_id`, `category_id`, `title`, `body` (rich) | P2 |
| `meetings` | `project_id`, `title`, `type` (`structured`/`recurring_template`), `start_time`, `duration`, `location`, `state` (`open`/`closed`) | |
| `meeting_sections` | `meeting_id`, `title`, `position` | |
| `meeting_agenda_items` | `meeting_id`, `section_id?`, `title`, `item_type`, `duration?`, `position`, `work_package_id?`, `notes` (rich) | |
| `meeting_participants` | `meeting_id`, `user_id`, `invited`, `attended` | |
| `recurring_meetings` | `meeting_template_id`, `rrule`, `next_occurrence` | RRULE storage |

### 4.9 Attachments & storages

| Table | Key columns | Notes |
|---|---|---|
| `attachments` | `container_type`, `container_id`, `filename`, `content_type`, `filesize`, `digest`, `storage_key`, `author_id`, `status` (`ok`/`scanning`/`quarantined`) | bytes live behind the FileStorage adapter |
| `external_storages` | `provider` (`nextcloud`/`onedrive`/`s3`), `name`, `config jsonb` | P1/P2 |
| `project_storages` | `project_id`, `external_storage_id`, `folder_mode` | |
| `file_links` | `work_package_id`, `external_storage_id`, `origin_id`, `origin_name`, `mime` | linked external files |

### 4.10 Boards, grids, dashboards

| Table | Key columns | Notes |
|---|---|---|
| `boards` | `project_id`, `name`, `board_type` (`free`/`status`/`assignee`/`version`/`subproject`/`parent`) | |
| `board_columns` | `board_id`, `position`, `query_id`, `action_value` | column = a query + the keyed attribute value |
| `dashboards` | `owner_type` (`user`/`project`), `owner_id`, `layout jsonb` | my page + project overview |
| `dashboard_widgets` | `dashboard_id`, `widget`, `options jsonb`, `position` | |

### 4.11 Integrations

| Table | Key columns | Notes |
|---|---|---|
| `github_links` / `gitlab_links` | `work_package_id`, `kind` (`pr`/`mr`/`issue`/`pipeline`), `origin_id`, `state`, `payload jsonb` | inbound webhook writes these |
| `webhooks` | `project_id?`, `url`, `events text[]`, `secret` | outbound |
| `webhook_deliveries` | `webhook_id`, `event`, `status`, `response` | SKIP on import |

### 4.12 Strategy modules (OKR, KPI, check-ins, tasks)

The strategy domain is core (Phase 4) — OpenOKR's namesake, scoped from **FlowyTeam** (Laravel/MySQL). It is specified here at this document's level of detail; the ordered tasks are IMPLEMENTATION-PLAN.md Phase 4, the scoring engine is §6.2, and the source→target mapping is §7.6. Same conventions as the rest of §4: `id uuid pk`, `workspace_id`, `created_at`, `updated_at`, `legacy_id`, `legacy_type` (`flowyteam`/`openproject`), an RLS policy in the same migration, and text enums with check constraints. Rich text is Markdown with a `format` tag + `version int`. Every table below has a row in the §7.6 mapping table.

**Two design rules reach into the tables above:**

- **Tasks are work packages.** There is no separate tasks table. `work_packages` gains the link columns `objective_id` / `key_result_id` / `kpi_id`, a `checklist_items` child table, and a `recurrence` rule (§4.12.7).
- **Strategy ownership is explicit, not polymorphic.** Objectives and KPIs carry `owner_type` (`workspace`/`team`/`user`) + nullable `team_id`/`user_id`, denormalizing FlowyTeam's `model_type` pattern.

#### 4.12.1 Org units (OKR/KPI owners)

The two sources model an "org unit" differently: the Rails tool uses project membership and groups; FlowyTeam uses a `teams` nested-set tree that doubles as departments. OpenOKR adds one org-unit concept for OKR/KPI ownership, distinct from projects.

| Table | Key columns | Notes |
|---|---|---|
| `org_units` | `name`, `kind` (`team`/`department`), `parent_id`, `lead_id?` (user), `settings jsonb` | tree via `parent_id`; closure table `org_unit_hierarchy` optional for fast subtree reads. Maps FlowyTeam `teams`. |
| `org_unit_members` | `org_unit_id`, `user_id`, `role` (`member`/`lead`) | maps `other_departments` + `teams.leader_id`. |

Users already exist (§4.1). Designations (job titles) are a light attribute on the user profile, not an owner.

#### 4.12.2 OKR cycles & settings

| Table | Key columns | Notes |
|---|---|---|
| `okr_cycles` | `name`, `cadence` (`annual`/`semiannual`/`quarterly`/`monthly`/`biweekly`/`weekly`), `starts_on`, `ends_on`, `previous_cycle_id?`, `status` (`upcoming`/`active`/`closed`), `locked` | OpenOKR generates future cycles from the cadence; the importer loads existing ones. |
| `performance_settings` | `workspace_id`, `default_cadence`, `max_objectives_per_owner`, `max_key_results_per_objective`, `rag_fail_pct` (50), `rag_pass_pct` (75), `labels jsonb` (okr/objective/keyresult/kpi/task/vision term overrides) | one row per workspace. The FlowyTeam edit matrix maps to RBAC (§4.12.8), not to booleans here. |

#### 4.12.3 Objectives & key results

| Table | Key columns | Notes |
|---|---|---|
| `objectives` | `cycle_id`, `title`, `description` (rich), `owner_type` (`workspace`/`team`/`user`), `team_id?`, `user_id?`, `lead_id?`, `parent_objective_id?`, `parent_key_result_id?`, `weight numeric` (1–100), `confidence smallint` (0–10), `result_percentage numeric` (derived), `status` (derived: `completed`/`on_track`/`at_risk`/`not_tracked`), `position` | `owner_type` denormalizes FlowyTeam's `model_type`. Two alignment pointers reproduce the cascade. `result_percentage`/`status` are derived columns, recomputed by the engine (§6.2), invalidated by job. |
| `key_results` | `objective_id`, `title`, `description` (rich), `unit` (text), `metric_direction` (`increase`/`decrease`), `initial_value numeric`, `target_value numeric`, `current_value numeric`, `progress_percentage numeric` (derived), `weight numeric` (1–100), `confidence smallint`, `lead_id?`, `work_package_id?` (a KR can be driven by a task), `position` | numeric range, no KR "type" enum (matches the source). `numeric` restores decimal precision the source lost. |
| `key_result_values` | `key_result_id`, `value numeric`, `confidence smallint?`, `at`, `author_id` | value history (maps `key_result_records` + check-in value snapshots). |

Alignment integrity: an objective sets **exactly one** of `parent_objective_id` / `parent_key_result_id` (or neither for a top objective). The app prevents cycles.

AI provenance: objectives and key results carry optional `ai_generated bool` and `ai_source_id?` (→ `ai_usage_events`, AI-NATIVE-PLAN.md §7) so AI-drafted or AI-improved items are labeled and auditable. Set by the P5-T11 assists; never on the manual create path.

#### 4.12.4 KPIs

| Table | Key columns | Notes |
|---|---|---|
| `kpi_categories` | `name` | maps `indicator_types`. |
| `kpi` | `category_id`, `title`, `description` (rich), `owner_type`/`team_id?`/`user_id?`, `frequency` (`daily`/`weekly`/`monthly`/`quarterly`/`yearly`), `unit` (text), `direction` (`higher_better`/`lower_better`), `target_default numeric?`, `target_locked bool`, `aggregate` (`sum`/`avg`/`max`/`min`/`count`), `is_calculated bool`, `formula jsonb?`, `rag_fail_pct`, `rag_pass_pct`, `reward_points int`, `parent_kpi_id?`, `starts_on?`, `ends_on?` | `frequency` renames `occurance`. `formula` is a typed expression tree, not a token string. Tree via `parent_kpi_id`. |
| `kpi_records` | `kpi_id`, `period_start date`, `target_value numeric?`, `actual_value numeric?`, `remark?`, `author_id` | **unique `(workspace_id, kpi_id, period_start)`**. `period_start` is the normalized period bucket. |
| `kpi_dependencies` | `kpi_id`, `depends_on_kpi_id` | explicit formula edges (maps `indicator_calculates`); drives cascade recompute. |
| `key_result_kpis` | `key_result_id`, `kpi_id` | KR↔KPI link (maps `keyresult_indicator`). A KR measured by a KPI reads its progress from the KPI's latest achievement. |
| `kpi_shares` | `kpi_id`, `user_id`, `access` (`read`/`update`), `scope` (`user`/`manager`/`team`/`everyone`) | maps `indicator_accesses`; per-user frequency is a client display pref, not stored per share in v1. |

#### 4.12.5 Check-ins

| Table | Key columns | Notes |
|---|---|---|
| `check_in_sessions` | `user_id`, `period_start`, `period_end`, `mood smallint?`, `submitted bool`, `reviewed bool` | maps `checkins`. |
| `check_ins` | `session_id?`, `subject_type` (`objective`/`key_result`), `subject_id`, `author_id`, `period_start`, `period_end`, `confidence smallint`, `value numeric?`, `progress_percentage numeric?`, `remark` (rich), `category` (`challenge`/`blocker`/`risk`/`suggestion`/`solution`/`resource_request`) | one polymorphic table maps both `objective_checkins` and `key_result_checkins`. |
| `check_in_reviews` | `session_id`, `reviewer_id`, `submitted bool`, `body` (rich) | maps `checkin_reviews`. |

Discussions (`objective_discussions`/`keyresult_discussions`) reuse the existing `comments` table (§4.6) with `subject_type` = `objective`/`key_result`.

#### 4.12.6 Performance snapshot & optional points

| Table | Key columns | Notes |
|---|---|---|
| `performance_snapshots` | `owner_type`/`team_id?`/`user_id?`, `cycle_id`, `result_value numeric`, `objectives_total`, `objectives_completed/on_track/at_risk/not_tracked`, `key_results_total`, `key_results_completed/...` | maps `performance_records`. Recomputed by the archive job; never trusted from source. |
| `scorecard_settings` | `workspace_id`, `include_okr bool`, `include_kpi bool`, `include_tasks bool`, `include_attendance bool`, `okr_weight`, `kpi_min/max`, weights jsonb | maps `reward_settings`. **Points off by default.** |
| `score_entries` | `owner_type`/`user_id?`/`team_id?`, `cycle_id`, `source_type`, `source_id`, `points int`, `reason?`, `expires_at?`, `status` (`pending`/`approved`) | maps `scores`. Only created when points are enabled. |

#### 4.12.7 Tasks unification (tasks are work packages)

Both sources have a "unit of work". The Rails tool has full work packages (§4.3). FlowyTeam has lighter tasks with a Kanban board and an OKR link. Instead of a `tasks` table, extend `work_packages`:

| New column on `work_packages` | Type | Notes |
|---|---|---|
| `objective_id?` | uuid → objectives | direct link to an objective. |
| `key_result_id?` | uuid → key_results | the load-bearing FlowyTeam link (task ↔ KR). |
| `kpi_id?` | uuid → kpi | link a task to a KPI (new capability; the source only links KRs). |
| `recurrence jsonb?` | | recurrence rule (interval + unit + count). New capability; FlowyTeam stored repeat as request flags only. |

New light table:

| Table | Key columns | Notes |
|---|---|---|
| `checklist_items` | `work_package_id`, `title`, `assignee_id?`, `done bool`, `position` | maps `sub_tasks`. Lightweight, no progress rollup (matches the source). |

Unification rules (the importer honors these — §7.6):

| Concern | Rule |
|---|---|
| Entity | One `work_packages` table. FlowyTeam tasks import as work packages of a default type "Task". |
| State | FlowyTeam `board_column_id` (the real state) → a `status`; only `completed`-slug columns get `is_closed = true`. `tasks.status` (the derived 2-state) is ignored. |
| Assignee | FlowyTeam single `user_id` → `assignee_id`; `created_by` → `author_id`. |
| Watchers | `tasks_accesses` → `work_package_watchers`. |
| Subtasks | `sub_tasks` → `checklist_items` (lightweight, no rollup). Not child work packages. |
| Dependencies | `dependent_task_id` → a `blocks`/`precedes` row in `work_package_relations`; keep the "cannot complete while blockers open" guard. |
| Recurrence | `recurrence jsonb` on the work package; expand on a schedule (new capability). |
| OKR/KPI link | `key_results_id` → `key_result_id`; also set `objective_id` = that KR's objective. KPI link is new/optional. |
| Categories / time / comments / files | `task_category` → `categories`; `project_time_logs` → `time_entries`; `task_comments` → `comments`; `task_files` → `attachments`. |

Board columns, watchers, comments, attachments, categories, priorities, and time entries all reuse existing work-package/board schema (§4.3/§4.7/§4.10).

#### 4.12.8 OKR/KPI permissions

FlowyTeam gates OKR/KPI by module enablement plus a settings boolean matrix. OpenOKR designs real permission strings, added to the RBAC catalogue (§4.1 / P2-T01) and enforced by `can()`:

`view_objectives`, `manage_objectives` (create/edit/delete own-scope), `manage_team_objectives`, `manage_company_objectives`, `check_in_objectives`, `align_objectives`, `view_kpis`, `manage_kpis`, `record_kpi_values`, `manage_kpi_formulas`, `view_scorecard`, `manage_performance_settings`, `manage_cycles`. Tasks reuse the existing work-package permissions (`view_work_packages`, `add_work_packages`, …) plus `link_work_to_okr`.

Level scoping (personal / team / company) maps FlowyTeam's edit matrix and `objective_accesses`/`indicator_accesses` view options (`me`/`manager`/`team`/`everyone`) onto role scope + object sharing (`objective_shares` reusing the §4.1 membership sharing pattern, and `kpi_shares` above).

**Operations** remains design-only: leave a namespace; do not create tables until scoped (REQUIREMENTS §3).

### 4.13 AI layer

The AI domain (provider config, encrypted credentials, model catalog + routing, per-feature settings, versioned prompts, copilot threads/messages, tool-call audit, usage/cost events, and pgvector embeddings) is specified at this document's level of detail in **[AI-NATIVE-PLAN.md](AI-NATIVE-PLAN.md) §7** (consolidated as DATABASE.md domain S). Every table there follows the §3 ID strategy and §8 RLS rules; the tables are **new (no legacy source)**, so they carry no `legacy_id`/`legacy_type`. `ai_credentials` is never selected to the client. Semantic search uses the **pgvector** extension of Postgres, keeping Postgres the only required service (§13 unchanged).

## 5. Adapter ports (concrete interfaces)

Each port is a TypeScript interface in `packages/adapters` with a container driver and a serverless driver. Ports required by v1:

| Port | Methods (sketch) | Container | Serverless |
|---|---|---|---|
| JobQueue | `enqueue(name, payload, opts)`, `schedule(cron)` | pg-boss | Inngest |
| Realtime | `publish(channel, event)`, `subscribe(channel)` | WS + LISTEN/NOTIFY | Supabase Realtime |
| FileStorage | `put`, `get`, `signedUrl`, `delete` | local/MinIO | S3/R2/Supabase |
| Mailer | `send(message)` | SMTP | Resend/SMTP |
| Cache | `get`, `set`, `incr`, `rateLimit` | in-proc + Postgres | Upstash |
| Search | `index`, `query` | Postgres FTS | Postgres FTS |
| AIProvider | `chat`, `stream`, `chatWithTools`, `embed`, `extract`, `capabilities` (AI-NATIVE-PLAN.md §3) | any / local / off | same |

The importer uses JobQueue (long imports run as jobs) and FileStorage (to copy attachment bytes).

Unlike the other ports, the AIProvider driver is selected by **stored config** (deployment / workspace / per-user bring-your-own key, AI-NATIVE-PLAN.md §3.3), not the `RUNTIME` var. Its full architecture — providers (incl. Ollama and any OpenAI-compatible endpoint), model routing, the permission-checked tool registry, the in-app copilot, the MCP server, embeddings/RAG, and AI security — is specified in **AI-NATIVE-PLAN.md**.

## 6. The pure engines (highest-risk cores)

Two derived-value engines are pure, DB-free function sets in `packages/core`, each unit-tested with golden masters: the **scheduling engine** (§6.1, work-package dates/rollups) and the **OKR scoring engine** (§6.2, KR progress/objective score/RAG/status/KPI achievement). Derived columns are invalidated by job, never computed per-row at render.

### 6.1 The scheduling engine

The legacy system's scheduler is the hardest thing to reproduce. Design it as a pure function in `packages/core` so it is unit-testable without a DB.

Rules to reproduce:

1. Each work package has `schedule_manually`. Manually scheduled ones keep their dates.
2. Automatically scheduled ones derive `start_date` from the latest `due_date` of their `follows` predecessors plus `lag`, skipping non-working days unless `ignore_non_working_days`.
3. `duration` links start and due (`due = start + duration - 1`, counting working days).
4. Parent work packages roll up: `start` = min child start, `due` = max child due, `done_ratio`/`estimated`/`remaining` derived from children (the `derived_*` fields). Parents are effectively read-only for dates when they have children.
5. Changing instance working days or a holiday triggers a reschedule job across affected work packages.

Build order: pure date math + working-days calendar first (P3-T10 for scheduling), then the graph propagation, then the reschedule job. Golden-master tests: capture inputs/outputs from documented the legacy system behavior and assert parity.

### 6.2 The OKR scoring engine

The strategy counterpart, mirroring the scheduling engine's discipline. Pure functions over an OKR graph, unit-tested with golden masters (P4-T04):

1. **KR progress** — direction-aware linear interpolation, capped at 100. `increase`: `(current-initial)/(target-initial)`; `decrease`: `(initial-current)/(initial-target)`; equal endpoints → 0. KPI-backed KRs read the KPI's latest achievement instead.
2. **Objective score** — weighted average of its KRs' capped progress, **including** the KRs of child objectives.
3. **Cascade** — recompute walks upward: KR → objective → parent KR → parent objective, with cycle detection.
4. **RAG** — from workspace thresholds (`rag_pass_pct`/`rag_fail_pct`).
5. **Status** — from confidence buckets (9–10 completed, 5–8 on track, 1–4 at risk, else not tracked).
6. **KPI achievement** — `actual/target*100`, direction-aware; calculated KPIs evaluate the `formula` expression tree with cross-frequency aggregation via the `aggregate` function.

A `recomputeOkr(graph, change)` entry point drives it; derived columns (`result_percentage`, `status`, `progress_percentage`) are updated by a job on write. Golden-master cases capture documented FlowyTeam behavior (weighted rollups, decrease-goal KRs, aligned cascades, calculated KPIs) so parity is asserted, not assumed.

## 7. Importer architecture (`packages/importer`)

A standalone CLI with a **source selector** (`--from`). Two sources are supported:

```
# Source 1 — the Rails project tool (PostgreSQL)
pnpm import:legacy --from openproject --source <PG_URL> --workspace <slug> [--source-schema public] [--dry-run] [--only projects,work_packages]

# Source 2 — FlowyTeam (MySQL, per-company)
pnpm import:legacy --from flowyteam --source <MYSQL_URL> --company <id> --workspace <slug> [--dry-run] [--only objectives,indicators,tasks]
```

### 7.1 Two sources, one target

The importer abstracts the source behind a reader interface so both a read-only **PostgreSQL** reader (source 1) and a read-only **MySQL** reader (source 2) feed the same mappers-and-loaders pipeline into one clean OpenOKR schema. Differences that the design must hold:

| Aspect | Source 1 (Rails tool) | Source 2 (FlowyTeam) |
|---|---|---|
| Engine | PostgreSQL | MySQL (needs a MySQL client — a new importer dependency, confirm with human) |
| Tenancy | one instance → one workspace | one DB holds **many companies**; `--company <id>` selects one → one workspace |
| Strengths imported | work packages, queries, gantt, wiki, meetings, time/cost | OKR, KPI, check-ins, tasks-as-work-packages (see §7.6 mapping) |
| `legacy_type` | `openproject` | `flowyteam` |

Both write `legacy_id` + `legacy_type` so their rows coexist in the same target tables with no id collisions. A workspace can be built from one source, the other, or both (e.g. work-management from source 1 + OKR from source 2). Each source has its own mapping table: source 1 in §7.4 below, source 2 in **§7.6 below**.

### 7.2 Cutover strategy (decided; source 1)

Source 2 (FlowyTeam) is always a cross-engine migration (MySQL → the new Postgres schema), so only mode A below applies to it: the importer streams over a connection and the FlowyTeam database is kept read-only as the rollback archive. The runbook steps (maintenance mode → backup → dry-run → import → reconcile → switch → rollback window) apply to both sources.

We do **not** run the new app on the legacy system's schema. That schema has no `workspace_id`/RLS, stores serialized Ruby YAML, and maintains temporal journals, nested sets, and derived rollups via Rails callbacks — inheriting it would keep the worst of the old system and break the security model in PLAN.md §6. Instead the new app always owns a clean schema, and we migrate data into it once.

Two supported source topologies, same mappers either way (the only difference is the source connection):

| Mode | Source | When | Rollback |
|---|---|---|---|
| **B — same instance, schema-to-schema (default, recommended)** | The legacy system tables live in one schema (e.g. `public`) of the same PostgreSQL database; the new app's clean schema lives in another schema of the **same** database. Migration is in-database SQL — no network export/import round-trip, fast, transactional. | The DB server stays; you want the lowest-risk, fastest cutover with a built-in safety net. | The old schema is untouched and kept read-only; if cutover fails, point DNS back at the legacy system. Drop the old schema only after a sign-off window. |
| **A — separate database** | The legacy DB and the new DB are different databases (or hosts). The importer streams over a connection. | A genuinely fresh database is wanted, or the source is a restored dump on another host. | Old database retained as an archive; re-run import if needed. |

Cutover runbook (both modes), executed in a maintenance window (the user has confirmed a window is acceptable):

1. Put the legacy system in maintenance / read-only.
2. Take a full backup of the source (belt and braces even in mode B).
3. Run `import:legacy --dry-run` and review `import-report.json` — counts, skips, lossy items.
4. Run the real import. It is idempotent (upsert on `(workspace_id, legacy_type, legacy_id)`), so a partial failure is safe to resume.
5. Run the reconciliation check (row counts old vs new per domain; spot-check a sample of records).
6. Switch traffic to the new app. Keep the old schema/database read-only for a defined rollback window, then archive or drop.

This keeps the "reuse the existing database" benefit (mode B: no data leaves the instance, instant rollback) without condemning the new app to the legacy schema.

### 7.3 Pipeline

1. **Connect read-only** to the source (`SET default_transaction_read_only = on`; in mode B, `SET search_path` to the legacy schema for reads). Never write to the source schema.
2. **Introspect** the source schema; assert required tables/columns exist; print a legacy system version guess.
3. **Extract → Map → Load** per domain, in the FK order in `reference/legacy-data-model.md` §10.
4. **ID assignment:** deterministically derive new UUIDv7s or keep a `(legacy_type, legacy_id) -> uuid` map table in the target so re-runs are idempotent (upsert on the unique index).
5. **Two-phase rich text:** load bodies verbatim, then a **reference-rewrite pass** remaps `##id`, `[[wiki]]`, mentions, and attachment refs to new ids.
6. **Report + reconcile:** write `import-report.json` — counts per table, skipped rows with reasons, lossy items (passwords reset, dropped filters, dead macros), and warnings. Run a **reconciliation pass** that compares source vs target row counts per domain and flags mismatches. `--dry-run` produces the report (and reconciliation projection) without writing.

### 7.4 Mapping table (source 1 → target)

This is the contract every schema task must keep current (source 2's equivalent is §7.6). One row per target table.

| Target table | legacy source | Notes / lossy |
|---|---|---|
| `workspaces` | (synthesised, one per instance) | admin picks slug |
| `users` | `users` where `type in (User,Group,PlaceholderUser)` | skip Anonymous/System/Deleted; recreate built-ins |
| `user_passwords` (Better Auth) | `user_passwords` | bcrypt in; others → force reset |
| `groups`/`group_members` | `groups`(users STI) / `group_users` | |
| `memberships` | `members` | direct rows |
| `membership_roles` | `member_roles` where `inherited_from is null` | recompute inheritance |
| `roles`/`role_permissions` | `roles`/`role_permissions` | STI `type`→`scope`; `builtin` code→enum |
| `projects` | `projects` | tree from `parent_id`; drop `lft`/`rgt` |
| `project_enabled_modules` | `enabled_modules` | filter to supported modules |
| `versions` | `versions` | status/sharing strings map directly |
| `categories` | `categories` | |
| `work_packages` | `work_packages` (+ backlogs `story_points`,`remaining_hours`) | derived_* recomputed |
| `work_package_versions` | `work_package_versions` (2026+), else synthesize `target` from `version_id` | detect source generation |
| `work_package_relations` | `relations` | `relation_type`+`lag` direct |
| `work_package_watchers` | `watchers` where watchable=WorkPackage | other watchables → per-type |
| `types`/`statuses`/`workflows`/`priorities` | `types`/`statuses`/`workflows`/`enumerations(IssuePriority)` | `attribute_groups` YAML→`form_config` json |
| `custom_fields`(+options/values/activations) | `custom_fields`/`custom_options`/`custom_values`/join tables | field_format map; multi=many rows |
| `queries`/`views` | `queries`/`views` | YAML filters→JSON DSL; unknown dropped+logged |
| `comments` | `journals` where `notes<>''` | notes only; author+time kept |
| `activities` | `journals` field diffs (P1) | simplified; not temporal |
| `notifications`/`notification_settings` | `notifications`/`notification_settings` | reason codes→enum |
| `time_entries`/`time_entry_activities` | `time_entries`/`enumerations(TimeEntryActivity)` | |
| `cost_types`/`cost_entries`/`rates` | `cost_types`/`cost_entries`/`rates`(STI) | |
| `budgets`/`budget_items` | `budgets`/`labor_budget_items`+`material_budget_items` | P2 |
| `wikis`/`wiki_pages` | `wikis`/`wiki_pages` (+ latest journal body) | tree from `parent_id` |
| `meetings`(+sections/items/participants) | `meetings`/`meeting_agenda_items`/`meeting_sections`/`meeting_participants` | structured meetings; classic minutes→body |
| `attachments` | `attachments` | copy bytes via FileStorage by `disk_filename` |
| `external_storages`/`project_storages`/`file_links` | `storages`/`project_storages`/`file_links` | P1/P2; OAuth tokens not imported (re-auth) |
| `boards`/`board_columns` | `grids`(Boards::Grid)/`grid_widgets` | column query id remapped |
| `dashboards`/`dashboard_widgets` | `grids`(MyPage/Overview)/`grid_widgets` | |
| `sprints` (backlogs) | 2026+: `sprints`/`sprint_goals`/`backlog_buckets`; pre-2026: versions + `version_settings` | detect source generation |
| `favorites` | `favorites` | polymorphic star on projects/queries |
| project phases + gates (P3-T33) | `project_phases`/`project_phase_definitions` (incl. `start_gate`/`finish_gate` + names) | only if the phases module is built; else log-and-skip |
| `github_links`/`gitlab_links` | `github_*`/`gitlab_*` | P1 |
| **not imported** | repositories/changesets, BIM, custom_actions, jira*, good_jobs, sessions, oauth tokens, webhook logs, paper_trail_audits | see data-model §10 |

### 7.5 Importer testing

- Unit test each mapper with hand-built source rows.
- Integration test against **seeded source databases** stood up in CI: source 1 from the official legacy Docker image with demo data; source 2 from a seeded FlowyTeam MySQL schema (multi-company, so `--company` selection is exercised). Run the importer; assert counts and spot-check records.
- Idempotency test per source: run twice, assert no duplicates and identical target state.
- Mixed-source test: import both sources into one workspace; assert no id collisions across `legacy_type`s.

### 7.6 Mapping table (source 2, FlowyTeam → target)

The contract every Phase 4 schema/importer task keeps current (the FlowyTeam half of §7.4). One row per target table. FK order and lossy notes are in `reference/flowyteam-okr-kpi-tasks-model.md` §11.

| Target table | FlowyTeam source | Notes / lossy |
|---|---|---|
| `org_units` | `teams` | rebuild tree from `parent_id`; drop `_lft`/`_rgt`; `kind` from usage (team vs department) |
| `org_unit_members` | `other_departments` (+ `teams.leader_id`) | active pivot; `employee_teams` is secondary |
| `okr_cycles` | `performance_cycles` | `cycle_type`→`cadence`; regenerate future cycles in target |
| `performance_settings` | `performance_settings` | thresholds + labels; edit matrix → RBAC (§4.12.8), not booleans |
| `objectives` | `objectives` | owner from `model_type` (not `objective_type`); two-pass `objective_parent_id`; recompute `result_percentage`/`status` |
| `key_results` | `key_results` | `bigint`→`numeric`; `metric_direction` inferred from initial vs target; `task_id`→`work_package_id` |
| `key_result_values` | `key_result_records` + KR check-in value snapshots | recompute % |
| `kpi_categories` | `indicator_types` | ignore non-existent `status`/`description` |
| `kpi` | `indicators` | owner from `model_type`; `occurance`→`frequency`; tree via `indicator_parent_id`; thresholds direct |
| `kpi_records` | `indicator_records` | normalize `period_key`→`period_start`; add unique `(workspace_id, kpi_id, period_start)` |
| `kpi_dependencies` | `indicator_calculates` | formula edges |
| `kpi.formula` | `indicators.calculated_value` (token string) | translate to expression tree; unparseable → dropped + logged |
| `key_result_kpis` | `keyresult_indicator` | KR↔KPI pivot |
| `kpi_shares` | `indicator_accesses` | `view_options`→`scope`; per-user frequency is a client pref in v1 |
| `check_in_sessions` | `checkins` | mood/feeling + submitted/reviewed |
| `check_ins` | `objective_checkins` + `key_result_checkins` | one polymorphic table; `category` enum direct |
| `check_in_reviews` | `checkin_reviews` | |
| `comments` (subject=objective/key_result) | `objective_discussions` / `keyresult_discussions` | HTML→Markdown; two-phase ref rewrite |
| `performance_snapshots` | `performance_records` | recompute; never trust source values |
| `scorecard_settings` / `score_entries` | `reward_settings` / `scores` | **points off by default**; import only if funded |
| `work_packages` (+ link cols) | `tasks` | state from `board_column_id` slug; `key_results_id`→`key_result_id` (+derived `objective_id`); two-pass `dependent_task_id`/`recurring_task_id` |
| `checklist_items` | `sub_tasks` | lightweight, no rollup; `complete`→`done` |
| `statuses` / board columns | `taskboard_columns` | `is_closed` only where slug=`completed`; custom columns preserved |
| `categories` | `task_category` | |
| `work_package_watchers` | `tasks_accesses` | |
| `attachments` / `file_links` | `task_files` / `key_result_files` | copy local bytes; external (Drive/Dropbox/URL) → `file_links` |
| `time_entries` | `project_time_logs` | task-linked logs |
| **not imported** | data-source sync state, resthook queues, universal-search cache, notification rows, `planning_*` links, reviews/rewards unless funded | see reference §11 |

## 8. Security design (must beat the legacy tool, not just match it)

The legacy system's security is mature but bolted on over 20 years. OpenOKR gets these by construction:

### 8.1 Layered authorization (defense in depth)

| Layer | Mechanism | Fails how |
|---|---|---|
| 1. Database | RLS: `USING (workspace_id = current_setting('app.workspace_id')::uuid)` on every business table; GUC set by a request-scoped Drizzle wrapper; never from client input | cross-tenant reads impossible even with an app bug |
| 2. Domain | `can(user, permission, context)` in `packages/core`; tRPC `authz` middleware; deny by default | forgotten check = denied, not allowed |
| 3. UI | hides what layer 2 denies | cosmetic only, never load-bearing |

A CI check greps migrations: any `CREATE TABLE` without a matching RLS policy in the same file fails the build.

### 8.2 Control checklist (each maps to a task)

| Control | Detail | Task |
|---|---|---|
| Session security | Better Auth; httpOnly+SameSite cookies; session list + remote revoke UI ("sign out other devices") | P2-T12 |
| Brute force | account lockout with backoff after N failures; audit event on lockout | P2-T12 |
| MFA | TOTP + WebAuthn passkeys + backup codes | P7-T04 (scaffold earlier) |
| Rate limiting | per-IP and per-user via Cache adapter on auth, API, exports, webhooks | P2-T12 |
| Headers | strict CSP (nonce-based, no `unsafe-inline`), HSTS, X-Frame-Options DENY, Referrer-Policy | P2-T12 |
| Input validation | Zod on every route/webhook/env/upload; file-type allowlist + size caps; images re-encoded | P2-T05, all |
| SSRF | outbound webhook/integration URLs validated: no private IP ranges, no redirects to private ranges, DNS-pinning | P3-T29 |
| Webhook auth | inbound: HMAC signature verification; outbound: signed payloads with per-hook secret | P3-T29 |
| Upload safety | signed URLs with expiry; content-disposition attachment; separate cookie-less media host documented; optional ClamAV port | P2-T05 |
| Secrets | env only, Zod-validated; startup refuses default/placeholder secrets in production; never logged | P1-T02 |
| Audit | append-only `audit_events` for auth, RBAC, membership, deletion, export, import, settings changes; DB grants forbid UPDATE/DELETE | P2-T03 |
| API tokens | scoped personal access tokens (read-only / read-write / admin scopes), last-used tracking, expiry | P4-T19 (REST) |
| Supply chain | Dependabot, CodeQL, pinned lockfile, signed images (cosign), SBOM per release | P1-T02, P6-T05 |
| Privacy | PDPA/GDPR: user data export + account erasure job (reassign to a tombstone principal like the legacy system's DeletedUser); PII minimization in logs | P6-T05 |
| AI tool authorization | copilot/MCP actions run `can()` + RLS as the acting user; deny by default; write/admin token scopes (AI-NATIVE-PLAN.md §8) | P5-T06, P5-T09 |
| AI key handling | provider keys envelope-encrypted, never logged, decrypted server-side only; per-user bring-your-own isolation | P5-T02 |
| AI egress & injection | admin-controlled context, PII redaction, egress allow-list, base-URL SSRF checks; retrieved content treated as untrusted data | P5-T02, P5-T10 |
| AI cost/abuse | token/cost/call quotas + hard caps + per-token rate limits; usage audited | P5-T04 |

### 8.3 Explicit improvements over the legacy system

- RLS tenant isolation at the database (the legacy system has none; isolation is app-code only).
- Passkeys first-class (the legacy system: password + optional 2FA module).
- Scoped API tokens (the legacy system: one all-powerful API key per user).
- Session management UI for end users (the legacy system: admin-only session config).
- Nonce-based CSP from day one (the legacy system retrofitted CSP consolidation in 2025).

## 9. Search

Postgres full-text search via the Search port. A `search_documents` table (or per-entity `tsvector` generated columns) indexed with GIN; background job reindexes on write. Attachment text extraction is P2. Works identically in both runtime profiles (no external search service), satisfying the air-gap requirement.

## 10. Testing strategy

- **Unit** (Vitest): domain services, scheduling engine (golden-master), OKR scoring engine (golden-master, §6.2), permission matrix, query-DSL translation, every importer mapper.
- **Integration** (Vitest + real Postgres): RLS isolation, migrations, tRPC procedures, importers against seeded source databases (PostgreSQL for source 1, MySQL for source 2).
- **E2E** (Playwright): one happy path per P0 feature, run under both runtime profiles in CI.
- **Parity checks:** scheduling and query-filter behavior asserted against documented the legacy system outputs.

## 11. Licensing note

The legacy system is GPLv3. This is a clean-room build: we do **not** copy legacy source code. We may read its database (data, not code) and reproduce observable behavior. The reference docs in this repo describe schema and behavior in our own words. New code is licensed per PLAN.md §3 (AGPL-3.0 + CLA, pending human sign-off). If any legacy source is ever pasted in, that is a licensing incident — do not do it.

## 12. Open technical decisions (ask the human)

**Decided (2026-07):** cutover strategy — one-time migration into a clean schema, **not** running on the legacy schema; a maintenance window is acceptable; default topology for source 1 is **mode B (schema-to-schema in the same PostgreSQL instance)** with the old schema kept read-only for rollback; mode A (separate database) also supported and is the only mode for source 2. See §7.2.

**Decided (2026-07), OKR/KPI/Tasks:** (1) OKR, KPI, and check-ins are **core P0/P1** (Phase 4), not a deferred stub. (2) FlowyTeam **tasks unify into `work_packages`** with OKR/KPI link columns, not a parallel table. (3) A **second importer source** (FlowyTeam, MySQL, per-company) ships alongside source 1; the MySQL client is the one pre-approved importer dependency. See §7.6 and §4.12.

| # | Decision | Lean |
|---|---|---|
| T1 | Custom field value storage: single `value text` vs typed sidecar columns | typed sidecar for filterability |
| T2 | Journal history import depth | current state + comments (P0), simplified activity feed (P1) |
| T3 | Project tree: `parent_id`+recursive CTE vs closure table vs ltree | closure table for read speed at scale |
| T4 | REST `/api/v3` compatibility shim | no; clean new API + migration guide |
| T5 | Which modules are funded for v1 (costs? backlogs? meetings?) | core P0 first; confirm P1 funding |
| T6 | Better Auth password-hash import feasibility for bcrypt | verify; fallback = forced reset |
| T7 | Multi-version WP links (`target`/`observed_in`) in v1 UI | store the join losslessly; UI exposes single target version until a product need appears |

## 13. Performance engineering (budgets are requirements, not hopes)

The legacy system's biggest UX complaint is heaviness: full Angular boot per page, slow tables on big projects, uncached list rendering. OpenOKR sets hard budgets and the techniques to meet them. P6-T01 turns these into CI checks; every list-view task cites them.

### 13.1 Budgets (measured on the P6-T01 large dataset: 50k WPs in a project, 1M in the workspace)

| Surface | Budget |
|---|---|
| WP table first paint (100 rows visible) | < 1.0 s server render, < 2.0 s interactive |
| WP table scroll | 60 fps via virtualization; no row-count cliff up to 10k loaded rows |
| WP detail open from table (split view) | < 300 ms perceived (optimistic + cached) |
| Board render (10 columns × 50 cards) | < 1.5 s |
| Gantt initial render (1k bars) | < 2.0 s |
| Global search suggestions | < 300 ms p95 |
| Save actions (comment, field edit) | optimistic: UI instant; server ack < 500 ms p95 |
| Core Web Vitals (marketing + app shell) | LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on mid-range hardware |

### 13.2 Techniques (mandatory patterns)

- **Server Components + streaming** for first paint; client hydration only where interactive.
- **Keyset pagination** everywhere (never OFFSET beyond page ~10); cursors in the query DSL.
- **Virtualized tables/boards** (TanStack Virtual) — render what's visible.
- **N+1 protection:** list endpoints load relations via single set-based queries; a dev-mode query counter fails tests that exceed a per-request query budget (e.g. > 15 queries on a list view).
- **Indexes with the feature:** every filterable/sortable column ships its index in the same migration; composite indexes for (workspace_id, project_id, common-filter) patterns; the query DSL only exposes indexed fields as default filters.
- **Rollup strategy:** derived values (parent dates/progress, version totals) are computed by the scheduling engine and stored in derived columns, invalidated by job — never computed per-row at render time.
- **Caching:** TanStack Query on the client (stale-while-revalidate); per-workspace server cache via the Cache port for hot config (types, statuses, custom field definitions, permissions snapshot).
- **Realtime instead of polling:** lists subscribe to entity channels; legacy-style refresh polling is not allowed.
- **Connection pooling:** document pgbouncer/Supavisor for serverless; Drizzle uses a pooled client.

## 14. API conventions (tRPC + REST)

- **tRPC routers** mirror modules: `workPackages.list/get/create/update/delete/bulkUpdate`, `queries.*`, `projects.*`, etc. Procedures take Zod inputs; errors use a typed error enum (`FORBIDDEN`, `NOT_FOUND`, `CONFLICT` for lock_version, `VALIDATION`).
- **Optimistic concurrency:** every update carries `lockVersion`; mismatch returns `CONFLICT` and the client refetches + reapplies (PLAN.md §7 rule).
- **REST `/api/rest/v1`** for integrations: JSON (not HAL), cursor pagination (`?cursor=&limit=`), the same filter grammar as the query DSL in a `filters` param, OpenAPI spec generated from Zod schemas, scoped bearer tokens. Webhooks deliver the same resource shapes.
- **Form-validation endpoints** (the one APIv3 idea worth keeping): `POST /work-packages/validate` returns field-level errors + computed defaults without committing, powering rich client forms.
- **Deprecation policy:** REST v1 is stable; breaking changes require v2 side-by-side.

## 15. Where the new app must beat the legacy tool (scorecard)

OpenOKR's reason to exist. Each row is verified by a phase-exit review; "same as the legacy tool" on any row is a failure except where marked parity.

| Dimension | The legacy system today | New app target | Where |
|---|---|---|---|
| First load | Angular boot, seconds | RSC streaming, < 2.5 s LCP | §13, UIUX-PLAN |
| Table scale | slows past a few thousand rows | virtualized, 50k WP project usable | P3-T08, P6-T01 |
| Editing | modal/full-form heavy | inline edit everywhere, optimistic, undo toasts | UIUX-PLAN §5 |
| Realtime | reload/poll | live lists, presence, notification badge push | P2-T06, P3-T13 |
| Navigation | deep menus, page reloads | command palette (⌘K), favorites, instant client transitions | P3-T31/T32 |
| Mobile | barely responsive | fully responsive shell, touch drag on boards | UIUX-PLAN §4 |
| Tenant isolation | app-code only | Postgres RLS enforced | §8 |
| API tokens | one global key | scoped tokens + session UI | §8.2 |
| Setup | complex installer | < 30 min all tiers, seeded demo | P0, P5 |
| Accessibility | partial | WCAG 2.1 AA audited | P6-T06 |
| i18n | 50 locales, server-rendered mix | en + ms at launch, ICU pipeline, locale-complete UI | UIUX-PLAN §9 |
| AI | bolted-on MCP (enterprise), single hardcoded provider | AI-native: assists in every module, an in-app copilot that acts within the user's permissions, and an **MCP server** for any agent; multi-provider + bring-your-own-key + local models; on where configured, air-gap safe, never on a required path | AI-NATIVE-PLAN.md |
| Methodology support | PM²/PMflex via phases+gates+wizard (enterprise), OKR docs-pattern only, SAFe via sprint sharing (enterprise), no PRINCE2 content | same enablers open where funded + native OKR module + seeded template gallery for PM²/PMflex/PRINCE2/SAFe/Scrum/OKR | P3-T28/T33, P7-T07, P8-T06 |
| Parity risks (must not regress) | mature scheduling, workflows, custom fields, importable history | golden-master parity tests | P3-T10, P3-T30 |
