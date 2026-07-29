# The legacy system feature inventory

> **ARCHIVED (2026-07-08).** The OpenProject-parity scope and its importer were cut from the plan (REQUIREMENTS.md §6 — the "power floor"; PLAN.md §14 decided log). Nothing in the current plan depends on this file. Retained as background only; do not cite it as a spec source for any task. The competitive benchmark is now Operately (OPERATELY-COMPARISON.md).

What the legacy system actually does, module by module, with the exact permission symbols and enterprise gates. Companion to `legacy-data-model.md`. Use this to scope the rebuild (what is P0 vs droppable) and to build the permission mapping.

Source: `config/initializers/permissions.rb`, every `modules/*/lib/**/engine.rb`, `app/models/enterprise_token.rb`, `config/constants/settings/definition.rb`, `dev` branch, July 2026.

---

## 1. Core objects and the 16 project modules

A project turns features on and off via `enabled_modules`. The registered project modules:

| Module string | Feature | Rebuild priority |
|---|---|---|
| `work_package_tracking` | Work packages (issues/tasks): the core | P0 |
| `activity` | Project activity feed (from journals) | P0 |
| `wiki` | Per-project wiki | P1 |
| `news` | Project news posts + comments | P2 |
| `forums` | Discussion boards | P2 |
| `calendar_view` | Calendar of work packages | P1 |
| `board_view` | Kanban/agile boards | P0 |
| `team_planner_view` | Team planner (assignee swimlanes) | P1 |
| `gantt` (view) | Gantt/timeline | P0 |
| `backlogs` | Scrum: sprints, story points, task board | P1 |
| `costs` | Time logging + cost entries + rates | P1 |
| `budgets` | Project budgets vs actuals | P2 |
| `reporting` | Cost reports | P2 |
| `documents` | Simple document register | P2 |
| `meetings` | Meetings (agenda/minutes, structured) | P1 |
| `repository` | SCM browser (SVN/Git changesets) | Drop (see §9) |
| `resource_management` | Resource allocation planner (newer) | P2 |

Not project-scoped but central: **Projects** (hierarchy, templates), **Members/Roles**, **Custom fields**, **Queries/Views**, **Global search**, **Notifications**, **My page** (personal dashboard), **Admin**.

---

## 2. The full permission catalogue (151 permissions)

Grouped by the module that registers them. `*` = global/instance permission (not project-scoped). These map to the new RBAC matrix in TECHNICAL-PLAN.md.

### Global / project administration (no module)

`add_project`*, `add_portfolios`*, `add_programs`*, `archive_project`, `create_backup`*, `create_user`*, `manage_user`*, `view_all_principals`*, `manage_placeholder_user`*, `view_user_email`*, `view_project`, `search_project`, `edit_project`, `select_project_modules`, `view_project_attributes`, `export_projects`, `edit_project_attributes`, `select_project_custom_fields`, `view_project_phases`, `edit_project_phases`, `select_project_phases`, `manage_members`, `invite_members_by_email`, `view_members`, `manage_versions`, `manage_types`, `select_custom_fields`, `add_subprojects`, `copy_projects`, `edit_attribute_help_texts`*, `manage_public_project_queries`, `view_project_query`, `edit_project_query`, `manage_own_working_times`, `manage_working_times`*.

### Work packages (`work_package_tracking`)

`view_work_packages`, `add_work_packages`, `edit_work_packages`, `delete_work_packages`, `move_work_packages`, `copy_work_packages`, `manage_subtasks`, `manage_work_package_relations`, `change_work_package_status`, `work_package_assigned`, `add_work_package_comments`, `edit_work_package_comments`, `edit_own_work_package_comments`, `add_work_package_attachments`, `add_work_package_watchers`, `view_work_package_watchers`, `delete_work_package_watchers`, `export_work_packages`, `share_work_packages`, `view_shared_work_packages`, `view_internal_comments` (ent), `add_internal_comments` (ent), `edit_own_internal_comments` (ent), `edit_others_internal_comments` (ent).

### Activity / queries / wiki / news / forums / repo (core)

