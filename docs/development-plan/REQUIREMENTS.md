# REQUIREMENTS.md

Product authority for `OpenOKR`. Informed by analyses of two mature source systems (documented in `reference/`, used to scope parity and the importers) plus OpenOKR's own product goals: a legacy project tool scopes the work-management core; FlowyTeam scopes the strategy core (OKR, KPI, check-ins, tasks). Sections marked **[DECIDE]** need a human answer before the design gate that depends on them; the agent must ask, not invent.

The product target is: **native OKR and KPI management connected to full-featured project and work management, on a modern stack, with importers that migrate data from both legacy tools.** Feature scope below is priced as P0 (must ship v1), P1 (fast follow), P2 (design for, do not build yet).

---

## 1. Product

- **Name:** `OpenOKR` **[DECIDE]** (working name until chosen; see PLAN.md §12).
- **One-liner:** An open source platform where teams set objectives and KPIs, plan the work that moves them, and track both in one place — self-hosted or in the cloud.
- **The problem:** Strategy tools and work tools live apart: OKRs sit in a spreadsheet or a point solution while the actual work runs in a project tool, so goals and execution drift. Teams also need full-featured project management (work packages, gantt, boards, time tracking) without the weight of a legacy Rails/Angular stack, and a clean path to migrate their existing data. Institutions need it self-hostable, auditable, and able to pass a security review.
- **Relationship to the source tools:** OpenOKR is a new product, not a fork of either. It provides one-way **importers** that read an existing legacy PostgreSQL database (the project tool) and an existing FlowyTeam MySQL database (see §4 and TECHNICAL-PLAN.md §7). It does not need to be API- or plugin-compatible with either tool.

## 2. Who uses it

| Persona | What they need to get done | Tech comfort |
|---|---|---|
| Team member | See work assigned to them, update status, log time, comment, get notified | Low–Medium |
| Project/team lead | Create projects, plan with gantt/boards, assign people, track progress, report | Medium |
| PMO / operations manager | Run OKR cycles and KPI reviews, portfolio view across projects, dashboards, exports | Medium–High |
| Org / IT admin | Manage users, roles, SSO/LDAP, backups, audit, prove compliance at scale | High |
| Migrating admin | Move an existing install of either legacy tool onto OpenOKR without losing data | High |

## 3. Modules

The product has two pillars. The **strategy pillar** (OKR, KPI, check-ins) is the namesake surface, scoped from FlowyTeam and specified in depth in [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md) §4.12 (schema) and [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) Phase 4 (tasks); it is built in Phase 4. The **execution pillar** (work packages and everything around them) is scoped from the legacy project tool; within it, priorities reflect that tool's usage reality (work packages, projects, boards, gantt are the heart; forums/news/documents/BIM are edges — see `reference/legacy-feature-inventory.md`). The two pillars meet in the work package: work links to objectives, key results, and KPIs.

### Module: Strategy / OKRs (P0)

- **Problem it solves:** Connect day-to-day work to objectives and key results, cascaded across the org. This is the product's namesake surface, scoped from FlowyTeam's mature implementation (`reference/flowyteam-okr-kpi-tasks-model.md`).
- **Key actions:** define objectives owned by the workspace / a team / a person, inside an OKR cycle; add key results as a numeric range (initial → target, direction-aware) with a unit and weight; set confidence; align objectives under a parent objective or key result; check in (value + confidence + remark + category); view the alignment tree; link work to objectives/key results.
- **Data it owns:** objectives, key results, key-result value history, OKR cycles, alignment pointers, check-ins.
- **Derived:** progress %, RAG color (from configurable thresholds), status bucket (from confidence). Recomputed by a scoring engine; scores cascade upward.
- **Priority:** P0. Detailed schema in **[TECHNICAL-PLAN.md](TECHNICAL-PLAN.md) §4.12**, tasks in **[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) Phase 4**.
- **Acceptance (sample):** *Given* a user with `manage_objectives` in an active cycle, *when* they create an objective with two weighted key results, *then* it appears in the OKR explorer at 0% / "not tracked", and its score recomputes when a key result value is checked in.

