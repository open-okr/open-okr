# STATUS.md

Single source of truth for execution progress of IMPLEMENTATION-PLAN.md. The agent updates rows; a human is the only one who sets `done`. Statuses: `todo`, `in_progress`, `in_review`, `blocked`, `done`, `skipped` (skipped requires a note and human sign-off). Rules in EXECUTION-GUIDE.md §5.

Last updated: 2026-07-07 (plan consolidated into eight sequential phases; OKR/KPI/Tasks folded in as Phase 4; 109 tasks `todo`)

## Phase 1 — Prove the pipeline

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P1-T01 | Monorepo scaffold | todo |  |  |  |
| P1-T02 | CI matrix + env schema | todo |  |  |  |
| P1-T03 | Database package + first migration + RLS harness | todo |  |  |  |
| P1-T04 | Adapter ports + both driver sets (stubs) | todo |  |  |  |
| P1-T05 | Better Auth integration | todo |  |  |  |
| P1-T06 | Workspaces + membership bootstrap | todo |  |  |  |
| P1-T07 | Hello dashboard (server-rendered) | todo |  |  |  |
| P1-T08 | Docker Compose target | todo |  |  |  |
| P1-T09 | Vercel + Supabase target | todo |  |  |  |
| P1-T10 | Helm chart target + Phase 1 exit | todo |  |  |  |

## Phase 2 — Core platform

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P2-T01 | RBAC schema + permission catalogue | todo |  |  |  |
| P2-T02 | Authorization layer in core | todo |  |  |  |
| P2-T03 | Audit log | todo |  |  |  |
| P2-T04 | Invitations + membership management | todo |  |  |  |
| P2-T05 | File uploads via FileStorage adapter | todo |  |  |  |
| P2-T06 | Notifications spine | todo |  |  |  |
| P2-T07 | Workspace & project settings shell | todo |  |  |  |
| P2-T08 | Navigation & module registration framework | todo |  |  |  |
| P2-T09 | Importer skeleton + read-only source connection | todo |  |  |  |
| P2-T10 | Seed + demo workspace | todo |  |  |  |
| P2-T11 | App shell + design system foundation | todo |  |  |  |
| P2-T12 | Security baseline: rate limiting, headers, sessions UI | todo |  |  |  |

## Phase 3 — Work management

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P3-T00 | Domain design docs [DESIGN GATE] | todo |  |  | needs human "Design approved for Phase 3" |
| P3-T01 | Projects schema + tree + CRUD | todo |  |  |  |
| P3-T02 | Versions + categories | todo |  |  |  |
| P3-T03 | Import projects/versions/categories | todo |  |  |  |
| P3-T04 | Types, statuses, workflow, priorities | todo |  |  |  |
| P3-T05 | Work package CRUD + hierarchy + relations | todo |  |  |  |
| P3-T06 | Custom fields engine | todo |  |  |  |
| P3-T07 | Import work packages + custom values | todo |  |  |  |
| P3-T08 | Query DSL + saved queries + table view | todo |  |  |  |
| P3-T09 | Import queries/views (DSL translation) | todo |  |  |  |
| P3-T10 | Scheduling engine (pure) | todo |  |  | highest-risk task; human reviews golden masters |
| P3-T11 | Reschedule job + working-days admin | todo |  |  |  |
| P3-T12 | Gantt view | todo |  |  |  |
| P3-T13 | Boards (kanban) | todo |  |  |  |
| P3-T14 | Calendar + team planner | todo |  |  |  |
| P3-T15 | Import boards/queries-backed views + manual order | todo |  |  |  |
| P3-T16 | Comments + activity feed + reactions | todo |  |  |  |
| P3-T17 | Wire notifications to work packages | todo |  |  |  |
| P3-T18 | Import comments + activity | todo |  |  |  |
| P3-T19 | Time tracking + timer | todo |  |  |  |
| P3-T20 | Costs + rates | todo |  |  |  |
| P3-T21 | Import time/cost/rates | todo |  |  |  |
| P3-T22 | Wiki | todo |  |  |  |
| P3-T23 | Meetings (structured + recurring) | todo |  |  |  |
| P3-T24 | Import wiki + meetings | todo |  |  |  |
| P3-T25 | Dashboards (my page + project overview) | todo |  |  |  |
| P3-T26 | Global search | todo |  |  |  |
| P3-T27 | Exports (CSV/XLSX/PDF) | todo |  |  |  |
| P3-T28 | Backlogs / Scrum + sprint import | todo |  |  |  |
| P3-T29 | GitHub/GitLab integration | todo |  |  |  |
| P3-T30 | Full import dry-run + reconciliation + report polish | todo |  |  |  |
| P3-T31 | Favorites + quick navigation | todo |  |  |  |
| P3-T32 | Command palette + keyboard shortcuts + quick create | todo |  |  |  |
| P3-T33 | Project lifecycle phases & gates | todo |  |  | optional — human decides build vs skip |

