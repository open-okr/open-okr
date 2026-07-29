# How OpenOKR Can Beat Operately — Competitive Analysis & Plan Recommendations

*A critique of the OpenOKR development plan (`docs/development-plan/`) measured against **Operately** — the mature, shipped product this repository actually contains — with concrete recommendations to make OpenOKR superior in features, functionality, ease of use, security, and robustness.*

**How this document was produced.** Every subsystem of Operately's real source (Elixir/Phoenix backend under `app/lib/operately`, the `turboui` design system, the MCP/AI stack, deployment) was read directly, then measured against the OpenOKR plan docs. The result: **142 itemized gaps (17 critical, 46 high, 57 medium, 22 low)** plus four strategic deep-dives. The full itemized backing — every gap, every superiority idea, and the exact plan edits, grouped by document — is in the companion **[OPERATELY-GAP-REGISTER.md](OPERATELY-GAP-REGISTER.md)**. This file is the synthesis: what matters most, why, and what to do.

**A caveat on fairness.** Operately is a shipped product with 4,100+ commits; OpenOKR is a plan with 109 tasks, all `todo`. Comparing built code to a spec is inherently lopsided — the plan will always look "thinner" because nothing is built yet. This analysis therefore focuses on two fair questions: (1) where the *plan itself* has conceptual gaps or wrong bets that will hurt regardless of execution, and (2) where OpenOKR's chosen architecture can genuinely *surpass* Operately if the plan is corrected now. Operately observations are accurate as of the code review; a few may have moved with recent commits.

---

## 0. The one-paragraph verdict

The OpenOKR plan is unusually disciplined and well-written, and in several architectural dimensions (database-level tenant isolation, AI provider abstraction with bring-your-own-key and local models, envelope-encrypted secrets, append-only audit, accessibility and i18n rigor) it is genuinely ahead of what Operately ships. **But it is aimed at the wrong target.** The plan's "legacy system" is **OpenProject** (work management) plus **FlowyTeam** (OKR/KPI); it was scoped to reach *parity with those two tools and import their data*, and **it never analyzes Operately at all.** That produces two problems. First, the plan reproduces exactly the "infinite flexibility, zero guidance" configurable-PM model that Operately's own README positions against — it will ship a *toolkit*, not an *opinionated operating system*. Second, on the two features the plan treats as its headline differentiators — **AI agents** and the **MCP server** — Operately is materially *ahead of the plan*, having already shipped autonomous scheduled agents, agents-as-people, and a hardened OAuth 2.1 MCP server that the plan relegates to a footnote. To be superior, OpenOKR must (a) install Operately's opinionated "operating rhythm" as its default product, (b) stop under-specifying the agent/MCP surface it is behind on and adopt Operately's proven patterns, (c) keep and harden the real architectural advantages it does have, and (d) confront an honest scope/sizing/sequencing reckoning — including a deliberate build-vs-fork decision — before writing code.

---

## Table of contents