### Module: KPIs (P0)

- **Problem it solves:** Track recurring metrics against targets over time, independent of a single objective.
- **Key actions:** define KPIs in a category, with a frequency (daily/weekly/monthly/quarterly/yearly), a unit, a direction (higher- or lower-is-better), a default target, and RAG thresholds; record target vs actual per period; build calculated KPIs from a formula over other KPIs (with cross-frequency aggregation); organize KPIs in a parent/child tree; link a KPI to a key result so a KR is measured by a KPI.
- **Data it owns:** KPIs, KPI categories, per-period records, formula dependencies, KR↔KPI links.
- **Priority:** P0. Detail in TECHNICAL-PLAN.md §4.12 and IMPLEMENTATION-PLAN.md Phase 4.

### Module: Check-ins (P1)

- A lightweight recurring ritual to update OKRs and surface blockers: per-period sessions with confidence + remark + category on each objective/key result, plus a manager review step and a dated history. **Priority:** P1 (Phase 4).

### Module: Work packages (P0)

- **Problem it solves:** Teams lose track of who does what by when.
- **Key actions:** create/edit/delete work packages; set type, status, priority, assignee, responsible, dates, version, parent; comment; watch; attach files; relate (blocks, precedes/follows, relates, parent/child); bulk edit; export (CSV/PDF/Excel).
- **Data it owns:** work packages, relations, categories, watchers, comments (as journal notes), attachments links.
- **Who can do what:** role-based. View / add / edit / delete / comment / change-status / manage-relations / manage-subtasks are distinct permissions (see feature inventory §2). Sharing a single work package with a user at view/comment/edit level (P1).
- **Realtime needs:** live list updates and presence on boards (new capability, PLAN.md §7); co-edit of descriptions later (P2).
- **AI needs:** summarise a work package thread, draft a work package, or decompose an objective into work packages on demand — through the in-app copilot or the user's own MCP agent (see the AI copilot & agents module below and AI-NATIVE-PLAN.md). Accelerators only; on where a provider is configured.
- **Priority:** P0
- **Tasks unification:** FlowyTeam's lighter "Tasks" (Kanban board, single assignee, subtasks-as-checklist, recurrence, OKR/KPI links) are **the same entity** here — they import into work packages, which gain `objective_id`/`key_result_id`/`kpi_id` link columns, a `checklist_items` child, and a recurrence rule. See TECHNICAL-PLAN.md §4.12.7.
- **Acceptance (sample):** *Given* a member with `add_work_packages`, *when* they create a work package with subject and type, *then* it appears in the project list and an activity entry and notification are generated.

### Module: Types, statuses, workflow (P0)

- **Problem it solves:** Different work needs different fields and lifecycles.
- **Key actions:** define work package types with attribute groups (form layout), statuses (open/closed/read-only), and a per-type per-role workflow (allowed status transitions).
- **Data it owns:** types, statuses, workflows.
- **Who can do what:** admin (`manage_types`, workflow admin).
- **Priority:** P0 (workflow transitions are load-bearing; the importer carries them).

### Module: Projects & versions (P0)

- **Problem it solves:** Work needs a home and a hierarchy; releases need milestones.
- **Key actions:** create projects (with identifier), nest sub-projects, archive, mark templated, copy from template, set status; manage versions (milestones) with sharing scope and effective date; enable/disable modules per project.
- **Data it owns:** projects (tree), enabled modules, versions, categories, project attributes (custom fields on projects).
- **Who can do what:** `add_project`, `edit_project`, `archive_project`, `manage_versions`, `select_project_modules`, `copy_projects`.
- **Priority:** P0

### Module: Custom fields & project attributes (P0)

- **Problem it solves:** Every org tracks extra attributes.
- **Key actions:** define custom fields (string, text, int, float, date, bool, single/multi list, user, version, link, hierarchy) on work packages, projects, users, versions, time entries; group into sections; mark required/searchable; activate per project/type.
- **Data it owns:** custom fields, options, values, activation mappings, sections.
- **Priority:** P0 (data importer depends on faithfully carrying custom values).

### Module: Queries & views (P0)