## Phase 4 — Strategy: OKR, KPI, Check-ins & Tasks

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P4-T00 | OKR/KPI/Tasks design gate [DESIGN GATE] | todo |  |  | needs human "Design approved for Phase 4" |
| P4-T01 | Org units + membership + designations | todo |  |  |  |
| P4-T02 | OKR cycles + settings | todo |  |  |  |
| P4-T03 | Objectives + key results schema + CRUD | todo |  |  |  |
| P4-T04 | Scoring & alignment engine (pure) | todo |  |  | highest-risk Phase 4 task; human reviews golden masters |
| P4-T05 | OKR check-ins | todo |  |  |  |
| P4-T06 | OKR views UI (explorer, detail, alignment) | todo |  |  |  |
| P4-T07 | KPIs + categories + records | todo |  |  |  |
| P4-T08 | KPI formula engine (calculated KPIs) | todo |  |  |  |
| P4-T09 | KPI ↔ key result linkage | todo |  |  |  |
| P4-T10 | KPI views UI (grid, detail, tree, dashboards) | todo |  |  |  |
| P4-T11 | Performance snapshot + scorecard | todo |  |  | points sub-feature off by default; human-gated |
| P4-T12 | Tasks unification into work packages | todo |  |  | depends on P3-T05 (work packages) |
| P4-T13 | FlowyTeam importer — MySQL source + company selection | todo |  |  | MySQL client is the pre-approved importer dependency |
| P4-T14 | FlowyTeam importer — org, cycles, objectives, KRs, check-ins | todo |  |  |  |
| P4-T15 | FlowyTeam importer — KPIs, records, formulas | todo |  |  |  |
| P4-T16 | FlowyTeam importer — tasks into work packages | todo |  |  | depends on P3-T07 |
| P4-T17 | FlowyTeam full import dry-run + reconciliation + report | todo |  |  |  |
| P4-T18 | OKR/KPI reminders + notifications | todo |  |  |  |
| P4-T19 | OKR/KPI/Tasks REST + MCP-compatible API | todo |  |  |  |

## Phase 5 — The AI layer (AI-native)

Detail in AI-NATIVE-PLAN.md §12.

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P5-T00 | AI design gate [DESIGN GATE] | todo |  |  | needs human "Design approved for Phase 5" |
| P5-T01 | AIProvider port full surface + drivers | todo |  |  |  |
| P5-T02 | AI config + BYO-key + encryption | todo |  |  |  |
| P5-T03 | Model catalog + routing | todo |  |  |  |
| P5-T04 | Usage + cost metering + quotas + caps | todo |  |  |  |
| P5-T05 | Structured output + prompt registry | todo |  |  |  |
| P5-T06 | Tool registry + agent authz + confirmation | todo |  |  |  |
| P5-T07 | Embeddings + RAG | todo |  |  |  |
| P5-T08 | In-app copilot | todo |  |  |  |
| P5-T09 | MCP server (inbound) | todo |  |  |  |
| P5-T10 | AI eval + safety harness + CI | todo |  |  |  |
| P5-T11 | OKR AI authoring + coaching | todo |  |  | detail in AI-NATIVE-PLAN.md §12; depends on P5-T06 + P4 OKR core |
| P5-T12 | Work / project AI assists + NL-query | todo |  |  | detail in AI-NATIVE-PLAN.md §12; depends on P5-T06/T07 + P3 cores |

## Phase 6 — Hardening

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P6-T01 | Performance budgets + indexing at scale | todo |  |  |  |
| P6-T02 | Load & soak testing | todo |  |  |  |
| P6-T03 | Backup & restore | todo |  |  |  |
| P6-T04 | Observability | todo |  |  |  |
| P6-T05 | Security review + supply chain | todo |  |  |  |
| P6-T06 | Accessibility audit + Web Vitals budgets in CI | todo |  |  |  |
| P6-T07 | Cutover rehearsal + rollback drill | todo |  |  |  |

## Phase 7 — Enterprise pack

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P7-T01 | SSO (OIDC + SAML) | todo |  |  |  |
| P7-T02 | LDAP sync + groups | todo |  |  |  |
| P7-T03 | SCIM provisioning | todo |  |  |  |
| P7-T04 | 2FA (TOTP + WebAuthn) | todo |  |  |  |
| P7-T05 | Audit export + advanced Helm + air-gap guide | todo |  |  |  |
| P7-T06 | Enterprise feature gating | todo |  |  | needs human open-core decision first |
| P7-T07 | Project initiation request wizard | todo |  |  | pricing placement is a human decision |

## Phase 8 — Community launch

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P8-T01 | Docs site | todo |  |  |  |
| P8-T02 | One-click deploy buttons | todo |  |  |  |
| P8-T03 | Hosted demo instance | todo |  |  |  |
| P8-T04 | Contributor onboarding | todo |  |  |  |
| P8-T05 | Launch | todo |  |  |  |
| P8-T06 | Methodology template gallery + guides | todo |  |  |  |
