# OpenOKR — development plan

This folder holds a complete, self-contained plan to build `OpenOKR`, an open source **operating system for running a company on goals**, on a modern TypeScript stack. It joins native strategy (OKRs, KPIs, check-ins) to an Operately-class execution core (projects, milestones, work items, boards, a Resource Hub) through a built-in **operating rhythm**: a check-in cadence with enforced staleness, a champion/reviewer accountability contract, a personal review inbox, and one company-wide Work Map. It is **AI-native**: assists in every module, an in-app copilot, autonomous **AI teammates**, and an MCP server (with a full OAuth 2.1 authorization server) so any external agent can drive it safely. It is executed by Claude Code under human supervision, one task at a time.

## The benchmark: Operately (and why we build, not fork)

OpenOKR's competitor and quality bar is **[Operately](https://operately.com)** — a shipped, mature, Apache-2.0 "company operating system". This plan was **rewritten after a full source-level comparison against Operately** (see the two analysis docs below). The product owner chose to build ground-up rather than fork; the recorded reasons (stack ownership, license/IP independence, architectural freedom) are in [PLAN.md §2](PLAN.md). We study Operately's *observable behavior* as a reference spec where it is already validated (the goal status cascade, the check-in lifecycle, the MCP OAuth flow); we never copy its code.

Read these two first — they explain *why* the plan looks the way it does:

| File | What it is |
|---|---|
| [OPERATELY-COMPARISON.md](OPERATELY-COMPARISON.md) | The synthesis: where OpenOKR must beat Operately, the strategic reckoning, the product-philosophy gap, security/robustness, and the prioritized roadmap |
| [OPERATELY-GAP-REGISTER.md](OPERATELY-GAP-REGISTER.md) | The exhaustive backing: all 142 itemized gaps + superiority ideas + the exact plan-doc edits |

## Data importers

OpenOKR is a new product, not a fork of anything. One legacy tool gets a one-way importer; everything else comes via a generic file importer.

| Source | What it contributes | Stack | Reference |
|---|---|---|---|
| FlowyTeam | Strategy + tasks: OKRs, KPIs (+ formulas), check-ins, and tasks → work items (with comments, files, time logs) | Laravel 10 / PHP 8, MySQL | [reference/flowyteam-okr-kpi-tasks-model.md](reference/flowyteam-okr-kpi-tasks-model.md) |
| Generic CSV / XLSX | Goals, key results, KPIs + records, projects, work items | — | template downloads + dry-run preview |

*(An OpenProject importer was in an earlier draft and was cut on 2026-07-08. The `reference/legacy-*.md` OpenProject files remain only as archived background.)*

## The documents

Read in this order the first time:

| # | File | What it is | Authority over |
|---|---|---|---|
| 1 | [REQUIREMENTS.md](REQUIREMENTS.md) | Product definition: personas, the operating model (§3), modules, priorities, the v1 vs "power floor" split (§6) | What the product does |
| 2 | [PLAN.md](PLAN.md) | Architecture principles, the greenfield decision (§2), deployment, delivery phases, the risk register (§13), open decisions (§14) | How it is architected |
| 3 | [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md) | Target design: identity + relationship access model (§4.1), full schema (§4), adapter ports + transactional outbox (§5), the pure engines (§6), the importer (§7), security (§8), testing (§10), the one-contract API (§14), the Operately scorecard (§15) | Technical design |
| 4 | [AI-NATIVE-PLAN.md](AI-NATIVE-PLAN.md) | The AI layer: providers/BYO-key/local models, governance, the MCP OAuth 2.1 server, the copilot, AI teammates, AI schema/security, Phase 5 tasks | The AI domain (peer of TECHNICAL-PLAN.md there) |
| 5 | [UIUX-PLAN.md](UIUX-PLAN.md) | Design system, navigation, interaction patterns, screen specs, accessibility and UX quality gates | The user interface |
| 6 | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | The work: eight phases and tasks with IDs, each with test plan / development / QA, plus Definition of Ready | What gets built, in what order |
| 7 | [EXECUTION-GUIDE.md](EXECUTION-GUIDE.md) | The operating protocol between the human engineer and Claude Code | Process |
| 8 | [CLAUDE.md](CLAUDE.md) | Working rules for the Claude Code agent | Agent behavior |
| 9 | [reference/](reference/) | The FlowyTeam source knowledge base (data model, features, scoring, permissions). Ground truth for the importer | Facts about the source |

Also here:

- [OVERVIEW.md](OVERVIEW.md) — the **end-user product overview** (what OpenOKR is, who it is for, every module and its benefit). For users and admins; not part of the build-authority chain.
- [DATABASE.md](DATABASE.md) — the full consolidated schema (every table, key columns, foreign keys, relationship diagram). A derived view; the authority is TECHNICAL-PLAN.md §4.
- [PROMPT.md](PROMPT.md) — copy-paste prompts for running development with Claude Code.
- [STATUS.md](STATUS.md) — task tracking. The agent updates rows; only a human sets `done`.

`docs/design/*` exists only after execution starts: detailed designs written by the agent at each phase's design gate.

## How the pieces fit

```
OPERATELY-COMPARISON.md    why the plan is shaped this way (benchmark = Operately)
      |
REQUIREMENTS.md            what to build (the operating model §3; v1 vs power floor §6)
      |
PLAN.md                    principles, greenfield decision, phases, risk register
TECHNICAL-PLAN.md          schema, access model, outbox, engines, importer, security, scorecard
AI-NATIVE-PLAN.md          the AI domain (providers/BYO-key, copilot, AI teammates, MCP OAuth)
UIUX-PLAN.md               how it looks and behaves (screen specs)
      |
IMPLEMENTATION-PLAN.md     ordered tasks in eight phases (strategy-first): P1-* … P8-*
      |
EXECUTION-GUIDE.md         human picks a task -> agent builds -> human reviews -> merge
      |
STATUS.md                  live record of where execution stands
```

The delivery order is deliberately **strategy-first**: the OKR + operating-rhythm core (the differentiator) ships before the execution pillar, so the core value proposition exists and is validated early (PLAN.md §11).

## Quick start

1. Run the bootstrap prompt in EXECUTION-GUIDE.md §2 (first-run sanity check).
2. Read the agent's reply and fix any contradiction it surfaces.
3. Start with task `P1-T01`.

## Provenance

The `reference/` FlowyTeam knowledge base was extracted from an analysis of that codebase so the importer can be built without access to it. FlowyTeam is proprietary; OpenOKR reads its database (data, not code) and reproduces observable behavior described in our own words (TECHNICAL-PLAN.md §11). The same clean-room stance applies to Operately (Apache-2.0), which is a behavioral benchmark, never a code source. OpenOKR's own code is AGPL-3.0 + CLA (pending sign-off, PLAN.md §4).