- **Problem it solves:** Everyone needs saved, filtered, sorted views of work.
- **Key actions:** filter, sort, group, sum, choose columns, choose display (table/cards/gantt), save as public or private, pin to sidebar, star; baseline comparison (P2, enterprise in the legacy tool).
- **Data it owns:** queries, views, per-user ordering.
- **Priority:** P0. The new system needs its own query DSL; the importer translates the legacy system's serialized YAML filters into it.

### Module: Boards (P0)

- **Problem it solves:** Visual, drag-and-drop work management.
- **Key actions:** create boards; free boards and action boards keyed by status / assignee / version / subproject / parent; drag cards to change the keyed attribute; manual card order.
- **Data it owns:** boards (as grids), widgets/columns referencing a query per column, manual order.
- **Priority:** P0

### Module: Gantt / timeline (P0)

- **Problem it solves:** See schedule and dependencies over time.
- **Key actions:** timeline of work packages, dependency arrows (precedes/follows), milestones, zoom, drag to reschedule respecting manual/automatic scheduling and working days.
- **Data it owns:** reuses work packages + query timeline settings.
- **Priority:** P0

### Module: Scheduling & working days (P0)

- **Problem it solves:** Dates must respect dependencies and non-working days.
- **Key actions:** automatic scheduling from follows-relations with lag; manual scheduling mode per work package; instance working days + holidays; per-user working hours/non-working time (P1); rollup of dates/progress/effort to parents.
- **Priority:** P0 (this is the hardest core engine; see TECHNICAL-PLAN.md).

### Module: Calendar (P1)

- View work packages on a month/week calendar; ICS subscription feed. **Priority:** P1.

### Module: Team planner (P1)

- Assignee swimlanes across a date range; drag to reschedule/reassign. **Priority:** P1.

### Module: Backlogs / Scrum (P1)

- Sprints (versions), story points, sprint/product backlog ordering, task board, burndown. **Priority:** P1.

### Module: Time & cost tracking (P1)

- **Key actions:** log time against work packages with activity and comment; start/stop timer; cost entries with cost types; hourly rates with valid-from history; view own vs all rates by permission.
- **Data it owns:** time entries, activities, cost entries, cost types, rates.
- **Priority:** P1 (time tracking P1, cost/rates P1, cost reports P2).

### Module: Budgets (P2)

- Project budgets (labor + material items) vs actual spend. **Priority:** P2.

### Module: Wiki (P1)

- Per-project wiki, page tree, versioning, links/macros, menu. **Priority:** P1.

### Module: Meetings (P1)

- Structured meetings: agenda items with duration/position, sections, participants (invited/attended), outcomes/minutes, recurring meetings (RRULE), ICS invites, agenda items linked to work packages. **Priority:** P1.

### Module: News / Forums / Documents (P2)

- Project news with comments; discussion forums; simple document register. **Priority:** P2 (low usage; wiki + comments cover most needs).

### Module: Project lifecycle phases & gates (P2)

- Stage/gate phases on projects (the legacy system 2026 feature: workspace-level phase definitions **with named start/finish gates**, per-project date ranges, work packages taggable to a phase, gates filterable in the project list). This is the backbone of PM²/PMflex/PRINCE2-style governance (see §4 Methodology support). **Priority:** P2, human-gated (IMPLEMENTATION-PLAN P3-T33); importer must recognize the tables either way.

### Module: File storage integrations (P1)

- Attachments (upload, virus scan optional); link external files from Nextcloud / OneDrive-SharePoint; per-project managed folders. **Priority:** attachments P0, external storages P1/P2. See §4 integrations.

### Module: Notifications & reminders (P0)

- In-app notification center + email; per-user, per-project notification settings (watched/involved/mentioned/assignee); mentions from rich text; date alerts (start/due/overdue) (enterprise in the legacy tool, P1 here); reminders on work packages; email digests. **Priority:** P0 (in-app + email), P1 (date alerts, digests).

### Module: My page / dashboards (P1)

- Personal configurable dashboard of widgets (assigned work, calendar, news). Project overview dashboard. **Priority:** P1.

