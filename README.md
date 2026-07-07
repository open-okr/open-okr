# OpenOKR — development plan

This repository holds a complete, self-contained plan (in [`docs/development-plan/`](docs/development-plan/)) to build `OpenOKR`, an open source **OKR and work management platform**, on a modern TypeScript stack. It combines native strategy modules (OKR, KPI, check-ins) with full work management (work packages, boards, gantt, wiki, meetings), ships importers that migrate data from two legacy tools, and is **AI-native throughout**: every module has AI assists, an in-app copilot acts inside the user's own permissions, and an MCP server lets any AI agent drive OKRs and projects. It is executed by Claude Code under human supervision, one task at a time.

Two source systems inform the plan, and each gets a one-way data importer:

| Source | What it contributes | Stack | Reference |
|---|---|---|---|
| 1. A legacy project tool | Work management: work packages, workflows, queries, boards, gantt, wiki, meetings, time/cost | Ruby on Rails ~8.0, PostgreSQL | `docs/development-plan/reference/legacy-data-model.md`, `legacy-feature-inventory.md` |
| 2. FlowyTeam | Strategy: OKR, KPI, check-ins, and lightweight tasks (unified into work packages) | Laravel 10 / PHP 8, MySQL | `docs/development-plan/reference/flowyteam-okr-kpi-tasks-model.md` |

OpenOKR is a new product, not a fork of either.

## The documents

Read in this order the first time:

| # | File | What it is | Authority over |
|---|---|---|---|
| 1 | [REQUIREMENTS.md](docs/development-plan/REQUIREMENTS.md) | Product definition: personas, modules, priorities, non-functional needs | What the product does |
| 2 | [PLAN.md](docs/development-plan/PLAN.md) | Architecture principles, license, deployment tiers, delivery philosophy | How it is architected |
| 3 | [TECHNICAL-PLAN.md](docs/development-plan/TECHNICAL-PLAN.md) | Target design: domain model and full schema (incl. §4.12 strategy: OKR/KPI/tasks, and §6.2 the scoring engine), source-system mapping for both importers (§7.4/§7.6), security controls, performance budgets | Technical design decisions |
| 4 | [AI-NATIVE-PLAN.md](docs/development-plan/AI-NATIVE-PLAN.md) | The AI layer: the AI-native stance, capability catalog, provider / bring-your-own-key architecture, admin surface, the MCP server, the agentic copilot + tool registry, AI schema/security, Phase 5 tasks | The AI domain (peer of TECHNICAL-PLAN.md there) |
| 5 | [UIUX-PLAN.md](docs/development-plan/UIUX-PLAN.md) | Design system, navigation, interaction patterns, screen specs (S-01…S-25), accessibility and UX quality gates | The user interface |
| 6 | [IMPLEMENTATION-PLAN.md](docs/development-plan/IMPLEMENTATION-PLAN.md) | The work: eight sequential phases (1–8) and 109 tasks with IDs, each with test plan, development and QA blocks, plus Definition of Ready | What gets built, in what order |
| 7 | [EXECUTION-GUIDE.md](docs/development-plan/EXECUTION-GUIDE.md) | The operating protocol between the human engineer and Claude Code | Process |
| 8 | [CLAUDE.md](CLAUDE.md) | Working rules for the Claude Code agent (auto-loaded from the repo root) | Agent behavior |
| 9 | [reference/](docs/development-plan/reference/) | The source-system knowledge base: data models and feature inventories for both legacy tools, extracted and verified against their codebases | Facts about the source systems |

Also here:

- [OVERVIEW.md](docs/development-plan/OVERVIEW.md): the **end-user product overview** — what OpenOKR is, who it is for, every module and its benefit, and how to get started. Written for users and admins, not builders; not part of the build authority chain.
- [DATABASE.md](docs/development-plan/DATABASE.md): the full consolidated database structure — every table, key columns, foreign keys, enums, and a relationship diagram. A derived reference view; the authoritative schema lives in TECHNICAL-PLAN.md §4 (incl. §4.12 strategy).
- [PROMPT.md](docs/development-plan/PROMPT.md): copy-paste prompts for running development with Claude Code (start a task, resume, rework, approve a design gate), and how Claude finds the plan.
- [STATUS.md](docs/development-plan/STATUS.md): task tracking, pre-filled with all 109 tasks as `todo`. The agent updates rows; only a human sets `done` (rules in EXECUTION-GUIDE.md §5).

One artifact set exists only after execution starts: `docs/design/*` — detailed designs written by the agent at each phase's design gate.

## How the pieces fit

```
REQUIREMENTS.md            what to build
      |
TECHNICAL-PLAN.md          how to build it (schema incl. §4.12 strategy + both source mappings)
AI-NATIVE-PLAN.md          the AI domain (providers/BYO-key, copilot, MCP server)
UIUX-PLAN.md               how it looks and behaves (screen specs S-xx)
      |
IMPLEMENTATION-PLAN.md     ordered tasks in eight sequential phases: P1-* … P8-*
      |
EXECUTION-GUIDE.md         human picks a task -> agent builds -> human reviews -> merge
      |
STATUS.md                  live record of where execution stands
```

The `reference/` folder exists because this repository does not contain either source system's code. Everything the agent needs to know about them (table layouts, business rules, scoring formulas, permission names) was extracted into those files ahead of time. They are the ground truth for the data importers.

## Quick start

1. Run the bootstrap prompt in EXECUTION-GUIDE.md section 2 (first-run sanity check).
2. Read the agent's reply and fix any contradiction it surfaces.
3. Start with task `P1-T01`.

## Provenance

The `reference/` knowledge base was extracted from analyses of the two source codebases (July 2026) so the importers can be built without access to either. The legacy project tool is GPL-licensed; see TECHNICAL-PLAN.md §11 for the clean-room stance that keeps OpenOKR's own code unencumbered. The same stance applies to FlowyTeam: OpenOKR reads its database (data, not code) and reproduces observable behavior described in our own words.
