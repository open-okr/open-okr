# STATUS.md

Single source of truth for execution progress of IMPLEMENTATION-PLAN.md. The agent updates rows; a human is the only one who sets `done`. Statuses: `todo`, `in_progress`, `in_review`, `blocked`, `done`, `skipped` (skipped requires a note and human sign-off). Rules in EXECUTION-GUIDE.md §5.

Last updated: 2026-07-08 (plan rewritten after the Operately gap analysis: strategy-first sequencing, single runtime v1, OpenProject importer cut, power floor deferred; **93 tasks `todo`**)

## Phase 1 — Walking skeleton (container-only)

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P1-T01 | Monorepo scaffold | todo |  |  |  |
| P1-T02 | CI pipeline + env schema | todo |  |  |  |
| P1-T03 | Database package + RLS floor + test isolation [SPIKE] | todo |  |  | R1 go/no-go recorded in docs/design/spike-rls-pooling.md |
| P1-T04 | Adapter ports + container drivers + transactional outbox | todo |  |  |  |
| P1-T05 | Better Auth: email+password, passkeys, TOTP | todo |  |  |  |
| P1-T06 | Workspaces + members bootstrap | todo |  |  |  |
| P1-T07 | Operation pipeline + action registry + audit spine | todo |  |  |  |
| P1-T08 | Hello dashboard | todo |  |  |  |
| P1-T09 | Docker Compose target + first-run web setup wizard | todo |  |  |  |
| P1-T10 | Helm chart target + Phase 1 exit | todo |  |  |  |

## Phase 2 — Core platform

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P2-T01 | Access model: contexts, bindings, groups | todo |  |  |  |
| P2-T02 | can() + access-aware reads | todo |  |  |  |
| P2-T03 | People: profiles, manager chain, lifecycle | todo |  |  |  |
| P2-T04 | Invitations: email, reusable links, trusted domains | todo |  |  |  |
| P2-T05 | Files: blobs, quotas, previews | todo |  |  |  |
| P2-T06 | Subscriptions + notification spine + email batching | todo |  |  |  |
| P2-T07 | Typed activity feed engine | todo |  |  |  |
| P2-T08 | Workspace settings + navigation registry | todo |  |  |  |
| P2-T09 | Security baseline (rate limits, lockout, CSP, sessions UI, freeze) | todo |  |  |  |
| P2-T10 | Demo workspace builder + seed | todo |  |  |  |
| P2-T11 | App shell + design system foundation | todo |  |  |  |
| P2-T12 | Rich text editor | todo |  |  |  |
| P2-T13 | Data-change runner | todo |  |  |  |

## Phase 3 — Strategy core

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P3-T00 | Strategy design gate [DESIGN GATE] | todo |  |  | needs human "Design approved for Phase 3"; golden-master matrices reviewed |
| P3-T01 | Spaces | todo |  |  |  |
| P3-T02 | Cycles + strategy settings | todo |  |  |  |
| P3-T03 | Goals + key results CRUD | todo |  |  |  |
| P3-T04 | Scoring & health engine (pure) | todo |  |  | highest-risk Phase 3 task (PLAN §13 R2) |
| P3-T05 | Cadence engine + staleness | todo |  |  |  |
| P3-T06 | Check-ins: snapshots, draft/publish, acknowledgement | todo |  |  |  |
| P3-T07 | Review inbox | todo |  |  |  |
| P3-T08 | Discussions + reactions wiring | todo |  |  |  |
| P3-T09 | Goal surfaces: explorer, page, alignment | todo |  |  |  |
| P3-T10 | Work Map v1 | todo |  |  |  |
| P3-T11 | KPIs: categories, records, grid | todo |  |  |  |
| P3-T12 | KPI formula engine | todo |  |  | PLAN §13 R3 fallback: sum/avg rollups only |
| P3-T13 | KPI detail + KR↔KPI links | todo |  |  |  |
| P3-T14 | Scorecard + cycle archive | todo |  |  | points sub-feature off by default; human-gated |
| P3-T15 | Strategy notifications + reminders | todo |  |  |  |
| P3-T16 | CSV/XLSX importer | todo |  |  |  |
| P3-T17 | FlowyTeam connector | todo |  |  | MySQL client is the pre-approved importer dependency |
| P3-T18 | FlowyTeam strategy mappers + reconciliation | todo |  |  |  |

