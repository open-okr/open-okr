# legacy data model reference

Ground truth for the data importer. This describes the **source** schema (the legacy system, Rails ~8.0, PostgreSQL) that `packages/importer` reads. This repo has no access to the legacy system's codebase, so this file is the authority.

Extracted from `db/migrate/tables/*.rb` (99 core table definitions) and `modules/*/app/models` on the `dev` branch, July 2026. Column lists below are the load-bearing columns, not every column. Before writing importer code, always cross-check against a real `pg_dump --schema-only` of the target instance (see section 10). The legacy system versions differ; the dump is authoritative for a given customer.

---

## 1. How to read the source schema reliably

Do not reconstruct the schema from Rails migrations. The legacy system squashes old migrations into `db/migrate/1000016_aggregated_migrations.rb` plus per-table files under `db/migrate/tables/`, and modules add more. The only reliable schema for a given instance is a dump of that instance's database:

```bash
pg_dump --schema-only --no-owner --no-privileges "$LEGACY_DATABASE_URL" > legacy-schema.sql
```

The importer is written against this dump. This reference tells you what each table means so you can write the mapping; the dump tells you the exact columns that instance has.

Conventions in the legacy system:

- **STI** (single table inheritance): a `type` string column selects the Ruby subclass. Tables affected: `users`, `roles`, `enumerations`, `custom_fields`, `rates` (costs), `grids`, `tokens`, `relations` (via `relation_type`).
- **Serialized columns**: several `text` columns hold YAML (Ruby `Psych`) or, newer, JSON. The big ones are `queries.filters`, `queries.column_names`, `queries.sort_criteria`, `types.attribute_groups`, `user_preferences.settings`, `settings.value`. The importer must parse YAML. Prefer a YAML-safe-load with the known Ruby class tags mapped, or transform via a small Ruby helper that reads and re-emits JSON.
- **Polymorphic refs**: `*_type` + `*_id` pairs (for example `journals.journable_type`/`journable_id`, `custom_values.customized_type`/`customized_id`, `attachments.container_type`/`container_id`, `watchers.watchable_type`/`watchable_id`).
- **Trees**: `projects` uses a nested set (`lft`/`rgt`) plus `parent_id`. `work_packages` uses a separate closure table `work_package_hierarchies`. Wiki pages and custom field hierarchies use `parent_id` / `hierarchical_item_hierarchies`.
- **Timestamps** are often `precision: nil` (second precision) and nullable on old rows.

---

## 2. Domain map (all tables, grouped)

Tables the importer **skips** are marked SKIP. These are caches, runtime state, or things the new system regenerates.