- Activity: `view_project_activity`.
- Queries: `save_queries`, `manage_public_queries`.
- Wiki: `view_wiki_pages`, `view_wiki_edits`, `edit_wiki_pages`, `manage_wiki`, `manage_wiki_menu` / `manage_wiki_page_links`.
- News: `view_news`, `manage_news`, `comment_news`.
- Forums: `view_messages`, `add_messages`, `edit_messages`, `edit_own_messages`, `delete_messages`, `delete_own_messages`, `manage_forums`.
- Repository: `browse_repository`, `commit_access`, `manage_repository`, `view_commit_author_statistics`. (Drop in v1.)

### Module engines

| Module | Permissions |
|---|---|
| boards | `show_board_views`, `manage_board_views` |
| calendar | `view_calendar`, `manage_calendars`, `share_calendars` |
| team_planner | `view_team_planner`, `manage_team_planner` |
| backlogs | `view_sprints`, `select_backlog_types_and_statuses`, `create_sprints`, `start_complete_sprint`, `manage_sprint_items`, `share_sprint` (ent) |
| costs | `view_time_entries`, `view_own_time_entries`, `log_own_time`, `log_time`, `edit_own_time_entries`, `edit_time_entries`, `manage_project_activities`, `view_own_hourly_rate`, `view_hourly_rates`, `edit_own_hourly_rate`, `edit_hourly_rates`, `view_cost_rates`, `log_own_costs`, `log_costs`, `edit_own_cost_entries`, `edit_cost_entries`, `view_cost_entries`, `view_own_cost_entries` |
| budgets | `view_budgets`, `edit_budgets` |
| reporting | `save_cost_reports`, `save_private_cost_reports` |
| documents | `view_documents`, `manage_documents` |
| meetings | `view_meetings`, `create_meetings`, `edit_meetings`, `delete_meetings`, `send_meeting_invites_and_outcomes`, `manage_agendas`, `manage_outcomes` |
| storages | `manage_files_in_project`, `view_file_links`, `manage_file_links` |
| resource_management | `view_resource_planners`, `manage_public_resource_planners`, `allocate_user_resources`, `assign_users_to_generic_allocations` |
| overviews | `manage_dashboards` |
| bim | `view_ifc_models`, `manage_ifc_models`, `view_linked_issues`, `manage_bcf`, `delete_bcf`, `save_bcf_queries`, `manage_public_bcf_queries` |
| github | `introspection` (OAuth) |

### Seeded roles (defaults the importer maps)

The legacy system seeds these `ProjectRole`s: **Project admin** (all project perms), **Member** (view/add/edit WPs, comment, log time, wiki edit, etc.), **Reader** (view-only). Plus built-in **Non-member** and **Anonymous** pseudo-roles (`roles.builtin` = 1 and 2) that grant a small view set on public projects. `GlobalRole`s carry the `*` permissions. `WorkPackageRole`s (`view`, `comment`, `edit`) back the work-package sharing feature.

---

## 3. Enterprise-gated features (28)