## Phase 4 — Execution core

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P4-T00 | Execution design gate [DESIGN GATE] | todo |  |  | needs human "Design approved for Phase 4" |
| P4-T01 | Projects: lifecycle, contributors, health | todo |  |  |  |
| P4-T02 | Project check-ins + acknowledgement | todo |  |  |  |
| P4-T03 | Retrospectives + close flows | todo |  |  |  |
| P4-T04 | Milestones + project next step | todo |  |  |  |
| P4-T05 | Work items | todo |  |  |  |
| P4-T06 | Boards | todo |  |  |  |
| P4-T07 | Resource Hub | todo |  |  |  |
| P4-T08 | Global search | todo |  |  |  |
| P4-T09 | Work Map v2 — the full tree | todo |  |  |  |
| P4-T10 | Command palette + quick create | todo |  |  |  |
| P4-T11 | Exports | todo |  |  |  |
| P4-T12 | Execution notifications wiring | todo |  |  |  |
| P4-T13 | FlowyTeam task import | todo |  |  |  |
| P4-T14 | FlowyTeam full import: dry-run, reconciliation, report | todo |  |  |  |

## Phase 5 — The AI layer

Task bodies in AI-NATIVE-PLAN.md §12.

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P5-T00 | AI design gate [DESIGN GATE] | todo |  |  | needs human "Design approved for Phase 5"; AI-NATIVE §13 decisions confirmed |
| P5-T01 | AIProvider port full surface + drivers | todo |  |  |  |
| P5-T02 | AI config + BYO keys + encryption + rotation | todo |  |  |  |
| P5-T03 | Model catalog + tier routing | todo |  |  |  |
| P5-T04 | Usage metering + quotas + hard caps | todo |  |  |  |
| P5-T05 | Structured output + prompt registry | todo |  |  |  |
| P5-T06 | Public contract projections: REST + OpenAPI + CLI + MCP tool defs | todo |  |  |  |
| P5-T07 | Embeddings + RAG | todo |  |  |  |
| P5-T08 | In-app copilot | todo |  |  |  |
| P5-T09 | MCP OAuth 2.1 authorization server | todo |  |  | PLAN §13 R4: never ship PAT-only MCP |
| P5-T10 | MCP server: transport, sessions, catalog | todo |  |  |  |
| P5-T11 | AI teammates: agents + runs + approvals | todo |  |  | PLAN §13 R5: sandbox/batch-approval if safety review fails |
| P5-T12 | AI eval + safety harness + live e2e | todo |  |  |  |
| P5-T13 | Strategy AI assists | todo |  |  |  |
| P5-T14 | Execution AI assists + NL query | todo |  |  |  |

## Phase 6 — Hardening

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P6-T01 | Performance budgets + indexing at scale | todo |  |  |  |
| P6-T02 | Load & soak testing | todo |  |  |  |
| P6-T03 | Backups + restore drills | todo |  |  |  |
| P6-T04 | Workspace export/import (portability) | todo |  |  |  |
| P6-T05 | Observability | todo |  |  |  |
| P6-T06 | Security review + supply chain + RLS fuzz | todo |  |  |  |
| P6-T07 | Accessibility audit + Web Vitals CI | todo |  |  |  |
| P6-T08 | Migration cutover rehearsal | todo |  |  |  |

## Phase 7 — Enterprise & operator pack

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P7-T01 | SSO (OIDC + SAML) | todo |  |  |  |
| P7-T02 | LDAP sync | todo |  |  |  |
| P7-T03 | SCIM provisioning | todo |  |  |  |
| P7-T04 | MFA policy enforcement | todo |  |  |  |
| P7-T05 | Audit export + chain verification + air-gap guide | todo |  |  |  |
| P7-T06 | Operator console + transparent support impersonation | todo |  |  | billing stays behind BILLING_ENABLED, unbuilt |
| P7-T07 | Enterprise feature gating | todo |  |  | needs human open-core decision first |

## Phase 8 — Community launch

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P8-T01 | Docs site | todo |  |  |  |
| P8-T02 | Deploy quickstarts | todo |  |  |  |
| P8-T03 | Hosted demo instance | todo |  |  |  |
| P8-T04 | Contributor onboarding | todo |  |  |  |
| P8-T05 | Launch | todo |  |  |  |
| P8-T06 | Template gallery + operating-rhythm guides | todo |  |  |  |
