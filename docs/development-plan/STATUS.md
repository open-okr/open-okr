# STATUS.md

The single source of truth for execution progress against IMPLEMENTATION-PLAN.md. The agent updates rows. Only a human sets `done`.

Statuses: `todo`, `in_progress`, `in_review`, `blocked`, `done`, `skipped`. Skipping requires a note and human sign-off. The rules are in EXECUTION-GUIDE.md §5.

**104 tasks.**

## Phase 1: Foundation

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P1-T01 | Monorepo scaffold | in_review | task/p1-t01-monorepo-scaffold | 2026-08-04 | Workspace scaffolded, all checks green. LICENSE was already present (AGPL-3.0). TypeScript pinned to 5.9.x, not 7.x |
| P1-T02 | CI pipeline + environment schema | todo |  |  |  |
| P1-T03 | Database package + tenant floor + test isolation | todo |  |  | Tenant-isolation spike. Decision recorded in a design document |
| P1-T04 | Adapter ports + drivers + the transactional outbox | todo |  |  |  |
| P1-T05 | Authentication: password, passkeys, one-time codes | todo |  |  |  |
| P1-T06 | Workspaces + members bootstrap | todo |  |  |  |
| P1-T07 | Operation pipeline + action registry + audit spine | todo |  |  |  |
| P1-T08 | Proving dashboard | todo |  |  |  |
| P1-T09 | Docker Compose target + first-run setup wizard | todo |  |  |  |
| P1-T10 | Helm chart + Phase 1 exit | todo |  |  |  |

## Phase 2: Platform and agent spine

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P2-T01 | Access model: contexts, bindings, groups | todo |  |  |  |
| P2-T02 | can() + access-aware reads | todo |  |  |  |
| P2-T03 | People: profiles, manager chain, lifecycle | todo |  |  |  |
| P2-T04 | Invitations | todo |  |  |  |
| P2-T05 | Files and blobs | todo |  |  |  |
| P2-T06 | Subscriptions + notification spine | todo |  |  |  |
| P2-T07 | Typed activity feed engine | todo |  |  |  |
| P2-T08 | Workspace settings + module registry | todo |  |  |  |
| P2-T09 | Security baseline | todo |  |  |  |
| P2-T10 | App shell + design system | todo |  |  |  |
| P2-T11 | Rich text editor | todo |  |  |  |
| P2-T12 | Data-change runner | todo |  |  |  |
| P2-T13 | AIProvider port + drivers | todo |  |  |  |
| P2-T14 | AI configuration, keys, encryption and rotation | todo |  |  |  |
| P2-T15 | Model catalogue, tier routing, structured output and prompts | todo |  |  |  |
| P2-T16 | Usage metering, quotas and hard caps | todo |  |  |  |
| P2-T17 | Agent runtime: agents, runs, sandbox, proposals | todo |  |  |  |

## Phase 3: The OKR core

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P3-T00 | OKR core design gate | todo |  |  | Needs an explicit design approval. Golden-master matrices reviewed line by line |
| P3-T01 | Spaces | todo |  |  |  |
| P3-T02 | Annual frame, cycles and rhythm settings | todo |  |  |  |
| P3-T03 | The guided cycle workflow | todo |  |  |  |
| P3-T04 | Goals + key results | todo |  |  |  |
| P3-T05 | Scoring and health engine | todo |  |  |  |
| P3-T06 | Cadence engine + staleness | todo |  |  |  |
| P3-T07 | Check-ins: snapshots, publication, acknowledgement, voting | todo |  |  |  |
| P3-T08 | Review inbox | todo |  |  |  |
| P3-T09 | Alignment: parents, dependencies, the alignment engine | todo |  |  |  |
| P3-T10 | Goal surfaces: explorer, detail, alignment studio | todo |  |  |  |
| P3-T11 | Work Map | todo |  |  |  |
| P3-T12 | KPIs: categories, records, grid | todo |  |  |  |
| P3-T13 | KPI formula engine | todo |  |  |  |
| P3-T14 | KPI trees, corridors, recovery OKRs | todo |  |  |  |
| P3-T15 | Scorecard, cycle archive and feed-forward | todo |  |  | Scorecard points layer stays off unless the human funds it |
| P3-T16 | Comments, reactions and discussion wiring | todo |  |  |  |
| P3-T17 | Demo workspace builder + seed | todo |  |  |  |

