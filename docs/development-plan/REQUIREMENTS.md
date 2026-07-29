# REQUIREMENTS.md

Product authority for `OpenOKR`. The competitive benchmark is **Operately** (the shipped open-source "company operating system"); the analysis behind this revision is OPERATELY-COMPARISON.md and the 142-item OPERATELY-GAP-REGISTER.md. One legacy system feeds an importer: **FlowyTeam** (Laravel/MySQL — `reference/flowyteam-okr-kpi-tasks-model.md`). The old OpenProject-parity scope and its importer were **cut** (decision 2026-07-08); the OpenProject reference docs are retained as archived background only.

Sections marked **[DECIDE]** need a human answer before the design gate that depends on them; the agent must ask, not invent.

The product target: **an opinionated operating system for running a company on goals — native OKRs, KPIs and check-ins, a built-in operating rhythm with real accountability, an Operately-class execution core (projects, milestones, work items, boards, documents), and AI woven through it including autonomous AI teammates — on a modern TypeScript stack, self-hosted or (later) in the cloud.** Feature scope is priced P0 (must ship v1), P1 (fast follow inside v1), P2 (design for, do not build yet). Everything deferred beyond v1 lives in §6 (the power floor).

---

## 1. Product

- **Name:** `OpenOKR` **[DECIDE]** (working name; it undersells the operating-system positioning — see PLAN.md §14 #1).
- **One-liner:** An open source operating system for running a company on goals: OKRs, KPIs and check-ins joined to the work that delivers them, driven by a built-in weekly rhythm, real accountability, and AI teammates. Self-host it. Own it.
- **The problem:** Strategy tools and work tools live apart, so goals and execution drift. Generic work tools give infinite flexibility and zero guidance — teams configure instead of executing. Operately proved the opinionated alternative works; OpenOKR takes the same stance further: a deeper OKR/KPI model, database-enforced isolation, genuine data portability, AI that is governed (bring your own key, local models, hard cost caps) and *accountable* (AI teammates that run on the same rhythm as people), on a stack the team owns end to end.
- **How OpenOKR must beat Operately (the product bar):** everything in TECHNICAL-PLAN.md §15. Headlines: a real KPI module with calculated formulas (Operately has none); direction-aware, weighted key results with value history and trend forecasting; database-level tenant isolation (RLS) under a relationship access model; tamper-evident audit; self-serve workspace export/import; local/air-gapped AI with metering and caps; AI teammates that are sandboxable, cost-capped, and least-privilege; a generated CLI + OpenAPI from one contract.
- **Relationship to the source tools:** OpenOKR is a new product, not a fork of anything. It ships a one-way **FlowyTeam importer** (MySQL, per-company: full strategy + tasks) and a **generic CSV/XLSX importer**. Operately is a benchmark, never a source: we study behavior, we do not copy code (TECHNICAL-PLAN §11).

## 2. Who uses it

| Persona | What they need to get done | Tech comfort |
|---|---|---|
| Team member | See what they owe this week (check-ins, tasks, reviews), update in one place, get the right nudges | Low–Medium |
| Team / project lead (champion) | Own goals and projects, post check-ins, keep milestones honest, see their team's work map | Medium |
| Reviewer / manager | Review and acknowledge check-ins, spot stale or at-risk work early, coach via discussions | Medium |
| PMO / operations manager | Run OKR cycles and KPI reviews, the company-wide work map, scorecards and exports | Medium–High |
| Org / IT admin | Manage members, SSO, backups, audit, AI governance, pass a security review | High |
| Migrating admin | Move FlowyTeam data (or CSV exports of anything else) in without loss | High |
| AI teammate | An agent member with a persona and instructions that plans and executes on the cadence, within scoped permissions | — |

## 3. The operating model (P0 — the spine of the product)

This is what makes OpenOKR an operating system rather than a tracker. These are **not modules a user assembles**; they are defaults the product imposes (each changeable, never absent). All P0, built in Phases 2–4.

### 3.1 Cadence & staleness

Every goal and project has a check-in frequency (weekly by default, anchored to a company-chosen day; biweekly/monthly selectable). The system — not the user — computes and stores the next due date, honors the workspace timezone and a small on-time tolerance, and drives reminders and the review inbox from it. A goal or project whose check-in is missed beyond a configurable grace window becomes **`outdated`**: a derived state that *overrides* the last self-reported health everywhere it is shown.
**Acceptance (sample):** *Given* a weekly goal last checked in 10 days ago, *when* any list, work map or dashboard renders it, *then* it shows `outdated` regardless of the last check-in's status, and its champion sees "Submit check-in — overdue by N days" in their review inbox.

### 3.2 Champion & reviewer accountability

Every goal and project carries exactly one **champion** (the accountable owner) and one **reviewer** — distinct from access roles. A published check-in enters `awaiting-acknowledgement`; the reviewer's acknowledgement (optionally with a comment) closes the loop and is itself tracked. Changing champion or reviewer atomically rebinds their access and reassigns pending obligations (a new reviewer is not asked to acknowledge history).

### 3.3 The review inbox ("what do I owe right now")

A per-person, server-computed list of obligations: check-ins due (as champion), acknowledgements owed (as reviewer), work items and milestones due — ranked overdue-first, with action labels and human due-status ("Overdue by 3 days"), a live badge count, and one-click actions. Distinct from the notifications inbox (§5.4): notifications say what happened; the review inbox says what you owe.

### 3.4 Check-ins as narrative snapshots

A check-in is a first-class artifact, not a status dropdown: a small fixed status vocabulary (`on_track` / `caution` / `off_track`), an optional 0–10 confidence, a required written narrative, and an **immutable snapshot of every key result / target value at that moment** (with previous values, powering a diff view). Draft → publish lifecycle (drafts emit no activity, notifications or cadence advance), a time-boxed edit window, comments, reactions, and the acknowledgement. A goal's current health is derived from its latest published check-in (then overridden by staleness or a close outcome) — never edited directly.

### 3.5 The Work Map

One canonical, company-wide tree — goals → sub-goals → projects → work items — with a uniform derived contract at every node: status (including `outdated`), progress, next step, champion, timeframe. Filterable by space, person, status; every row deep-links. **This is the home screen.** Not a saved-query builder: one opinionated artifact.

### 3.6 Spaces, closing rituals, and the feed

**Spaces** are team homes: each department's goals, projects, documents and discussions with its own membership and access scope. **Closing** a goal or project is a ritual: it requires an outcome (`achieved` / `missed`) and creates a retrospective (a short structured "what happened / what we learned" artifact, AI-draftable, human-edited); both are reopenable. Every meaningful event lands in a **typed, human-readable activity feed** (company / space / goal / project / profile scopes) that is permission-filtered, reactable and commentable — separate from the compliance audit log.

## 4. Modules

### Pillar A — Strategy (P0; Phase 3)

- **Goals & key results (P0).** Objectives owned by the workspace, a space, or a person, inside a cycle, with an optional per-goal timeframe override (day/month/quarter/year granularity, human labels like "Q3 2026"). Key results as direction-aware numeric ranges (initial → target, increase/decrease) with unit, weight, confidence, value history, and links to the work that drives them. Alignment under a parent goal or a parent key result; cascade with cycle detection. Explicit close lifecycle (§3.6). Weighted scoring with a derived RAG color and the §3.1 status cascade. Discussions (titled threads), comments, reactions, watchers.
  - *Acceptance:* *Given* a member with goal-edit access in an active cycle, *when* they create a goal with champion, reviewer and two weighted KRs, *then* it appears in the explorer and Work Map at 0% / `pending`, its first check-in is scheduled for the next cadence day, and checking in a KR value recomputes progress and health live.
- **OKR cycles (P0).** Quarter/half/month/year cadences, auto-generated forward, an archive step, workspace thresholds (RAG bands, staleness grace, quotas) and label overrides ("objective" → your house term).
- **Check-ins (P0).** §3.4.
- **KPIs (P0).** Categories; per-KPI frequency (daily→yearly), unit, direction, targets and RAG thresholds; a keyboard-first grid of periods × KPIs; **calculated KPIs** from a typed formula over other KPIs with cross-frequency aggregation and cascade recompute; a parent/child tree; KPI↔KR links so a key result is measured by a live metric. *(This whole module is a differentiator: Operately has no KPI system.)*
- **Scorecard & snapshots (P1).** Per-owner, per-cycle rollup on archive; trends across cycles; export. The optional points layer ships **off by default** and is human-gated.

### Pillar B — Execution (P0/P1; Phase 4) — Operately-class core, opinionated, zero configuration engines

- **Projects (P0).** Lifecycle `active / paused / closed` with side effects (pausing pauses the cadence; closing requires a retrospective + outcome). Contributors with champion / reviewer / contributor roles and responsibility text. Health check-ins per §3.4 with acknowledgement and staleness. A description, resource hub, discussions, feed. A project may link to the goal(s) it serves.
- **Milestones (P0).** First-class: title, timeframe (contextual granularity), description, comment thread, completion via a comment-with-action, per-milestone board, and a derived project **next step** (earliest-due open milestone, documented tie-break).
- **Work items (P0).** The unit of work: title, rich description, **multiple assignees**, a fixed status vocabulary (`todo / in_progress / done / canceled`), due date (contextual), checklist, due-relative reminders (`before_due` / `on_due` / `overdue`), links to a key result / goal / KPI (progress flows upward), lightweight `blocks` relations with a cannot-complete-while-blocked guard, comments/reactions/watchers. FlowyTeam tasks import here.
- **Boards (P0).** Kanban per milestone or project keyed on status, drag with optimistic updates and live presence, concurrency-safe ordering (normalized against deleted/closed items).
- **Resource Hub (P0 docs/folders/files, P1 links polish).** Per space, project or goal: a browsable node tree of rich **documents** (draft → publish, version history with visual diff), **folders**, **files** (previews/thumbnails, quotas, optional virus scan), and typed external **links** (Google Doc / Figma / Notion, SSRF-safe metadata enrichment). Per-node comments, reactions, subscriptions; move/copy. *(Replaces both "wiki" and "documents" from the old plan.)*

### Pillar C — Collaboration & platform (P0; Phase 2 spine, wired per module)

- **Discussions & message boards (P0).** Titled rich-text threads per space (announcements) or anchored to a goal/project; draft → publish (drafts silent); one subscription model beneath all of it.
- **Comments, reactions, mentions (P0).** Polymorphic comments everywhere; reactions on all major subjects (comments, check-ins, goals, work items, milestones, docs, discussions); @mentions auto-subscribe, deliver immediately when opted, and are re-diffed on edit (un-mentioning stops notifying); comment deep-links with unread highlight; a compose-time "will notify X and N others" preview.
- **Subscriptions & notifications (P0).** Per-artifact subscriber lists (reason: invited/joined/mentioned) + per-user settings (per-reason routing, mention immediacy, digest window, daily-summary time in the user's own timezone). Delivery is **access-gated at send time** (losing access silently stops notifications). Email: immediate for direct mentions, otherwise coalesced into a per-user buffered batch or digest; a daily "your work today" assignments email; HTML+text per reason with a dev preview page. Suspended members, placeholders and AI principals are never notified.
- **Activity feed (P0).** §3.6 — typed events, scoped feeds, aggregation of consecutive edits, live updates.
- **People & org (P0).** Per-workspace member profiles (title, timezone, avatar, rich bio; self-vs-others edit rules), a **manager/reports-to chain** (cycle-safe), a people directory, suspend/restore, guest members with a convert-to-guest that strips prior access, invitations by email + reusable invite links (use counts, expiry, revoke, allowed domains) + trusted-domain auto-join.
- **Search & command palette (P0).** ⌘K everywhere: entity jump, actions, full-text search across goals, projects, work items, docs, discussions — permission-filtered. (Semantic search arrives with the AI layer.)
- **Exports & portability (P1).** CSV/XLSX export of any list; **workspace export/import** — a signed, encrypted, checksummed archive any admin can export and dry-run-import into any OpenOKR instance (self-host ↔ future cloud both ways).
- **Admin & settings (P0).** Workspace settings, members & access, strategy settings (cadence, thresholds, labels), notifications defaults, security (auth policy, sessions), branding, audit log view, the freeze/read-only switch, backups, demo builder.

### Pillar D — AI & agents (P0 native; Phase 5) — governed, local-capable, accountable

- **AI assists (P0).** In every module, as ✨ propose-then-confirm accelerators: draft/improve/rate an objective; suggest KRs, metrics, alignment parents; **draft the overdue check-in from real activity** (linked work-item movement, KR history); draft retrospectives and cycle summaries; suggest KPIs, targets, formulas from plain language; narrate KPI trends and flag anomalies; draft work items from a sentence; decompose a goal into work; summarize threads; draft/expand/summarize documents; grounded Q&A; natural-language filters.
- **Copilot (P0).** A side-panel assistant that answers grounded in workspace data (permission-filtered citations) and proposes actions for confirmation; long tool runs execute in the background and stream back.
- **AI teammates (P0, the headline).** Agent members (`kind: ai`) with a persona, phased planning/execution instructions, a provider/tier choice, and a schedule. They run unattended on the cadence: plan tasks, execute step by step (durable, resumable runs with readable logs), post check-in drafts, comments and updates into the same feeds and review inbox as humans. Safety by construction: a **least-privilege principal** scoped to named spaces/goals, **sandbox mode** (end-to-end dry runs), a **batch-approval inbox** (the agent works overnight; a human approves its proposed writes in the morning) or scoped direct-write policy, **hard cost caps** that halt runs, and full audit. Runs on local models for air-gapped installs.
- **MCP server (P0).** Any external agent (Claude, ChatGPT, Cursor, custom) drives OpenOKR as the authenticated user. **OAuth 2.1 is the primary auth** (authorization-code + PKCE, discovery, dynamic client registration/CIMD, refresh rotation with theft detection, consent + workspace picker); PATs remain for local stdio/scripts. Tool catalog spans both pillars with read/write/destructive safety classes, plus `search` + `fetch` for research connectors, resources and prompt templates.
- **Bring your own AI (P0).** Anthropic / OpenAI / OpenRouter / **Ollama** / any OpenAI-compatible endpoint (Google fast-follow); keys at deployment, workspace, or per-user level, envelope-encrypted with cheap key rotation; a validated model catalog with capability tiers; per-feature toggles; **per-token cost metering, quotas, and hard caps**; versioned prompts; privacy/egress controls; zero-egress guarantee on local providers.

## 5. Cross-cutting needs

- **Importers (P0, hard requirement):** (1) a **generic CSV/XLSX importer** for objectives, key results, KPIs + records, projects, and work items — template downloads, dry-run preview, per-row error report; (2) the **FlowyTeam importer** — read-only MySQL, `--company` selection, covering org units→spaces, cycles, objectives, KRs, check-ins, KPIs + records + formula translation, and tasks→work items with comments, files, watchers and **time logs preserved losslessly** in a read-only table (the time-tracking UI itself is post-v1, §6). Idempotent re-runs on `(workspace_id, legacy_type, legacy_id)`; dry-run report + reconciliation; derived values recomputed, never trusted.
- **UX quality bar (P0):** modern-tool feel — inline editing, optimistic updates with undo, ⌘K, dark mode, keyboard-first, responsive shell, live updates, stale-deploy reload toast. Binding spec: UIUX-PLAN.md; budgets: TECHNICAL-PLAN §13 (requirements, not aspirations).
- **Languages:** English (P0) and Bahasa Melayu (P1); i18n-ready architecture from day one (ICU catalogs, pseudo-locale CI check).
- **Accessibility:** WCAG 2.1 AA target; axe checks in CI on every screen spec; keyboard paths for all actions including drag alternatives. **[DECIDE]** whether a formal external audit is required.
- **Compliance:** PDPA (Malaysia) / GDPR-style handling — data export, erasure as **anonymization preserving authorship** (placeholder identity, audit event, machine-readable export), last-owner / last-site-admin invariants, PII minimization in logs.
- **Hosted SaaS (decided 2026-07-08): design now, build later.** The schema stays multi-tenant; the operator console (Phase 7) ships workspace inspect/suspend, feature flags, site messages, and **transparent, time-boxed support impersonation** (surfaced to the workspace owner). Billing/seat entitlements are designed behind a `BILLING_ENABLED` flag and built only if/when a cloud launches. Self-host is the v1 product and is never seat-limited.

## 6. The power floor — out of v1, designed-for (decision 2026-07-08)

Deferred to post-v1 phases; each keeps a design-for note in TECHNICAL-PLAN so v1 does not block it. In rough priority order:

1. Serverless / zero-ops cloud profile (Vercel + Supabase drivers, dual-profile CI).
2. Custom fields engine; configurable types/statuses/workflows; the saved-query DSL + view builder (table/board/calendar over one query).
3. Gantt + the automatic scheduling engine (dependencies, working days, cascades) — **spike-gated**; v1 uses contextual dates + simple rollups, which Operately proves is sufficient.
4. Time & cost tracking UI (v1 stores imported time logs read-only); budgets.
5. Backlogs / Scrum (sprints, points, burndown); meetings; project phases & gates; portfolios.
6. GitHub/GitLab integration; Slack/Teams notification channels; incoming email; calendar feeds.
7. Billing/entitlements + the hosted cloud; an OpenProject importer (demand-driven); real-time co-editing (CRDT); native mobile apps.

Also explicitly out of scope for v1: SCM/repository browsing, BIM, forums/news as separate modules (discussions + the Resource Hub cover them), byte-perfect legacy history import.

## 7. Non-functional requirements

- **Scale:** tens of thousands of members and ~1M work items + goals in one workspace. Keyset pagination, virtualization, and indexes-with-the-feature from day one (TECHNICAL-PLAN §13).
- **Performance feel:** Work Map and primary lists interactive < 2 s on a mid-range laptop against the large seeded dataset; saves feel instant (optimistic).
- **Data residency:** self-hosting satisfies in-country residency. No multi-region cloud requirement for v1.
- **Offline / air-gapped:** fully supported — no feature may hard-depend on an external SaaS; AI points at a local model or is off; telemetry opt-in; assets self-hosted.
- **Reliability:** scheduled encrypted backups with **CI-verified restore drills**; per-workspace logical restore via the portability engine; forward-only migrations + the data-change runner.

## 8. Success metrics

- **Leading:** a new team completes setup and posts its first goal check-in within 15 minutes of `docker compose up`; a FlowyTeam admin runs a dry-run import and reads a correct reconciliation report within one session; the review inbox drives ≥70% of check-ins submitted on time in the demo cohort.
- **Lagging:** N active self-hosted instances within 6 months of launch (**[DECIDE]** target N); at least a handful of real FlowyTeam/CSV migrations completed; at least one organisation running an AI teammate in batch-approval mode weekly.

## 9. Open questions (agent must raise, not guess)

- Product name; business model; SSO placement; license sign-off; enterprise gating set (PLAN.md §14).
- Formal accessibility audit? Target instance count N? Sector-specific compliance beyond PDPA/GDPR?
- AI open decisions (AI-NATIVE-PLAN §13), confirmed at P5-T00 — including the default autonomy policy for AI teammates (batch-approval vs scoped direct writes).
- Scorecard points layer: import FlowyTeam rewards/points history or start clean? (Points are off by default either way.)