### Module: Operations (NEW) (P2)

- **Problem it solves:** Recurring operational processes beyond projects (e.g. checklists, SOPs, tickets).
- **Priority:** P2. **[DECIDE]** scope. Design-for, do not build in v1.

### Module: AI copilot & agents (MCP) (P0, native)

- **Problem it solves:** teams want help drafting and improving OKRs, breaking goals into work, summarizing threads and meetings, and querying their data in plain language — and they want to do this from their own AI agent, not only inside the app. Strategy tools that bolt AI on late feel like an afterthought; OpenOKR builds it in from day one.
- **Key actions:** per-module AI **assists** (draft / rate / improve objectives and key results, suggest KPIs and targets, decompose objectives into work packages, summarize threads and meetings into action items, natural-language search and query); an in-app **copilot** that answers grounded in workspace data and takes actions the user confirms; an **MCP server** so an external agent (Claude, Cursor, a custom agent) manages OKRs and projects as the user, within the user's permissions; **bring-your-own AI key** at the deployment, workspace, or individual-user level, including local models (Ollama, any OpenAI-compatible endpoint) for air-gapped installs.
- **Data it owns:** provider config, encrypted credentials, the model catalog and routing, per-feature settings, versioned prompts, copilot threads, tool-call and usage/cost logs, embeddings (AI-NATIVE-PLAN.md §7).
- **Who can do what:** admins configure AI (`manage_ai`) and mint agent tokens; every AI action inherits the acting user's existing permissions — the agent is never a superuser.
- **Constraints:** every assist is an accelerator over a complete manual path (nothing AI-only on a required path); on by default only where a provider is configured; every action is permission-checked, metered, capped, and audited.
- **Priority:** P0 (native). Full spec in **[AI-NATIVE-PLAN.md](AI-NATIVE-PLAN.md)**; built in **Phase 5**.
- **Acceptance (sample):** *Given* a workspace with a configured provider and a user with `manage_objectives`, *when* the user asks the copilot (or their own MCP agent) to draft next quarter's objectives for their team, *then* it proposes objectives with key results the user approves before anything is saved; *and* the same user with AI disabled can still create them by hand.

## 4. Cross-cutting needs

- **Reporting and exports:** work package lists to CSV, Excel (XLSX), PDF; project list export; gantt PDF (P2). REST API for programmatic access (P1). Audit export (P2, enterprise).
- **Notifications:** in-app (P0) and email (P0); digests (P1); Slack/Teams webhooks (P2).
- **Data importer (P0, hard requirement):** a CLI that reads an existing legacy database read-only and loads it into a clean `OpenOKR` schema. It supports **two sources**: the Rails project tool (PostgreSQL — `reference/legacy-data-model.md`) and **FlowyTeam** (MySQL, per-company — `reference/flowyteam-okr-kpi-tasks-model.md`), selected with `--from`. Must cover P0/P1 modules losslessly for current state and comments; see each reference's lossy list and TECHNICAL-PLAN.md §7 for architecture. Re-runnable/idempotent; both sources may load into one workspace without id collisions (`legacy_type`).
- **Cutover approach (decided):** one-time migration during a maintenance window into a clean schema — the new app does **not** run on either legacy schema. For source 1, the default topology keeps the existing PostgreSQL instance and migrates schema-to-schema, leaving the old tables read-only for instant rollback; for source 2 (MySQL), the importer streams cross-engine and the old database is the rollback archive (TECHNICAL-PLAN.md §7.2).
- **Integrations:** GitHub and GitLab (link PRs/MRs/issues/pipelines to work packages, inbound webhook) — P1. Nextcloud / OneDrive-SharePoint file links — P1/P2. Incoming email to create/update work packages — P2. Calendar ICS feeds — P1.
- **AI & agents (P0, native):** AI assists in every module, an in-app copilot, and an **MCP server** that lets any AI agent manage OKRs and projects as the user; multi-provider with bring-your-own key and local-model (Ollama / OpenAI-compatible) support; on where a provider is configured, never on a required path. Full spec in AI-NATIVE-PLAN.md; see the AI copilot & agents module in §3.
- **UX quality bar (P0):** the product must feel like a modern tool, not a faster the legacy system: inline editing, optimistic updates with undo, command palette (⌘K), favorites, dark mode, full keyboard support, responsive mobile shell, live updates. The binding spec is UIUX-PLAN.md; performance budgets are in TECHNICAL-PLAN.md §13 and are requirements, not aspirations.
- **Methodology support (P1/P2):** the product must be usable under **PM², PMflex, PRINCE2, SAFe, Scrum and OKR** ways of working, delivered the way the legacy system does it (verified in feature inventory §"Methodology / standards support"): the enabling features (project templates + copy P0, phases with gates P2, portfolios/programs P2, sprint sharing P2, initiation wizard P2/enterprise) plus a **seeded methodology template gallery + guides** at launch (IMPLEMENTATION-PLAN P8-T06). No per-methodology code.
- **Languages:** English (P0) and Bahasa Melayu (P1). Indonesian available as a bonus (both `ms` and `id` locale bases already exist in the legacy system to seed from). Architecture must be i18n-ready from day one.
- **Accessibility:** WCAG 2.1 AA as a target; keyboard navigation and screen-reader labels on core flows. No stricter sector requirement stated. **[DECIDE]** if a formal audit is required.