## Phase 4: The coaching layer

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P4-T00 | Coaching design gate | todo |  |  | Needs an explicit design approval. Rule corpus and trigger catalogue reviewed line by line |
| P4-T01 | The method package | todo |  |  |  |
| P4-T02 | The quality engine and Draft Coach surfaces | todo |  |  |  |
| P4-T03 | Publish gates | todo |  |  |  |
| P4-T04 | The nudge engine, triggers and escalation | todo |  |  |  |
| P4-T05 | The OKR Champion agent | todo |  |  |  |
| P4-T06 | The OKR Coach agent | todo |  |  |  |
| P4-T07 | Weekly session: confidence round, voting, blockers | todo |  |  |  |
| P4-T08 | Weekly session: commitments, digest, streaks | todo |  |  |  |
| P4-T09 | Monthly review and decision log | todo |  |  |  |
| P4-T10 | Quarterly review: session shell, scoring, narratives | todo |  |  |  |
| P4-T11 | Quarterly review: retro, diagnostic, reset | todo |  |  |  |
| P4-T12 | Minutes, exports and review feed-forward | todo |  |  |  |
| P4-T13 | Embeddings and retrieval | todo |  |  |  |
| P4-T14 | Copilot | todo |  |  |  |
| P4-T15 | Coaching and rhythm assists | todo |  |  |  |

## Phase 5: Reach: channels, agents, work

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P5-T00 | Reach design gate | todo |  |  | Needs an explicit design approval |
| P5-T01 | Channel port, email driver and routing | todo |  |  |  |
| P5-T02 | Slack driver | todo |  |  |  |
| P5-T03 | Microsoft Teams driver | todo |  |  |  |
| P5-T04 | WhatsApp driver | todo |  |  |  |
| P5-T05 | Telegram driver | todo |  |  |  |
| P5-T06 | The chat command surface | todo |  |  |  |
| P5-T07 | Public contract projections: REST, OpenAPI and the command line | todo |  |  |  |
| P5-T08 | MCP authorisation server | todo |  |  |  |
| P5-T09 | MCP transport, sessions and tool catalogue | todo |  |  |  |
| P5-T10 | Initiatives | todo |  |  |  |
| P5-T11 | Tasks and the OKR board | todo |  |  |  |
| P5-T12 | Documents and attachments | todo |  |  |  |
| P5-T13 | Search, palette and exports | todo |  |  |  |

## Phase 6: Data: import, export, portability

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P6-T01 | CSV and XLSX importer with the AI mapper | todo |  |  |  |
| P6-T02 | FlowyTeam connector | todo |  |  |  |
| P6-T03 | FlowyTeam strategy mappers | todo |  |  |  |
| P6-T04 | FlowyTeam work and collaboration mappers | todo |  |  |  |
| P6-T05 | Workspace export and import | todo |  |  |  |
| P6-T06 | Backups and restore drills | todo |  |  |  |
| P6-T07 | Migration cutover rehearsal | todo |  |  |  |

## Phase 7: Hardening

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P7-T01 | Performance budgets and indexing at scale | todo |  |  |  |
| P7-T02 | Load and soak testing | todo |  |  |  |
| P7-T03 | Security review, supply chain and tenant fuzzing | todo |  |  |  |
| P7-T04 | Agent, nudge and channel safety hardening | todo |  |  |  |
| P7-T05 | Accessibility audit and web vitals | todo |  |  |  |
| P7-T06 | Observability | todo |  |  |  |
| P7-T07 | Method conformance audit | todo |  |  |  |
| P7-T08 | Privacy: export, erasure and retention | todo |  |  |  |

## Phase 8: Cloud, enterprise and launch

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P8-T01 | Cloud design gate | todo |  |  | Needs an explicit design approval |
| P8-T02 | Tenant provisioning, signup and onboarding | todo |  |  |  |
| P8-T03 | Operator console | todo |  |  |  |
| P8-T04 | Transparent support access | todo |  |  |  |
| P8-T05 | Plans, seats and limits | todo |  |  | Plans and seats stay behind a flag that is off for self-host |
| P8-T06 | Cloud operations | todo |  |  |  |
| P8-T07 | Single sign-on | todo |  |  |  |
| P8-T08 | Directory sync and provisioning | todo |  |  |  |
| P8-T09 | Multi-factor policy | todo |  |  |  |
| P8-T10 | Audit export, chain verification and the air-gap guide | todo |  |  |  |
| P8-T11 | Documentation site | todo |  |  |  |
| P8-T12 | Template gallery and rhythm guides | todo |  |  |  |
| P8-T13 | Hosted demo instance | todo |  |  |  |
| P8-T14 | Launch | todo |  |  |  |