- [Part 1 — Strategic reckoning (decide these before any code)](#part-1--strategic-reckoning-decide-these-before-any-code)
- [Part 2 — The product-philosophy gap: operating system vs. configurable PM tool](#part-2--the-product-philosophy-gap-operating-system-vs-configurable-pm-tool)
- [Part 3 — Feature & functionality gaps](#part-3--feature--functionality-gaps)
- [Part 4 — Security & robustness](#part-4--security--robustness)
- [Part 5 — Ease of use](#part-5--ease-of-use)
- [Part 6 — Where OpenOKR can genuinely be superior (bank these)](#part-6--where-openokr-can-genuinely-be-superior-bank-these)
- [Part 7 — Engineering practice & robustness of the build itself](#part-7--engineering-practice--robustness-of-the-build-itself)
- [Part 8 — Prioritized action list & re-sequenced roadmap](#part-8--prioritized-action-list--re-sequenced-roadmap)
- [Appendix — Corrections to specific plan documents](#appendix--corrections-to-specific-plan-documents)

---

## Part 1 — Strategic reckoning (decide these before any code)

These are the findings that change *what you build*, not just *how*. They dominate everything downstream.

### 1.1 The target mismatch — you are benchmarking the wrong competitor

The stated goal is "better than Operately," but the plan's entire competitive frame is OpenProject + FlowyTeam. The "beat the legacy tool" scorecard (`TECHNICAL-PLAN.md §15`) measures against OpenProject's Angular UI, its lack of RLS, its single global API key, its heavy first load. **All of those are easy wins that Operately already banked years ago.** Beating OpenProject in 2026 is not the same as beating Operately, and much of the plan's scope (a serialized-YAML query importer, nested-set trees, OpenProject journal history, a full MS-Project-class scheduling engine) is effort spent *courting OpenProject/FlowyTeam refugees* rather than *out-competing Operately*.

**What to do:** rewrite the `§15` scorecard to benchmark against **Operately** — the Work Map, the weekly check-in rhythm, champion/reviewer accountability, the Resource Hub, agents-as-people, the MCP OAuth server. Most of Part 2 and Part 3 below is the content of that corrected scorecard.

### 1.2 Build-vs-fork was never decided — decide it in writing

The plan defaulted into greenfield without ever evaluating the obvious alternative: **Operately is open source and self-hostable, and already implements ~90% of the strategy pillar and a hardened MCP/agent stack.** A source count of what a greenfield build must re-earn before it reaches its *own namesake feature* (OKRs, Phase 4): ~305 typed RPC endpoints, ~96 domain schemas, ~95 transactional operations, 127 activity types, 432 migrations, 515 TurboUI components, 800+ test files. The plan is 109 unestimated, strictly-sequential, human-merged-one-at-a-time tasks with no schedule and no staffing — and it front-loads the entire OpenProject-parity pillar (34 tasks) *before* the OKR product that is the reason to exist.

This is the single highest-leverage decision in the whole effort. Three honest options:

| Option | What you inherit day one | Cost | When it's right |
|---|---|---|---|
| **Fork Operately** (Elixir/Phoenix + TurboUI) and extend | Access model, activities engine, ~300 RPC endpoints, 515 components, 800 tests, a shipped MCP+OAuth server, autonomous agents | Learn Elixir; live within Operately's architecture; Operately is Apache-2.0 so this is legally clean | The real goal is a *better OKR/operating-system product* and there is no hard mandate forcing a rewrite |
| **Greenfield on Next.js/TS** (the current plan) | Nothing — re-earn all of the above | Multi-engineer-months-to-year+ before the OKR product exists; every hard subsystem reinvented | A hard constraint genuinely forbids Elixir (team skillset, a Next.js/TS mandate, a licensing goal AGPL-over-Apache) |
| **Narrow greenfield** — thin strategy-first slice, cut OpenProject parity | A focused OKR + operating-rhythm product, fast | Gives up "full PM tool" ambitions in v1 | You want to prove the *differentiator* (opinionated OKR system) before building generic PM breadth |

**What to do:** add a `[DECIDE]` to `REQUIREMENTS.md §8` — *"Build vs. fork, measured against Operately"* — and answer it explicitly. If greenfield proceeds, state the hard constraint that justifies it in writing and accept the multi-year cost. Note that Operately being **Apache-2.0** makes forking legally trivial, whereas the plan's own **AGPL-3.0** choice would apply going forward to a fork. Everything else in this document applies regardless of the answer — but the answer changes the size of the prize.

### 1.3 Scope is under-estimated; several architectural bets are heavier than the plan admits

Even holding greenfield fixed, five plan bets each carry more risk/cost than their single-task framing implies. Each has a cheaper path Operately's shipped code actually demonstrates.

1. **RLS-on-every-table via a session GUC.** Presented as strictly safer than "app-code only." But (a) it only expresses the *tenant* boundary — per-object view/comment/edit still needs an app layer, so you pay for RLS *and* still build authorization; and (b) a session GUC interacts badly with the plan's *own* serverless bet: transaction-pooled connections (PgBouncer/Supavisor) are the classic place a leaked `app.workspace_id` crosses tenants. **Keep RLS as a tenant *floor*, set via `SET LOCAL` inside every transaction, with the app role denied `BYPASSRLS` and a CI test that an unset-GUC connection returns zero rows — but do not treat RLS as the authorization model.** (See §4.1.)
2. **Dual container/serverless runtime parity, CI on both, every task.** This roughly doubles the platform surface and is worst exactly where it hurts: jobs (pg-boss vs Inngest), realtime (LISTEN/NOTIFY vs Supabase — LISTEN/NOTIFY does not survive transaction poolers), and transactional integrity. Operately ships one operational model (Oban on Postgres) and is fine. **Pick one primary runtime for v1 (container + Postgres-backed queue), keep the adapter interfaces, and drop the dual-profile CI mandate until after v1.**
3. **The scheduling engine (`P3-T10`).** A full constraint solver (working days, lag, manual/auto modes, parent rollups, cascade reschedule) whose "golden masters" reverse-engineer OpenProject's undocumented Rails-callback semantics. Operately ships a successful goals+projects product with *no such engine* (contextual dates + simple rollups). **Timebox it as a research spike; ship v1 without automatic dependency propagation; do not gate the strategy pillar on it.**
4. **Two bespoke importers** (OpenProject serialized-YAML/journals/nested-sets + FlowyTeam MySQL). Among the most expensive, least-testable work in the plan, and none of it advances the "beat Operately" goal. **Replace with a generic CSV/XLSX importer for v1; keep only the FlowyTeam OKR mappers if that is genuinely the user's own data; drop the OpenProject importer.**
5. **The two "pure engines" are bigger than one task each.** The OKR scoring engine is a *precedence cascade* (success → outdated → confidence), not a formula (see §2.1), and the KPI formula engine is a small spreadsheet recalc engine. **Split `P4-T04` and `P4-T08`; port Operately's already-validated status/progress logic as the reference spec rather than re-deriving from FlowyTeam.**

**What to do:** add a **sizing pass** (t-shirt estimates + critical path), split the mega-tasks (`P3-T05`, `P3-T08`, `P3-T10`, `P4-T04`, `P4-T08`, `P5-T06`, `P5-T09`), add a **risk register** with a kill/simplify criterion per bet, and add **spike tasks with go/no-go gates** before the two engines and the RLS+serverless combination.

### 1.4 Re-sequence so the differentiator ships first

Phases run "strictly in sequence," so the OKR product (Phase 4) sits behind the entire 34-task OpenProject-parity pillar (Phase 3). You cannot demo or validate your core value proposition until ~46 tasks are built and merged one-at-a-time through a single human reviewer. **Re-sequence to a thin end-to-end strategy slice early** — workspaces + auth + minimal objectives/KRs/check-ins with the operating rhythm — *before* the heavy work-management pillar. Treat Gantt, backlogs, custom fields, and the scheduling engine as back-half/optional scope.

---

## Part 2 — The product-philosophy gap: operating system vs. configurable PM tool

This is the most important section for actually *beating* Operately, and it is where the plan is most blind — because it never looked at Operately. Operately's README makes its thesis explicit: *"Traditional work management tools give you infinite flexibility but zero guidance on how to actually run an organization… Unlike Notion or ClickUp that let you build anything but leave you to figure out execution, Operately comes with proven workflows built in."* **The moat is not features — it is a thin layer of *opinion*, encoded in code.** The OpenOKR plan, by leading with configurable types/statuses/workflows, custom fields, and a JSON query DSL, is walking straight into the ClickUp/Notion trap the README names.

Six pieces of that opinion are missing from the plan. Together they *are* the operating system. **All six should move from P1/P2 fast-follow into the core strategy pillar.**

### 2.1 An operating-rhythm / cadence engine (the single biggest philosophical gap)

Operately hard-codes a company rhythm. `Operately.Time.calculate_next_weekly_check_in/2` advances a goal's `next_update_scheduled_at` to the next Friday after every check-in; `outdated?/1` flips a goal to a visible **"outdated"** state when a check-in is missed by >3 days; and — critically — `Goal.status/1` is a **precedence cascade**, not a formula: `success_status → success? → outdated? → last_check_in_status → pending`. Staleness *overrides* the last self-reported health. The plan, by contrast, derives status **purely from a confidence number** (`TECHNICAL-PLAN §6.2 step 5`) with no decay and no enforcement — a neglected objective keeps its last green forever. And `IMPLEMENTATION-PLAN P4-T14` already fires a notification for "confidence 1-4 or **overdue**" — referencing an "overdue" concept that *no schema field or engine rule defines*.

**Fix:** make **Cadence** a first-class Phase-4 primitive. Every goal and project gets a check-in frequency with an opinionated default (weekly, anchored to a company-chosen day), on by default at creation, with no "no cadence" state. The system stores `next_check_in_at`, computes it (honoring workspace timezone and the ±1-day on-time tolerance from `time.ex`), and derives an **`outdated`** status that sits *above* confidence in the `§6.2` cascade and overrides self-reported health in every list, the Work Map, and dashboards. Rewrite `§6.2 step 5` as a precedence cascade: `achieved/missed → outdated → confidence bucket → not_tracked`.

### 2.2 A champion/reviewer accountability contract with a mandatory acknowledgement loop

In Operately every goal has exactly one **champion** (accountable owner) *and* one **reviewer**, distinct from RBAC. Check-ins aren't just posted — the reviewer must **acknowledge** them (`acknowledged_by_id`/`acknowledged_at`), and an unacknowledged check-in becomes a *reviewer assignment* in that person's inbox (with reviewer-change history so a new reviewer isn't asked to ack old check-ins). This is a two-sided social contract: someone owns it, someone reviews it, progress isn't "done" until acknowledged. The plan has generic RBAC roles and a single `lead_id?` — a *permissions* model, not an *accountability* model.

**Fix:** make champion and reviewer required first-class fields on every goal and project (distinct from roles/assignees). Make a check-in a review artifact with a state machine: `published → awaiting-acknowledgement → acknowledged`. Wire acknowledgement into notifications and the review inbox as an obligation. Rebind object access atomically when champion/reviewer changes.

### 2.3 A personal "what do I owe right now" review inbox

`Operately.Assignments.*` computes, per person, a live list of obligations — check-ins due (as owner), acknowledgements owed (as reviewer), tasks/milestones due — grouped `due_soon`/`needs_review`/`upcoming`, sorted overdue-first, with action labels ("Submit weekly check-in") and human due-status ("Overdue by 3 days"). This is the surface that makes the rhythm self-enforcing. The plan offers a generic notifications inbox, dashboards, and favorites — *notifications tell you what happened; they don't tell you what you personally owe and are late on.* Nothing in the plan derives obligations from cadence + role.

**Fix:** build a **"Review / My Assignments"** page as a core Phase 2–4 surface: a server-computed, overdue-first list of the current user's obligations with one-click actions, driving a badge count. Cheap once cadence + champion/reviewer exist; it is the feature that operationally distinguishes an operating system from a task tracker.

### 2.4 Check-in as a structured narrative object, not a status field

An Operately check-in is a rich object: a small fixed status vocabulary (`on_track`/`caution`/`off_track`), a required written narrative (rich content), an **immutable embedded snapshot of all target values and checklist state at that moment** (for diffing), reactions, comments, a subscription list, and the acknowledgement. The goal's current health is *derived from its latest check-in*, not edited independently. The plan lists "check-ins, confidence, RAG" as data attributes — a RAG field is just a color. Operately also supports **draft → publish** with side-effect suppression (a draft emits no activity/notification, doesn't advance scheduling), time-boxed edits, and pointer rollback on delete.

**Fix:** model the check-in as a first-class timestamped artifact that snapshots KR/target values (with `previous_value` for a diff view), carries a required narrative, has a fixed 3–4-value status vocabulary, and supports draft/published + comments/reactions/acknowledgement. Derive goal health from the latest check-in. (`TECHNICAL-PLAN §4.12.5`, `UIUX-PLAN S-21`.)

### 2.5 The Work Map as the opinionated home screen

Operately's `WorkMap` coerces goals, sub-goals, projects, and tasks into **one `WorkMapItem` contract** (status / state / next_step / progress) arranged as a single company-wide tree with health, owner, and timeframe at every node — the literal "this is your whole company on one page, and is it healthy." This is the embodiment of the plan's *own* headline thesis ("strategy and execution in one place"). Yet the plan splits its UI into an OKR explorer (`S-16`) + an alignment diagram (`S-18`) for objectives *only*, with work packages living in separate tables/boards/Gantt. There is no single navigable tree that nests objectives → sub-objectives → linked projects → work packages with rolled-up status/next-step.

**Fix:** ship the **Work Map as a named, opinionated default view (the home screen)** — the full goal→project→task tree with health/owner/next-step/progress rolled up at every level, spanning both pillars, RLS-filtered, virtualized to the plan's 1M-item budget. Unify goals/projects/work-packages under one derived-status interface. This — not saved queries — is the app's front door, and it is a chance to *beat* Operately by including full work packages and Gantt in the tree, not just lightweight tasks.

### 2.6 Autonomous, accountable AI teammates (not just a copilot)

This is both a philosophy gap *and* the place the plan is most surprised to be behind (see §3/§4). Operately's agents are **team members, not assistants**: `Person.type` is `[:human, :guest, :ai]`; an AI person owns an `AgentDef` with a persona and `planning_instructions`/`task_execution_instructions`; `Operately.AI.Cron` runs `daily_run` agents unattended every workday; and `AgentRun` is a durable plan→execute state machine on Oban that writes to goals/projects on its own. The plan's AI (`AI-NATIVE-PLAN`) is a *tool layer you invoke* — per-module assists + a human-in-the-loop copilot. Its principles 2 and 4 ("the agent is the user," "writes are proposed then confirmed") *architecturally forbid* the autonomous category Operately already ships.

**Fix:** add an **AI-teammate** concept — an agent is a `person.kind = 'ai'` member with an agent-definition record (persona, phased instructions, provider), can be assigned as champion/contributor, runs autonomously on the operating cadence, and posts check-ins/comments into the same feeds and review inbox as humans. Reframe principle 4 from an absolute into a per-mode policy: interactive copilot actions confirm; a configured autonomous agent executes within a **least-privilege agent principal** (fixing Operately's over-broad company-wide grant), under a **hard cost cap** and full audit, with a **sandbox/dry-run** mode and optional **batch-approval** inbox. This lets you keep the plan's safety posture *and* the autonomy — and beat Operately, which has zero cost metering on its agent path and hardcodes cloud providers.

> **Also missing from the "operating system" identity:** first-class **Spaces** as team homes (goals + projects + docs + members per department), and a **mandatory retrospective** baked into the goal/project *close* ritual (Operately generates the retrospective from the `goal_closing`/`project_closed` activity). Add both.

---

## Part 3 — Feature & functionality gaps

Beyond the philosophy layer, the plan is missing or under-building whole feature areas Operately ships. The most consequential:

### 3.1 Goals / OKR lifecycle
- **No explicit close outcome.** An objective is "completed" only if someone sets confidence ≥9 — there is no close action, no **achieved-vs-missed** distinction, no per-objective retrospective, no reopen. Add `closed_at`/`closed_by_id`/`success_status(achieved|missed)` and put `success_status` at the top of the status cascade.
- **Objectives locked to a rigid shared cycle.** Operately goals carry a flexible per-goal contextual timeframe (day/month/quarter/year granularity, validated human labels like "Q3 2025"). A 6-week objective can't be expressed in the plan. Add an optional per-objective timeframe override that defaults to cycle bounds.
- **Thin goal discussions & privacy.** Operately has titled discussion threads and a 4-tier derived privacy (public/internal/confidential/secret) with per-person membership; the plan reuses flat comments and a `me/manager/team/everyone` share enum with no named tiers.

### 3.2 Projects, milestones, tasks
- **No project check-ins / health / operating cadence** — the plan check-ins *only* OKRs. Projects carry a free-text `status` with no health enum, cadence, acknowledgement, or overdue detection. This is Operately's core operating rhythm and it is entirely absent for projects. **(Critical.)**
- **No retrospectives** on project close; **no champion/reviewer** on projects; **no pause/resume** lifecycle with a success outcome.
- **Single assignee per work package** — a regression vs Operately's multi-assignee tasks. Make `assignee_id` a join table (with a designated primary).
- **Thin milestones** (modeled as OpenProject "versions"): no comment threads, no per-milestone board, no computed project "next step." Enrich them.
- **Absolute-time reminders only** — Operately has due-relative reminders (`before_due`/`overdue`) validated against a due date. Add a `kind` + offset.

### 3.3 Resource Hub (documents, files, folders, links)
Operately's Resource Hub is a first-class, browsable node tree (`document`/`folder`/`file`/`link`) that can attach to a **space, project, or goal**, with per-node comments/reactions/subscriptions, draft→publish for docs, typed external links (Figma/Google/Notion), file previews/thumbnails, storage-quota accounting, and ~17 MCP tools. The plan has only **flat `attachments`** + a P2 flat `documents` register + a project-scoped wiki. **There is no folder tree, no docs/files hub, and goals/teams cannot own a library at all.** This is an entire Operately subsystem absent from the plan. Add a `resource_nodes` tree wired to the FileStorage adapter and the polymorphic comments/reactions the plan already has.

### 3.4 Activity feed, subscriptions, notifications, digests
- **The activity feed engine is missing.** Operately serves five permission-filtered feed scopes (company/space/project/goal/profile) from one activities table, each row carrying an access scope; the plan's `activities` table has **no access-scope column** and RLS is workspace-only, so the promised Home/project feeds are *either unbuildable or leak across private projects*. Add a scope column + a feed engine with per-requester permission filtering, keyset pagination, soft-delete hiding, and consecutive-edit aggregation.
- **Activities are field-diffs, not typed semantic events.** Operately has ~127 typed action events, each with a validated content schema and a renderer, producing a human-readable log. The plan's `kind + from/to` diffs will render as a diff dump. Define a typed event catalog with per-event renderers, driven by one registry (see §6).
- **No generic subscription/watcher model.** Only `work_package_watchers` exists, yet objectives/wiki show a "watch" action. Add a polymorphic `subscriptions` table (subject + user + reason: watched/mentioned/assigned/joined) with author-exclusion.
- **The email/digest engine is a "stub."** Operately routes each notification `no-email / immediate / buffered`, coalesces buffered ones into a per-user time-windowed batch (locking the person row to avoid race duplicates), delivers a **per-user-local-time daily summary** (SQL against `pg_timezone_names`, DST-correct), and ships ~85 per-action HTML+text email templates with a preview harness. The plan under-designs all of this and never gates recipients on *current* access at send time (a departed member keeps getting notified). Promote batching from "scaffold" to a designed P2 deliverable; access-gate recipients; add the daily "your work today" assignments email.
- **Reactions restricted to comments** though the table is polymorphic — Operately reacts on 11 entity types. Just widen the enumeration.

### 3.5 People, org chart, portability
- **No manager/reports-to relationship** — yet "manager review" and `scope='manager'` are used in three places (check-ins, kpi_shares, objective access). The features can't be built as written. Add a cycle-safe `manager_id` on the per-workspace membership.
- **No member suspend/reactivate** (soft-offboarding) — `P7-T03` SCIM "deactivate" has no state to map to, and authorship preservation on deletion is unspecified. Add a suspended state + anonymize-on-delete + last-owner/last-admin invariants.
- **No reusable/self-service invite links or trusted email domains** — the plan has only invite-by-email.
- **No workspace-to-workspace export/import** — see §6.5.
- **Multi-workspace identity is claimed but unbuilt** — profile attributes are global and there's no workspace switcher, contradicting the "future cloud with many workspaces" goal. Decide: v1 single-workspace, or move title/manager/avatar/prefs onto per-workspace membership.

### 3.6 The AI/MCP surface — you are behind, not ahead
The plan treats the inbound **MCP server** and **agents** as its differentiators. In reality:
- Operately ships a **~102-tool MCP server** whose tools call the same permission-checked domain path as the UI (the plan's "one definition, three consumers" idea, *already realized in production*), with per-tool `read/write/destructive` safety classifications and scopes, plus `search`+`fetch` tools for ChatGPT/Claude connectors. The plan's example set is ~9 write tools with only a `readOnly` boolean.
- Operately ships a **standards-complete OAuth 2.1 authorization server** (PKCE-S256, refresh-token rotation with reuse-detection lineage revocation, RFC 8707 resource indicators, RFC 9728/8414/OpenID discovery, CIMD dynamic clients with SSRF-safe fetch, consent + workspace picker, tokens hashed at rest). The plan makes **scoped PAT paste the primary auth** and OAuth "where the client supports it" — **which means hosted connectors (ChatGPT, Claude.ai, Cursor) literally cannot onboard.** (Multiple independent reviews flagged this — it is the clearest place the plan is behind.)
- Operately ships **autonomous scheduled agents** and **agents-as-people** (see §2.6).

**Where the plan genuinely leads on AI** (bank these — Operately has not shipped them): the **provider abstraction** (Anthropic/OpenAI/Google/OpenRouter/**Ollama**/openai-compatible), **BYO-key** at deployment/workspace/user with envelope encryption, **model catalog + tier routing**, **cost/token metering + hard caps + per-feature toggles + versioned prompts**, **pgvector RAG**, and the **`AI_PROVIDER=off` degradation** discipline. Operately is env-key-only, two providers, no metering, no local model, no RAG.

**Fix:** invert the AI plan's emphasis. Stop re-specifying (shallowly) the MCP tool server and OAuth flow Operately already runs — **adopt Operately's shipped patterns as the reference design** (OAuth 2.1 primary, full discovery + rotation + resource indicators + CIMD, safety-classified tool catalog, agents-as-people, plan/execute autonomy). **Concentrate original effort on the provider/governance/RAG/air-gap layer, which is your real, unbuilt advantage.** (Full itemized list: register §9, §10, §11, §14.)

---

## Part 4 — Security & robustness

The plan's security *posture* is strong on paper and, done right, can beat Operately. But it makes two architecture bets that are weaker than Operately's shipped design, and it enlarges the agent attack surface without a stated defense. These are the highest-leverage corrections.

### 4.1 Authorization: keep RLS as a floor, add a relationship layer, funnel one `can()`
Operately implements a **ReBAC/Zanzibar-style model**: `access_contexts` + `access_bindings` (continuous levels: view 10 / comment 40 / edit 70 / admin 90 / full 100, with `:champion`/`:reviewer` tags) + `access_groups` (per-person / company-wide / space-wide). Effective access is `max(level)` over all reachable bindings; **privacy tiers are *derived* from which group tier has a binding**; and every read funnels through one chokepoint (`Repo.Getter` / `Access.Filters`) that returns **not-found on forbidden** (no existence oracle). The plan's coarse RBAC roles **cannot natively express** per-object sharing, inherited space access, anonymous/public links, or champion/reviewer grants — and its RLS is workspace-only, so *within-tenant* object visibility (private projects, confidential objectives) depends on remembering an app-code filter at each read site, **the exact "isolation is app-code only" weakness the plan criticizes OpenProject for, one grain finer.**

**Fix:** do **not** ship pure RBAC. Keep RLS as the *tenant floor* and add a relationship/binding authorization layer on top (port Operately's triple, or use OpenFGA/SpiceDB), enforced through a **single core `can()`** invoked identically by tRPC, REST, MCP, and the realtime mutation path. Route every read through **one mandatory access-aware fetch helper** (a `Getter` analog) that fails closed, with a CI lint that authz-scoped tables can't be read outside it. Specify effective-permission composition (union, most-permissive-wins, dedup across paths) and require **suspended/inactive users to be excluded from every authz join** (Operately treats `is_nil(suspended_at)` as load-bearing everywhere; the plan never states it). Add a workspace **read-only/frozen overlay** (Operately's recoverable billing lockdown, generalized to maintenance/incident/cutover).

### 4.2 Write-path integrity: a transactional Operations pattern + a transactional outbox
Every Operately mutation is **one `Ecto.Multi` in one transaction**: domain write + access bindings + activity(audit) + notification enqueue — so a committed change *cannot* lack its audit row, ACLs are born with the resource, and audit can't drift from state. Notification dispatch is an Oban job **enqueued inside that transaction** (Oban shares the repo) — a true transactional outbox. The plan's tRPC + Server Actions + **adapter-based** JobQueue/Realtime/Mailer breaks this: on `RUNTIME=serverless`, Inngest/Supabase are external HTTP calls that *cannot* join the Postgres transaction, so **notifications/emails can fire for a rolled-back write or be lost for a committed one**, and audit becomes a fire-and-forget side effect.

**Fix:** (a) specify a canonical **Operation/command abstraction** in `packages/core` — each write runs in one Drizzle transaction with *structural* validate → mutate → audit → activity → outbox steps (not optional calls), with a CI check that mutating procedures go through an Operation. (b) Add a first-class **`outbox` table**: `enqueue = insert an outbox row in the caller's transaction`; a relay drains committed rows to JobQueue/Realtime/Mailer after commit (at-least-once, idempotency keys). Make "transactional enqueue" part of the JobQueue port contract; forbid direct HTTP enqueue on the write path. This gives you Operately's integrity guarantee *on both runtimes* — including the serverless tier where Operately's Oban trick is impossible. (See register §15.)

### 4.3 Audit: fold it in-transaction, then beat Operately with tamper-evidence
Once audit is written in the same transaction (4.2), you can surpass Operately: Operately's audit *is* its mutable `activities` table (app code can UPDATE/DELETE, content is a schemaless map). OpenOKR already separates an **append-only `audit_events`** (no UPDATE/DELETE grants). Add a **per-tenant hash chain + periodic signed checkpoint** for provable tamper-evidence, a **typed Zod-validated content schema per event** (queryable + verifiable, vs free-form JSON), and **ACL-scoped audit reads** (you only see audit for resources you can access). Apply the same append-only grant posture to the activities feed for a stronger compliance story than Operately can structurally offer.

### 4.4 MCP / agent attack surface — copy Operately's hardening, then add your own
Operately's MCP grants the agent **no new authority** — write tools run the same `can()` path as humans, scopes are enforced at the controller *and* advertised per tool, sessions are grant-bound, Origin is validated (DNS-rebinding defense), errors are sanitized, and membership revocation revokes the grant. The plan exposes a *larger* surface — autonomous agents, one-def-three-surfaces, BYO/local models, RAG — but says **nothing** about ambient authority for autonomous runs, prompt-injection from retrieved content, confused-deputy across the shared registry, or human-in-the-loop for destructive tools.

**Fix:** mandate that every agent/MCP/tool call executes under a concrete least-privilege principal through the shared `can()` (no ambient authority, ever); enforce authz + Zod validation in the **shared tool-registry layer** so the three surfaces can't diverge; classify tools `read/write/destructive` and gate destructive autonomous actions behind an elevated scope + confirmation; treat all RAG/retrieved/model output as **untrusted** for injection; SSRF-allowlist BYO/local egress; and copy Operately's grant-bound sessions, Origin validation, and revoke-on-membership-loss. For the OAuth server itself, **copy Operately's implementation verbatim** rather than re-deriving on Better Auth (PKCE-S256, resource-indicator binding checked on issue and every use, short access-token TTL, refresh rotation with lineage revocation on reuse, hashed tokens at rest). (Full detail: register §9, §10, §11, §14, and strategic security deep-dive.)

### 4.5 Cheap security wins Operately lacks — take them
- **Hash session tokens at rest** (Operately stores them raw, rationalized by the signed cookie — a DB read-leak is a session-hijack there; not for you).
- **Pull passkeys/TOTP earlier** (Phase 2, not the P7 enterprise pack) so the "passkeys first-class" launch claim is actually true.
- **RLS property/fuzz tests** — a capability Operately structurally cannot have: generate random cross-tenant access attempts across every table and assert zero leakage; assert that dropping any RLS policy fails the isolation test.
- **Time-boxed, audited, *tenant-visible* support impersonation** (Operately's is invisible to the customer — surface it in the owner's inbox as a trust differentiator).

### 4.6 Rich-text storage contradicts the plan's own co-edit mandate — and is an XSS risk
The plan stores rich text as **Markdown** (`DATABASE.md`, `TECHNICAL-PLAN §4/§4.6`), which directly contradicts `PLAN.md §7 rule 1` ("structured JSON with a version column, never opaque blobs") and is a poor Yjs/CRDT target. Operately keeps **ProseMirror JSON as the source of truth**, with stable node-level IDs that are load-bearing for mention notifications and import ref-rewriting; Markdown is a one-way, explicitly-lossy derived view. Storing Markdown forces a lossy JSON↔MD round-trip on every save/load and loses those IDs. There is also **no HTML-sanitization strategy** anywhere, despite the importer converting *untrusted* HTML→Markdown — a stored-XSS vector across a multi-tenant surface.

**Fix:** store canonical **structured JSON** with a `version int` (as `PLAN.md §7` already requires); demote Markdown to a derived view for import/export/AI-authoring with round-trip golden tests. Add a rich-text rendering-safety section: allowlist renderer, no raw-HTML passthrough, output sanitization at every surface (app, email, exports), imported content treated as untrusted, CSP as defense-in-depth only. Define the canonical `@mention`/`##id`/attachment token form + the single extraction API used by notifications, import rewrite, and search.

---

## Part 5 — Ease of use

Operately's ease-of-use edge is *opinion* (covered in Part 2 — the rhythm, the review inbox, the Work Map home, fixed vocabularies instead of configuration). Beyond that:

- **Lead with the opinionated path, gate configuration behind "advanced."** The plan's IA leads with configurable types/statuses/workflows, custom fields, and a query DSL — the ClickUp trap. Ship **one opinionated default methodology** (OKR + weekly check-in + champion/reviewer) as a zero-config out-of-box experience; treat custom fields/workflows/query-DSL as an explicit advanced/enterprise floor.
- **Ship a browser first-run setup wizard** instead of (or over) a shell installer — the app is a web app; detect an unconfigured instance, generate + persist all secrets, test DB/mail/AI connections live, seed admin + optional demo. Dramatically easier than `install.sh` for non-experts and works identically across all deploy targets. (Operately ships a good shell installer; a web wizard beats it.)
- **Make the demo a product feature, not a dev seed.** `P2-T10` is a `pnpm db:seed`; the promised in-product "Explore with demo data" has no gating flag and no notification-suppression. Promote to an in-app demo-workspace builder (gated env, one transaction, notifications/emails suppressed) covering OKRs+KPIs+work+check-ins so evaluators see the strategy↔execution join.
- **AI-summarized, importance-ranked digests** instead of a flat list of rows — cluster near-duplicate notifications via embeddings, summarize "what changed and why," and let users set digest windows, per-thread mute/snooze, and quiet hours.
- **Compose-time "who will be notified" preview** and comment-level deep-links with unread highlight — small polish Operately has that removes surprise.

---

## Part 6 — Where OpenOKR can genuinely be superior (bank these)

These are real, defensible advantages the plan's architecture enables that Operately does not have. Keep them — but make each *real* (code + tests), not aspirational.

1. **Database-enforced isolation done right.** RLS as a tenant floor *plus* (superiority move) object-level RLS predicates keyed on a per-request principal GUC — so within-tenant object leaks are impossible even with an app bug. Operately's isolation is app-code-only; a forgotten filter leaks. Add RLS property/fuzz tests Operately structurally cannot write.
2. **AI governance + provider freedom + air-gap.** BYO-key (deployment/workspace/user) with envelope encryption + cheap master-key rotation (re-wrap per-secret data keys, key-ring for zero downtime), tiered model routing, real per-token cost metering with hard caps and per-feature toggles, and **local models (Ollama) for a genuine offline tier.** This is the plan's strongest original contribution and should be the AI *headline* — Operately is two cloud providers, env-key-only, no metering.
3. **Autonomous, accountable AI teammates on a least-privilege principal + RLS.** Adopt Operately's agents-as-people and plan/execute autonomy, but fix its over-broad company-wide agent grant with scoped RLS + hard cost caps + sandbox + batch-approval. Air-gapped autonomous agents on local models is a capability Operately cannot match.
4. **Tamper-evident, typed, semantically-searchable audit.** Append-only + hash-chain + Zod-typed content + pgvector-indexed, so the copilot can answer "who changed this objective's target last quarter and why." Operately's audit is a mutable, schemaless feed.
5. **First-class, self-serve, RLS-native workspace portability.** A signed/encrypted/checksummed workspace archive that any admin can export and dry-run-import into any OpenOKR instance — deterministic because every table already has `workspace_id` + uuid v7 + `legacy_id` provenance. Operately's company-transfer is owner-gated, opaque, and visibly fragile; you can make portability an everyday backup/clone/move-to-cloud feature.
6. **Standard OpenAPI → generated SDKs + a zero-code CLI, from one contract.** Publish OpenAPI 3.1 so any consumer gets typed SDKs and Swagger/Redoc for free, and generate a first-party CLI from it (Operately's `catalog.json` is private and only feeds its own CLI). Wire a CI drift check so tRPC/REST/MCP/CLI/OpenAPI cannot diverge — a single source of truth the plan should declare in `packages/core`.
7. **RSC streaming first paint** for a faster cold load than Operately's client-rendered SPA, and **performance budgets enforced in CI** at university scale.
8. **WCAG 2.1 AA + ICU i18n as day-one CI gates** — Operately does not emphasize either.

---

## Part 7 — Engineering practice & robustness of the build itself

Operately's maturity is not just features — it's hard-won engineering discipline the plan under-specifies. These make the *build* robust.

- **A test-data factory that builds through domain services** (so RLS/`can()` wiring is exercised by setup) — not raw inserts. With RLS, a raw-insert factory can silently create policy-violating rows that hide authorization regressions.
- **A real E2E DB-isolation strategy under RLS.** `TECHNICAL-PLAN §10` says nothing about how tests reset state or set the `app.workspace_id` GUC per test. Vitest transaction-rollback isolation *does not reach* Playwright's separate connection — you need per-worker DB/schema + truncate or a template-DB reset. This is a flakiness minefield with RLS + optimistic UI + realtime + async jobs; make it a P1 task.
- **A flaky-test policy** (retries + trace, merged report, quarantine) — Operately has a whole retry engine; the plan mentions none.
- **Out-of-process MCP/REST e2e that drives the real OAuth/PKCE transport** and asserts `can()`+RLS actually deny under-privileged tool calls — otherwise the headline "every tool call passes can()+RLS" claim is never machine-checked. `P5-T10`'s mock-provider evals don't touch the real transport.
- **CI that scales:** Turborepo affected-graph + remote cache + sharding + auto-cancel — "full suite on both profiles every PR" won't scale (another reason to drop dual-runtime, §1.3).
- **A data-backfill framework distinct from forward-only DDL** (Operately's frozen-schema `Data.Change` modules) — otherwise backfills written against evolving Drizzle models break on replay.
- **Repo-wide soft-delete default** (`deleted_at IS NULL` injected by a base scope + `withDeleted()` opt-in + CI guard) — with Drizzle's lack of a global query hook, a single omission leaks deleted rows.
- **A typed realtime event contract** (Zod per channel/event) — the plan's Realtime port is untyped `publish(channel, event)` against a typed app.
- **A stale-client / deploy-version handshake** (forced reload on version mismatch) — acute on the continuously-deployed serverless tier where long-lived tabs hit a newer contract.
- **Schema-governance CI beyond RLS:** fail the build unless each business table has `workspace_id`, an RLS policy, required indexes for its default filters, and (auditable tables) an audit hook. Codify the plan's own invariants as machine-checked rules.

---

## Part 8 — Prioritized action list & re-sequenced roadmap

### Do first (strategic, before code)
1. **Decide build-vs-fork in writing**, measured against Operately, with the hard constraint that justifies greenfield if you choose it (§1.2). Note Operately is Apache-2.0.
2. **Re-benchmark the `§15` scorecard against Operately**, not OpenProject (§1.1).
3. **Add sizing + a risk register + spikes** for the RLS/serverless combo, the scheduling engine, and the scoring/formula engines; split the mega-tasks (§1.3).
4. **Pick one runtime for v1** (container + Postgres queue); demote dual-runtime to post-v1 (§1.3).
5. **Re-sequence** to a thin strategy-first end-to-end slice before the work-management pillar (§1.4).
6. **Cut the OpenProject importer** (generic CSV/XLSX instead); keep only FlowyTeam OKR mappers if that data is yours (§1.3).

### Promote into the core product (the "operating system" — Part 2)
7. **Cadence engine** with an opinionated weekly default + `outdated` staleness overriding self-reported health.
8. **Champion/reviewer accountability** + mandatory acknowledgement loop on every check-in.
9. **Review / My Assignments inbox** deriving obligations from cadence + role.
10. **Project check-ins + health + retrospectives + pause/resume** (project operating rhythm).
11. **Check-in as a structured narrative snapshot object**; goal health derived from the latest check-in.
12. **Work Map as the opinionated home screen** (unified goal→project→work tree).
13. **Lead with the opinionated default; gate configuration behind an advanced mode.**
14. **Spaces** as team homes; **retrospectives** required at close.

### Correct the security/robustness architecture (Part 4)
15. **RLS floor + relationship-based authz layer + one shared `can()`** (no pure RBAC); mandatory access-aware fetch helper; suspended-user exclusion; workspace freeze overlay.
16. **Transactional Operations pattern + transactional outbox**; audit written in-transaction; add hash-chain tamper-evidence + typed audit content.
17. **Copy Operately's MCP OAuth 2.1 verbatim** (PKCE-S256, discovery, rotation+reuse detection, resource indicators, CIMD, consent+workspace picker); OAuth primary, PAT fallback.
18. **Agent attack-surface defense:** least-privilege agent principal, shared-layer authz+validation, `read/write/destructive` classification, injection-untrusted RAG, SSRF egress allowlist, destructive-action confirmation.
19. **Store rich text as JSON** (not Markdown); add sanitization; hash session tokens; pull passkeys/TOTP into Phase 2.

### Build the AI/functionality gaps (Part 3)
20. **Resource Hub** (folder tree across space/project/goal) with docs/files/links + previews + quotas.
21. **Activity-feed engine** (scoped, typed events, one registry) + **generic subscriptions** + **buffered/daily-summary email** with access-gated recipients.
22. **Autonomous accountable AI teammates**; keep the provider/BYO/local/metering/RAG layer as the AI headline.
23. **Manager/reports-to**, member suspend/restore, reusable invite links, workspace export/import.

### Bank the superiority moves (Part 6) & the build discipline (Part 7)
24. RLS property tests, OpenAPI+generated CLI with drift-check, RSC streaming, web setup wizard, portability engine, tamper-evident audit, DB-service-based test factory + RLS e2e isolation + flaky policy + data-backfill framework + soft-delete default.

---

## Appendix — Corrections to specific plan documents

Every itemized edit, grouped by the plan file it touches, is in **[OPERATELY-GAP-REGISTER.md → Appendix A](OPERATELY-GAP-REGISTER.md#appendix-a---plan-corrections-grouped-by-document)**. The highest-impact edits per document:

- **`REQUIREMENTS.md`** — add `[DECIDE]` build-vs-fork; promote check-ins/cadence/champion-reviewer/review-inbox and project check-ins to **P0**; add Resource Hub, Work Map, manager relationship, workspace portability; add `[DECIDE]` hosted-SaaS/billing.
- **`PLAN.md`** — add the transactional-write + outbox rule (§7/§8); drop or scope-down RLS-as-primary and dual-runtime mandates (§2/§4); replace "full suite both profiles" CI with affected-graph + flaky policy + license/dead-code gates (§9).
- **`TECHNICAL-PLAN.md`** — rewrite `§6.2` status as a precedence cascade with staleness; fix `§4/§4.6` rich text to JSON; add object-level authz + relationship bindings + suspended-user exclusion + freeze overlay to `§8`; add the MCP OAuth 2.1 subsystem + audience binding + Origin/CIMD SSRF rows to `§8.2`; add a single-source contract + response-shape levels + data-loading boundary to `§13/§14`; re-benchmark `§15` against Operately.
- **`AI-NATIVE-PLAN.md`** — reframe principles 2/4 to allow least-privilege autonomous agents; add agents-as-people + `agent_runs` + sandbox; make OAuth 2.1 the primary MCP auth with full discovery/rotation/CIMD; extend the tool type with safety classifications + `search`/`fetch`; keep provider/BYO/local/metering/RAG as the flagship.
- **`DATABASE.md`** — add cadence/`outdated`/close columns to objectives; project check-in/retrospective/contributor/health tables; `resource_nodes` tree; `subscriptions` + email-batch tables; typed activity events + access scope; OAuth grant/token tables; outbox; manager relationship; export/import run tables.
- **`UIUX-PLAN.md`** — add the Work Map home screen, the Review/My-Assignments inbox, a member profile + people directory, the Resource Hub browser, the OAuth consent screen, and a dedicated rich-text-editor design doc.
- **`IMPLEMENTATION-PLAN.md` / `STATUS.md`** — split the mega-tasks; add tasks for cadence, project check-ins, Work Map, feed engine, subscriptions, Resource Hub, Operations/outbox, portability, autonomous agents, MCP OAuth server, RLS e2e/isolation + flaky policy; re-sequence Phase 4 ahead of most of Phase 3.

---

*Prepared from a full read of the OpenOKR plan and a source-level review of the Operately codebase. Itemized backing: [OPERATELY-GAP-REGISTER.md](OPERATELY-GAP-REGISTER.md).*