Enterprise features are unlocked by a signed `enterprise_tokens` row (validated by `the legacy system::Token.import` against a bundled public key; `allows_to?(feature)` checks the token's feature list and expiry). The feature symbols:

`baseline_comparison`, `calculated_values`, `capture_external_links`, `custom_field_hierarchies`, `customize_life_cycle`, `date_alerts`, `define_custom_style`, `edit_attribute_groups`, `gantt_pdf_export`, `internal_comments`, `ldap_groups`, `mcp_server`, `meeting_templates`, `nextcloud_sso`, `one_drive_sharepoint_file_storage`, `placeholder_users`, `portfolio_management`, `project_creation_wizard`, `readonly_work_packages`, `sprint_sharing`, `sso_auth_providers`, `team_planner_view`, `time_entry_time_restrictions`, `virus_scanning`, `weighted_item_lists` (registered via the custom-field format registry, not `allows_to?`), `work_package_query_relation_columns`, `work_package_sharing`, `work_package_subject_generation`, `xwiki_integration`.

Plus a **user-count limit** enforced by `the legacy system::Enterprise.user_limit` when unlicensed.

### Methodology / standards support (verified against code and docs)

The legacy system "supports standards" through a mix of purpose-built features, shipped guides, and configuration patterns — not through per-methodology code. The exact mechanics, verified:

| Standard | How the legacy system delivers it | Evidence |
|---|---|---|
| **PM²** (European Commission) | Project life cycle **phases with start/finish gates**; **project initiation request wizard** (enterprise `project_creation_wizard`, v17.0/17.1, with PIR PDF export); **portfolios & programs** hierarchy (v17.0, `add_portfolios`/`add_programs`, enterprise `portfolio_management`); project templates + copy (incl. meeting agenda copy); custom WP types for PM² artefacts (Business Case, Project Handbook); meetings linkable to phase gates; a full Open PM² guide shipped in `docs/project-management-guide/` | `project_phase_definitions` (start_gate, start_gate_name, finish_gate, finish_gate_name), `Queries::Projects::Filters::ProjectPhaseGateFilter`, `Projects::CreationWizard::*`, `docs/use-cases/project-management-pm2-pmflex/` |
| **PMflex** (German BVA extension of PM²) | Same feature set as PM²; PMflex is explicitly named as a target of the PIR wizard and portfolio hierarchy | release notes 17.0/17.1, same use-case doc |
| **OKR** | **No native module.** A documented configuration pattern: WP types "Objective"/"Key Result", versions as OKR cycles, custom fields for progress, wiki as knowledge hub | `docs/use-cases/okr-management/` |
| **SAFe** (scaled agile) | Cross-project **sprint sharing** (enterprise `sprint_sharing`, `sprints.sharing` column) "to align teams in scaled agile setups (SAFe)" + boards + programs | `modules/backlogs/config/locales/en.yml`, sprint sharing scopes |
| **PRINCE2** | **Zero references in the current codebase or shipped docs.** The stage/gate + template features generically fit PRINCE2, but nothing PRINCE2-specific ships today | repo-wide grep, July 2026 |

Rewrite stance: the enabling features are what must exist (phases+gates, templates, portfolios, sprint sharing, initiation wizard); the standards themselves become **seeded template projects + guides** (IMPLEMENTATION-PLAN P8-T06). The new product's native OKR module (REQUIREMENTS Strategy module) exceeds the legacy system, which only documents OKR as a pattern.

### Newer the legacy system features to be aware of (2025–2026)

These landed recently; the rewrite should at least not block them, and the importer must recognize their tables:

| Feature | Storage | Rewrite stance |
|---|---|---|
| Project lifecycle phases (stage/gate) | `project_phases`, `project_phase_definitions`, WP `project_phase_id` | P2; import if used |
| Multi-version WP links (target / observed-in) | `work_package_versions` (`kind` enum) | schema supports; v1 UI shows single target version |
| Backlogs redesign (standalone sprints) | `sprints`, `sprint_goals`, `backlog_buckets` | map both generations in importer |
| Favorites (star projects/queries) | `favorites` (polymorphic) | cheap win; adopt in v1 |
| Built-in Jira importer | `jira_*` staging tables | skip tables; a Jira importer for the new product is a P2 idea |
| MCP server (AI agent access) | `mcp_configurations` | skip; new product gets its own AI surface via AIProvider |
| Service accounts + SCIM clients | `service_accounts`, `service_account_associations`, `scim_clients` | P4 (enterprise pack) |
| Custom field comments / calculated values / weighted lists | `custom_comments`, `calculated_value_errors`, format registry | log-and-skip in importer v1 |
| Portfolios / programs | `add_portfolios`/`add_programs` permissions, `portfolio_management` ent | P2 with Strategy module |

Decision for the new product (see PLAN.md §12): SSO, LDAP-groups, and sharing are proposed as **open core** (institutions require them). The rest can be paid-tier or dropped. This is a human decision, not the agent's.

---

## 4. Settings and admin

~259 setting definitions in `config/constants/settings/definition.rb`, each overridable by env var `LEGACY_<UPPER_SNAKE>`. Areas: general (host, welcome text), display (date/time format, first day of week, theme), authentication (self-registration mode, password rules, session TTL, brute-force lockout), work package tracking (cross-project relations, allowed statuses), notifications/email (from address, SMTP, digest timing, `journal_aggregation_time_minutes`), API (CORS, max page size), attachments (max size, whitelist), working days (`working_days` array), repositories, rate limits.

Admin area sections: Users & permissions (users, groups, roles, placeholder users), Work packages (types, statuses, workflow, custom fields, attribute help texts), Projects (project attributes/custom fields, templates), Custom fields, Enumerations, Emails & notifications, Authentication (settings, LDAP, OpenID providers, SAML, OAuth apps, 2FA), Announcements, Design (theme, logo, colors — enterprise), Backups, Information/health, plus one section per enabled module (Boards, Meetings, Costs, Backlogs, Storages, GitHub, etc.).

---

## 5. Realtime & activity today

The legacy system's frontend polls and uses ActionCable in a few spots; it is not a heavily realtime product. The activity tab is journal-derived. Presence and live co-editing do **not** exist. The rewrite's realtime plan (PLAN.md §7) is an upgrade, not parity work.

---

## 6. Frontend split (rebuild scoping)

The legacy system is mid-migration from Angular to Hotwire (Turbo/Stimulus + ViewComponent on GitHub Primer):

- **Angular** (legacy): work package table/split view, boards, gantt/timeline, team planner, calendar, the query/filter UI, global search.
- **Hotwire/Primer** (newer): project lists, admin screens, meetings, notifications center, many settings pages, project overview.

The rewrite replaces both with Next.js + React. There is no Angular or Hotwire code to port; only the *behavior* and *screen inventory* matter. Roughly ~40 primary screens: global dashboard/my page, project list, project overview, work package list (table/gantt/cards), work package full/split view, boards, team planner, calendar, backlogs/taskboard, wiki, meetings list + detail, news, forums, documents, time/cost logging, budgets, cost reports, members admin, roles admin, custom fields admin, types/statuses/workflow admin, project settings (modules, versions, categories, attributes, backups), global admin sections above, account/preferences, notification center, global search results, login/registration/2FA.

---

## 7. i18n

The legacy system ships ~50 locales via Crowdin. Malay (`ms`) and Indonesian (`id`) locale files both exist (`config/locales/crowdin/ms.yml`, `id.yml`), so both target languages already have a translation base to seed from. The rewrite uses its own i18n stack but can lift these YAML strings as a starting glossary.

---

## 8. APIv3 (integration surface to preserve conceptually)

The legacy system exposes a mature HAL+JSON REST API (`/api/v3`) built on Grape. Key resources: `work_packages` (with `/form` validation and `/schema`), `projects`, `queries`, `versions`, `memberships`, `principals`/`users`/`groups`/`placeholder_users`, `time_entries`, `relations`, `attachments`, `activities`, `notifications`, `statuses`, `types`, `priorities`, `custom_options`, `values/schema` (custom fields as `customField{id}`), `capabilities`, `configuration`. Patterns worth keeping in the new REST surface: form-endpoint validation before commit, schema endpoints describing attributes, and the filter grammar `filters=[{"status":{"operator":"o","values":[]}}]`.

Existing customers may have integrations against `/api/v3`. Decision for the human: offer a thin `/api/v3` compatibility shim, or a clean new REST API + migration guide. Default lean: clean new API, documented breaking changes (this is a rewrite, not a fork).

---

## 9. What to drop or defer in v1

| Feature | Call | Why |
|---|---|---|
| Repository/SCM browser (`repository`) | **Drop** | Git hosting is a solved external problem; the GitHub/GitLab *integration* is the valuable part, keep that instead. |
| BIM (IFC/BCF) | **Defer (P2)** | Construction-industry niche; large surface; only if a customer needs it. |
| Custom actions (enterprise WP buttons) | Defer | Niche automation; a rules engine can replace later. |
| Cost reports engine | Defer (P2) | Rebuild as saved queries + export rather than the legacy report builder. |
| Jira importer tables | **Drop** | Staging tables for the legacy tool's own Jira import; not our data. |
| MCP server, XWiki, portfolio/program mgmt | Defer | Enterprise extras, not core PM. |
| Forums, news, documents | P2 | Low-usage collaboration extras; wiki + comments cover most needs. |

Everything under P0/P1 in §1 is the real product to rebuild.