## 5. Non-functional requirements

- **Scale expectations:** largest single deployment target — a university-scale org: order of **tens of thousands of users** and **millions of work packages** in one workspace. Design queries, indexes, and pagination for this from the start.
- **Performance feel:** primary list/dashboard views load under ~2 seconds on a mid-range laptop with a realistic dataset (tens of thousands of work packages in a project). Work package save feels instant (optimistic UI).
- **Compliance:** PDPA (Malaysia) and GDPR-style data handling: user data export and deletion, audit log, data-processing transparency. **[DECIDE]** any sector-specific rules (education, finance).
- **Data residency:** self-hosting satisfies in-country residency for institutions that need it. No multi-region cloud requirement stated for v1.
- **Offline / air-gapped installs:** yes — institutions may run fully air-gapped. Therefore: no feature may hard-depend on an external SaaS, AI is always optional and can point at a local model or be disabled (PLAN.md hard rule), and telemetry is opt-in.

## 6. Out of scope for v1

- **Native mobile apps.** Responsive web covers it; revisit after launch.
- **SCM/repository browser** (SVN/Git changeset browsing). Git hosting is external; we keep the GitHub/GitLab *integration*, not a repo browser.
- **BIM (IFC/BCF construction module).** Niche; design nothing for it in v1.
- **Real-time co-editing (CRDT).** Design the data model so it can be added (structured JSON + version column), but do not build it.
- **the legacy system API/plugin compatibility.** We provide a data importer, not a compatibility layer.
- **Legacy cost-report builder and custom-action buttons.** Replace with saved queries/exports and (later) a rules engine.
- **Full byte-perfect journal history import.** Import current state + comments + a simplified activity feed instead (see data-model §8).

## 7. Success metrics

- **Leading:** a new team completes setup and creates its first objective and work package within 15 minutes; an admin of either legacy tool runs a dry-run import and sees a correct summary within one session.
- **Lagging:** N active self-hosted instances within 6 months of launch (**[DECIDE]** target N); at least a handful of real migrations (from either source) completed successfully.

## 8. Open questions (agent must raise, not guess)

- Product name, business model, SSO placement, license sign-off (PLAN.md §12).
- Exact scope of the **Operations** module. (The Strategy/OKR scope is decided — see §3 and TECHNICAL-PLAN.md §12.)
- How much the legacy system **journal history** to import (current-state-only vs simplified feed vs full).
- Whether to ship a legacy system **`/api/v3` compatibility shim** or a clean new API only.
- Whether **cost/budget** and **backlogs** are in the funded v1 or deferred.
- Target scale numbers to design load tests against, and any formal accessibility/compliance audit.
- AI default posture (on where configured vs off) and whether advanced AI (copilot, MCP server) is open or gated (PLAN.md §12 #7–#8, AI-NATIVE-PLAN.md §13).