| Domain | Tables |
|---|---|
| Work packages | `work_packages`, `work_package_hierarchies` (closure), `relations`, `categories`, `watchers`, `ordered_work_packages`, `work_package_versions` (kind: target/observed_in, 2026), `work_package_journals` |
| Types & workflow | `types`, `statuses`, `workflows`, `enumerations` (priorities, activities, doc categories) |
| Projects | `projects`, `enabled_modules`, `projects_types`, `project_phases`, `project_phase_definitions`, `subproject_template_assignments`, `favorites` (polymorphic user favorites) |
| Versions | `versions`, `work_package_versions` |
| Custom fields | `custom_fields`, `custom_values`, `custom_options`, `custom_fields_projects`, `custom_fields_types`, `custom_fields_roles`, `custom_field_sections`, `project_custom_field_project_mappings`, `project_custom_field_type_mappings`, `hierarchical_items`, `hierarchical_item_hierarchies` |
| Principals & RBAC | `users`, `user_passwords`, `group_users`, `group_details`, `members`, `member_roles`, `roles`, `role_permissions`, `user_preferences`, `user_working_hours`, `user_non_working_times`, `service_accounts`, `service_account_associations` |
| Journals (history) | `journals`, `work_package_journals`, `project_journals`, `wiki_page_journals`, `message_journals`, `news_journals`, `changeset_journals`, `attachable_journals`, `attachment_journals`, `customizable_journals`, `custom_comment_journals`, `document_journals`, `budget_journals`, `meeting_journals`, `meeting_content_journals` (classic meetings), `meeting_agenda_item_journals`, `meeting_participant_journals`, `time_entry_journals`, `resource_allocation_journals`, `project_phase_journals` |
| Queries & views | `queries`, `views`, `project_queries`, `project_query_roles`, `user_queries`, `persisted_queries`, `persisted_views`, `ordered_persisted_query_entities` |
| Notifications | `notifications`, `notification_settings`, `reminders`, `reminder_notifications`, `emoji_reactions` |
| Attachments | `attachments`, `attachment_journals`, `attachable_journals` |
| Time & cost | `time_entries`, `time_entry_journals`, `enumerations` (TimeEntryActivity), `time_entry_activities_projects`, `cost_entries`, `cost_types`, `cost_types_projects`, `rates` (HourlyRate/DefaultHourlyRate/CostRate) |
| Budgets | `budgets`, `labor_budget_items`, `material_budget_items`, `budget_journals` |
| Boards & grids | `grids` (STI: Boards::Grid, MyPage, Overview), `grid_widgets` (start/end row+column, `identifier`, `options` text) |
| Backlogs | `sprints` (standalone table since 2026: name, status `in_planning`/..., start_date, finish_date, sharing, project_id), `sprint_goals`, `backlog_buckets`, `version_settings` (legacy, pre-2026 installs treated versions as sprints) |
| Wiki | `wikis`, `wiki_pages`, `wiki_page_journals`, `wiki_redirects`, `wiki_page_links`, `menu_items` (wiki menu) |
| Forums & news | `forums`, `messages`, `message_journals`, `news`, `news_journals`, `comments` |
| Documents | `documents`, `document_journals`, `enumerations` (DocumentCategory), `document_types` |
| Meetings | `meetings`, `meeting_agenda_items`, `meeting_sections`, `meeting_participants`, `meeting_outcomes`, `recurring_meetings`, `scheduled_meetings`, `recurring_meeting_interim_responses`, + meeting journals |
| Storages | `storages`, `project_storages`, `file_links`, `last_project_folders`, `remote_identities`, `oauth_clients`, `oauth_client_tokens` |
| Auth & tokens | `tokens` (STI), `sessions`, `ldap_auth_sources`, `auth_providers`, `plugin_auth_providers`, `user_auth_provider_links`, 2FA `devices`, oidc `providers`/`user_session_links`/`group_links`/`group_memberships`, saml providers, `oauth_applications`, `oauth_access_grants`, `oauth_access_tokens`, `scim_clients`, `autologin_session_links` |
| Integrations | `github_pull_requests`, `github_check_runs`, `github_users`, `gitlab_merge_requests`, `gitlab_issues`, `gitlab_pipelines`, `gitlab_users`, `webhooks_webhooks`, `webhooks_events`, `webhooks_logs` |
| BIM | `ifc_models`, `bcf_issues`, `bcf_viewpoints`, `bcf_comments` |
| Repositories (SCM) | `repositories`, `changesets`, `changes`, `changesets_work_packages` |
| Enterprise & admin | `enterprise_tokens`, `announcements`, `colors`, `design_colors`, `custom_styles`, `settings`, `custom_actions` (+ join tables), `attribute_help_texts`, `backups`, `exports` (STI stub) + `export_settings`, `health_reports` |
| Newer niche (import log-and-skip unless needed) | `custom_comments` + `custom_comment_journals` (per-custom-field comments on a customized object), `hierarchical_items` + `hierarchical_item_hierarchies` (hierarchy CF trees — needed if hierarchy CFs are used), `resource_allocations` + `resource_allocation_journals` (resource_management module), `project_phases` + `project_phase_definitions` (import as P1 if used) |
| Runtime (SKIP) | `good_jobs`, `good_job_batches`, `good_job_executions`, `good_job_processes`, `good_job_settings`, `sessions`, `friendly_id_slugs`, `paper_trail_audits`, all `oauth_access_*` and `*_tokens`, `mcp_configurations`, `jira*` (staging tables of the legacy system's own built-in Jira importer), `calculated_value_errors`, `work_package_semantic_aliases` |

---

## 3. Work packages (core)

### `work_packages`

| Column | Meaning / import note |
|---|---|
| `type_id` | FK `types`. Required. |
| `project_id` | FK `projects`. Required. |
| `subject`, `description` | Description is CKEditor Markdown (the legacy system dialect, see section 9). |
| `start_date`, `due_date`, `duration` | Check constraint `due_date >= start_date`. Duration in days. |
| `category_id` | FK `categories` (project-scoped). |
| `status_id` | FK `statuses`. Required. |
| `assigned_to_id`, `responsible_id` | FK `users`/`groups` (principals). |
| `priority_id` | FK `enumerations` (IssuePriority). |
| `version_id` | FK `versions`. Legacy single-version link; see `work_package_versions` below for the 2026 multi-version join. |
| `author_id` | FK `users`. Required. |
| `lock_version` | Optimistic lock counter. Maps to the new `version` column concept, not to journal version. |
| `done_ratio`, `derived_done_ratio` | % complete. `derived_*` is rolled up from children; do not import derived values, recompute them. |
| `estimated_hours`, `derived_estimated_hours`, `derived_remaining_hours` | Same: import the non-derived, recompute derived. |
| `schedule_manually` | Boolean. Manual vs automatic scheduling. Default true on new rows. |
| `parent_id` | FK self. Also mirrored in `work_package_hierarchies`. |
| `ignore_non_working_days` | Boolean. |
| `project_phase_id` | FK `project_phases` (newer feature). |

Backlogs adds `story_points` (integer) and `remaining_hours` (float) columns to this table (and to `work_package_journals`) when the module is enabled.

### `work_package_versions` (2026 multi-version join)

`work_package_id`, `version_id`, `kind` — a PostgreSQL enum `work_package_version_kind` with values `target` and `observed_in`. Unique on `(work_package_id, version_id, kind)`. The roadmap and versions pages now read `target` rows (`Version#targeted_work_packages`); `observed_in` supports "found in version" tracking. The legacy `work_packages.version_id` still exists in parallel. Importer: read both; on instances that predate this table, only `version_id` exists.

### `work_package_hierarchies` (closure table)

Columns `ancestor_id`, `descendant_id`, `generations`. Rebuild this from `parent_id` after import rather than copying rows.

### `relations`

`from_id`, `to_id`, `relation_type` (`relates`, `duplicates`, `blocks`, `precedes`/`follows`, `includes`, `requires`, `partof`), `lag` (integer days, for precedes/follows scheduling), `description`. Cycles are prevented by the app, not the DB.

### `categories`

Project-scoped work package categories with an optional `assigned_to_id` default assignee.

### `watchers`

Polymorphic (`watchable_type`/`watchable_id`) + `user_id`. Watchable types: WorkPackage, WikiPage, Message, News, Forum, Budget.

---

## 4. Types, statuses, workflow, enumerations

### `types`

`name`, `position`, `is_milestone`, `is_in_roadmap`, `is_default`, `is_standard`, `color_id`, `attribute_groups` (serialized YAML: the form configuration — which fields show in which groups, enterprise `edit_attribute_groups`), `patterns` (subject generation templates, enterprise), `pdf_export_templates_config` (jsonb).

### `statuses`

`name`, `is_closed`, `is_default`, `position`, `default_done_ratio`, `is_readonly` (enterprise), `excluded_from_totals`, `color_id`.

### `workflows`

The per-`type` per-`role` state machine. Columns: `type_id`, `old_status_id`, `new_status_id`, `role_id`, `author` (bool: only author may transition), `assignee` (bool: only assignee may transition). One row per allowed transition. This is large and load-bearing; import faithfully.

### `enumerations` (STI on `type`)

Subtypes: `IssuePriority`, `TimeEntryActivity`, `DocumentCategory`, `Enumeration::ReactionType` (varies by version). Columns: `name`, `position`, `is_default`, `active`, `project_id` (activities/priorities may be project-overridable via `parent_id`), `color_id`.

---

## 5. Projects and versions

### `projects`

Nested set: `lft`, `rgt`, plus `parent_id`. Also: `name`, `identifier` (unique, URL slug, lowercased index), `description`, `public`, `active` (archived = false), `templated` (is a template), `status_code` (project status enum), `status_explanation`, `settings` (jsonb). Deleting a project cascades to work packages, wikis, etc.

### `enabled_modules`

`project_id`, `name` (module string, e.g. `work_package_tracking`, `wiki`, `boards`, `costs`). Controls which modules appear in a project. Import maps to per-workspace/per-project feature flags.

### `versions`

`project_id`, `name`, `description`, `status` (`open`/`locked`/`closed`), `sharing` (`none`/`descendants`/`hierarchy`/`tree`/`system`), `effective_date` (due), `start_date`, `wiki_page_title`. Work packages link to versions two ways: legacy `work_packages.version_id` and the 2026 `work_package_versions` join (`kind` = `target`/`observed_in`). Backlogs: pre-2026 installs treated a version as a sprint (`version_settings`); since 2026 sprints are a standalone `sprints` table (see §2 Backlogs row) and are no longer versions.

### `project_phases` / `project_phase_definitions`

Newer stage/gate life-cycle feature (built for PM²/PMflex; see feature inventory). `project_phase_definitions` are workspace-level: `name`, `position`, `color_id`, and gates — `start_gate` (bool), `start_gate_name`, `finish_gate` (bool), `finish_gate_name`. `project_phases` are per-project instances: `project_id`, `definition_id`, `start_date`, `finish_date`, `active`. Journalized (`project_phase_journals`). Work packages carry `project_phase_id`. Gates surface as project-list filter columns (`ProjectPhaseGateFilter`) and meetings/WPs can reference gates.

---

## 6. Custom fields

### `custom_fields` (STI on `type`)

Subtypes name the customized entity: `WorkPackageCustomField`, `ProjectCustomField`, `UserCustomField`, `GroupCustomField`, `VersionCustomField`, `TimeEntryCustomField`. Columns: `field_format` (see below), `regexp`, `min_length`, `max_length`, `is_required`, `is_for_all`, `is_filter`, `searchable`, `editable`, `admin_only`, `multi_value`, `default_value`, `name`, `custom_field_section_id`, `content_right_to_left`, `allow_non_open_versions`.

**`field_format` values and where the value lives:**

| `field_format` | Value storage |
|---|---|
| `string`, `text` | `custom_values.value` (text) |
| `int`, `float` | `custom_values.value` (numeric string) |
| `date` | `custom_values.value` (ISO date string) |
| `bool` | `custom_values.value` (`"1"`/`"0"`) |
| `list` | `custom_values.value` = `custom_options.id`; options in `custom_options` |
| `list` + `multi_value` | one `custom_values` row per selected option id |
| `user`, `version` | `custom_values.value` = principal/version id |
| `link` (URL) | `custom_values.value` = URL string |
| `hierarchy` | `custom_values.value` = `hierarchical_items.id` (enterprise `custom_field_hierarchies`) |
| `weighted_item_list` | enterprise `weighted_item_lists` (newer; scored option lists) — log-and-skip unless used |
| `calculated_value` | enterprise `calculated_values` (formula fields; errors land in `calculated_value_errors`) — values are derived: import the formula config only, recompute |
| `empty` | internal fallback formatter, never user-created |

The authoritative format registry is `config/initializers/custom_field_format.rb`; per-format storage strategies live in `CustomValue::*Strategy` classes. Also note `custom_comments`: per-custom-field comment threads on a customized object (newer feature, journaled via `custom_comment_journals`).

### `custom_values`

Polymorphic: `customized_type` + `customized_id`, `custom_field_id`, `value` (text). Multi-value = multiple rows.

### `custom_options`

`custom_field_id`, `value`, `position`, `default_value`. For list fields.

### Activation join tables

- `custom_fields_projects`: which projects a WP custom field is active in (unless `is_for_all`).
- `custom_fields_types`: which work package types a WP custom field applies to.
- `custom_fields_roles`: visibility restriction to roles.
- `project_custom_field_project_mappings`: which projects a ProjectCustomField (project attribute) is enabled in.
- `custom_field_sections` / `project_custom_field_sections`: grouping of custom fields into named sections.

---

## 7. Principals and RBAC

### `users` (STI on `type`)

Subtypes: `User`, `Group`, `PlaceholderUser`, `AnonymousUser`, `SystemUser`, `DeletedUser`. Columns include `login`, `firstname`, `lastname`, `mail`, `admin`, `status` (1 active, 2 registered, 3 locked, 4 invited — numeric), `language`, `identity_url` (SSO), `failed_login_count`, `last_login_on`, timestamps. Import only real `User`, `Group`, `PlaceholderUser`; synthesize the built-in Anonymous/System/Deleted principals in the new system rather than copying them.

### `user_passwords`

`user_id`, `type`, `hashed_password`, `salt`, `created_at`. Current hashing is bcrypt (`Bcrypt` type). Legacy instances may carry salted SHA1 (`Sha1`) rows. Better Auth cannot import bcrypt-of-unknown-cost silently, so the plan is: import the hash where the algorithm is supported, otherwise force a password reset on first login (see importer notes).

### `groups` and `group_users`

`group_users` (`group_id`, `user_id`) is the membership join. Group roles propagate to members via `member_roles.inherited_from`.

### `members` / `member_roles` / `roles` / `role_permissions`

- `members`: `user_id` (principal), `project_id`, polymorphic `entity` (`entity_type`/`entity_id`) for work-package sharing memberships (entity = the shared WP). A member with a null project_id + an entity can represent a shared object membership.
- `member_roles`: `member_id`, `role_id`, `inherited_from` (the member_role id this was inherited from, for group-granted roles). **Critical**: inherited rows are regenerated, not authored. Import the direct rows; recompute inheritance.
- `roles` (STI on `type`): `ProjectRole`, `GlobalRole`, `WorkPackageRole`. `builtin` column: 0 normal, 1 non-member, 2 anonymous. `position`.
- `role_permissions`: `role_id`, `permission` (string). One row per granted permission. See `legacy-feature-inventory.md` for the full 151-permission catalogue.

### `user_preferences`

`user_id`, `settings` (serialized YAML hash: time zone, warn on leaving unsaved, comments sorting, notification prefs mirror, etc.).

### Working time

`user_working_hours` (per-day hours), `user_non_working_times` (personal days off). Instance-wide working days live in `settings` + `non_working_days`.

---

## 8. Journals (history) — the trickiest subsystem

The legacy system's `acts_as_journalized` gives every journaled record an append-only version history. Applied to: WorkPackage, Project, WikiPage, Message, News, Changeset, TimeEntry, Budget, Document, Meeting, MeetingAgendaItem, ProjectPhase, ResourceAllocation.

### `journals`

| Column | Meaning |
|---|---|
| `journable_type` / `journable_id` | The record this journal belongs to (polymorphic). |
| `version` | 1-based sequence per journable. |
| `user_id` | Who made the change. |
| `notes` | The comment/annotation attached to this version (empty for pure field changes). This is where **work package comments** live. |
| `data_type` / `data_id` | Points at the per-type snapshot row (e.g. `work_package_journals`). |
| `cause` | jsonb: why the change happened (e.g. system reschedule, status change of related WP). |
| `validity_period` | `tstzrange`: temporal validity of this version. Exclusion constraint prevents overlaps per journable. |
| `restricted` | Boolean: internal comment (enterprise `internal_comments`). |

### Per-type data tables (`*_journals`)

Each holds a **full snapshot** of the journable's columns at that version. E.g. `work_package_journals` has subject, status_id, etc. as of that version. Plus:

- `customizable_journals`: snapshot of custom field values per journal version.
- `attachable_journals`: snapshot of attachments present per journal version.

### Import strategy for journals

Importing full history is expensive and the temporal constraints are strict. Recommended tiering (decide per customer):

1. **P0**: import the *current* state of every record (the latest journal snapshot = the live row) and import **journal notes** (comments) with author + timestamp, since users care about the comment thread.
2. **P1**: import the field-change history as a simplified activity feed (from/to per field), not as a byte-perfect journal with validity ranges.
3. Do **not** attempt to reproduce `validity_period` exclusion constraints on import; let the new system own its own history going forward.

`emoji_reactions` (polymorphic on journals/comments) carry reactions on comments.

## 8.1 Verified columns: notifications, tokens, attachments, queries

### `notifications`

`recipient_id`, `actor_id`, `resource_type`/`resource_id` (polymorphic), `journal_id`, `subject` (text), `reason` (integer enum — the value map lives in `app/models/notification.rb`; read it from the source instance's code version when importing), `read_ian` (in-app read flag), `mail_reminder_sent`, `mail_alert_sent`.

### `notification_settings`

One row per user per scope (`project_id` NULL = global defaults). Per-event booleans: `watched`, `mentioned`, `assignee`, `responsible`, `shared`, `work_package_commented`, `work_package_created`, `work_package_processed`, `work_package_prioritized`, `work_package_scheduled`, `news_added`, `news_commented`, `document_added`, `forum_messages`, `wiki_page_added`, `wiki_page_updated`, `membership_added`, `membership_updated`. Date alerts as integer day-offsets: `start_date`, `due_date`, `overdue`.

### `tokens` (STI)

Observed subclasses in `app/models/token/`: `API`, `AutoLogin`, `Backup`, `Ical`, `Invitation`, `Recovery`, `RSS` (plus `HashedToken`/`ExpirableToken` base classes). **Do not import tokens** — they are secrets; users regenerate them in the new system. Pending invitations should be re-sent, not carried.

### `attachments` (full column set)

`container_type`/`container_id` (polymorphic; NULL = uncontainered/pending), `filename`, `disk_filename` (physical file lookup key), `filesize`, `content_type`, `digest`, `downloads` (counter), `author_id`, `description`, `file` (CarrierWave column), `fulltext` (extracted text), `fulltext_tsv` + `file_tsv` (tsvector columns with GIN indexes — the legacy system stores attachment FTS in-table), `status` (integer: virus-scan lifecycle). Importer: copy bytes by `disk_filename`, skip `*_tsv`/`fulltext` (the new system extracts its own), map `status` quarantined files to a skipped-with-warning list.

### Three co-existing query systems

1. `queries` — the classic work-package `Query` model (serialized YAML `filters`).
2. `project_queries` — `ProjectQuery` for the projects list (own filter serialization).
3. `persisted_queries` / `persisted_views` / `ordered_persisted_query_entities` — a newer generic `PersistedQuery` base (e.g. `UserQuery`) that the legacy system is migrating toward.

The importer must check all three; on older instances only (1) and (2) exist.

---

## 9. Content format: CKEditor Markdown + macros

Rich text (WP descriptions, wiki pages, comments, meeting agenda, news) is stored as **Markdown** in the legacy system's CKEditor dialect, not HTML. It contains legacy-specific macros and link syntaxes the importer must handle or neutralize:

- Work package links: `##1234`, `###1234`, or `[text](/work_packages/1234)`.
- Wiki links: `[[Page name]]`, `[[project:page]]`.
- User mentions: an HTML-ish `<mention data-id="42">` or `@user` depending on version.
- Macros: `<macro class="toc">`, `child_pages`, `include`, `workPackageValue`, `projectValue`, embedded work-package tables (`<macro class="wp_table">` with a serialized query).
- Attachment references by filename resolved against the container's attachments.

Importer rule: preserve the raw Markdown, and run a **link-rewriting pass** that remaps legacy WP/wiki/user/attachment ids to new ids after all rows are imported (two-phase: import bodies verbatim, then rewrite references). Embedded-table macros that reference a legacy query id become a dead macro; log them for the human.

---

## 10. Importer-critical constraints and ordering

**Foreign-key import order** (topological). Import in roughly this order; defer FK checks within a transaction where possible:

1. Instance data: settings, colors, enumerations, custom_fields (+ options/sections).
2. Principals: users, groups, group_users, placeholder users.
3. Projects (respect `lft`/`rgt` or rebuild the tree from `parent_id`), enabled_modules.
4. Roles, role_permissions, workflows, types, statuses, categories, versions.
5. Members + member_roles (direct rows only; recompute group inheritance).
6. Work packages (parents before children, or two-pass to set `parent_id`), then relations, watchers, custom_values.
7. Content: wikis/pages, forums/messages, news, documents, meetings.
8. Time/cost: activities, time_entries, cost_types, rates, cost_entries, budgets.
9. Attachments (files fetched from disk/S3 by `disk_filename`, see attachments doc).
10. Journals/comments (last, since they reference everything).
11. Two-phase reference rewrite of rich-text bodies.

**Idempotency**: keep `legacy_id` (and `legacy_type` where several legacy tables merge into one) on every imported row; upsert on `(workspace_id, legacy_type, legacy_id)`.

**Known lossy/hard spots** (log each occurrence, raise to human):

| Area | Issue |
|---|---|
| Passwords | Non-bcrypt hashes cannot transfer; force reset. |
| Journals | Full temporal history is not reproduced 1:1 (see section 8). |
| Serialized queries | `filters`/`column_names`/`sort_criteria` YAML must be translated to the new query DSL; unknown filter classes are dropped with a warning. |
| Repositories/changesets | SCM integration is out of scope for v1 (see feature inventory); changesets are not imported. |
| BIM | IFC/BCF is P2; skip unless the customer needs it. |
| Custom actions | Enterprise WP macro-buttons; no equivalent yet, skip + log. |
| Cost reports | Saved cost-report definitions are session/serialized; not imported. |
| Nested set / closure | Rebuild `lft`/`rgt` and `work_package_hierarchies` in the new system; never copy tree bookkeeping columns. |
| Version links | Instances differ: older ones only have `work_packages.version_id`; 2026+ also have `work_package_versions` rows with `kind` (`target`/`observed_in`). Import both; if only `version_id` exists, synthesize a `target` link. |
| Backlogs generations | Pre-2026: sprint = version + `version_settings`. 2026+: standalone `sprints`/`sprint_goals`/`backlog_buckets`. Detect which generation the source uses and map accordingly. |
| Calculated/derived CF values | `calculated_value` custom fields are formulas; import the definition, recompute values, never copy stored results. |

**Never** write to, lock, migrate, or `VACUUM` the source database. Open it read-only.

---

## 11. Extensions, functions, triggers

The legacy system relies on standard PostgreSQL plus:

- `pg_trgm` (trigram search on some text columns).
- `btree_gist` (for the `journals.validity_period` exclusion constraint).
- `unaccent` in some search paths.
- Full-text search uses `tsvector` expressions and GIN indexes on work package subject/description and attachments (via background text extraction).

The importer does not need these on the source (they already exist there). The **new** schema chooses its own search approach (Postgres FTS per PLAN.md); it does not copy the legacy system's tsvector columns.
