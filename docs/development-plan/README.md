# OpenOKR: development plan

This folder holds a complete, self-contained plan to build **OpenOKR**, an open source, AI-agentic-native OKR platform that coaches an organisation through the whole OKR practice instead of merely storing its goals.

The product's difference is two things at once. **The method is in the product**: a guided eight-phase planning cycle, twenty-six quality checks that judge every draft as it is typed, an alignment health score, KPI health corridors with recovery objectives, two timed session formats, and a diagnostic at the close. And **the product is active**: two AI teammates, an OKR Coach that guards quality and an OKR Champion that guards the rhythm, initiate, escalate and propose, in the browser, in Slack, Teams, WhatsApp and Telegram, by email, and through any AI agent the user already runs.

It runs two ways from day one: self-hosted on your own servers, or in our managed cloud, from the same release.

The plan is executed by Claude Code under human supervision, one task at a time.

## The documents

Read in this order the first time.

| # | File | What it is | Authority over |
|---|---|---|---|
| 1 | [REQUIREMENTS.md](REQUIREMENTS.md) | Product definition: personas, the operating model, modules, priorities, deployment, and what is deferred | What the product does |
| 2 | [PLAN.md](PLAN.md) | Architecture principles, packages, adapters, licence, deployment tiers, delivery phases, the risk register, open decisions | How it is architected |
| 3 | [METHOD.md](METHOD.md) | The OKR practice canon: the cycle model, scoring and confidence bands, the twenty-six quality checks with their word lists and coaching prompts, publish gates, alignment scoring, KPI corridors and recovery, the blocker and root-cause taxonomies, session agendas, and the closing diagnostic | What good OKR practice is |
| 4 | [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md) | Target design: the identity and access model, the full schema by domain, adapter ports and the transactional outbox, the engines, importers, security, testing, performance budgets and the one-contract API | Technical design |
| 5 | [AI-NATIVE-PLAN.md](AI-NATIVE-PLAN.md) | The AI and agent layer: providers and bring-your-own-key, governance, chat channels, the Coach and the Champion with the full trigger and escalation catalogue, the copilot, retrieval, and the external agent surface | The AI domain |
| 6 | [UIUX-PLAN.md](UIUX-PLAN.md) | Design system, navigation, interaction patterns, forty screen specifications, accessibility and quality gates | The user interface |
| 7 | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | The work: eight phases, 105 tasks with dependencies, test plans and acceptance criteria, plus the Definition of Ready | What gets built, in what order |
| 8 | [EXECUTION-GUIDE.md](EXECUTION-GUIDE.md) | The protocol between the human engineer and the agent | Process |
| 9 | [reference/](reference/) | Source-system knowledge bases, the ground truth for the importers | Facts about the sources |

The agent's own working rules live in [CLAUDE.md](../../CLAUDE.md) at the repository root, where they are loaded automatically.

Also here:

- [OVERVIEW.md](OVERVIEW.md): the end-user product overview: what OpenOKR is, who it is for, and what every part of it does. Written for users and admins, not builders.
- [DATABASE.md](DATABASE.md): the consolidated schema: every table, key columns and relationships. A derived view; the authority is TECHNICAL-PLAN.md §4.
- [START-PROMPT.md](START-PROMPT.md): the one prompt that starts every development session.
- [PROMPT.md](PROMPT.md): copy-and-paste prompts for the other situations: bootstrap, rework, spikes, phase exits, conformance.
- [STATUS.md](STATUS.md): task tracking. The agent updates rows; only a human sets `done`.
- [Reference mockups](../stakeholder/mockups/README.md): eleven screens from UIUX-PLAN.md §6 drawn as HTML and rendered to PNG. Look at the mockup before starting a UI task. Reference, not authority: UIUX-PLAN.md §10 has the rule.

`docs/design/` exists only once execution starts: detailed designs written by the agent at each phase's design gate.

## How the pieces fit

```
REQUIREMENTS.md      what to build: the operating model, the modules, what is deferred
METHOD.md            what good OKR practice is: every rule, band, corridor and ritual
      |
PLAN.md              principles, packages, deployment, phases, risks
TECHNICAL-PLAN.md    schema, access model, outbox, engines, importers, security, budgets
AI-NATIVE-PLAN.md    providers, governance, channels, the Coach and the Champion, MCP
UIUX-PLAN.md         how it looks and behaves (screens S-01 to S-40)
      |              ...eleven of which are drawn in ../stakeholder/mockups/
      |
IMPLEMENTATION-PLAN.md   105 ordered tasks in eight phases: P1-* to P8-*
      |
EXECUTION-GUIDE.md   human picks a task, agent builds, human reviews, merge
      |
STATUS.md            live record of where execution stands
```

Two documents deserve special attention.

**METHOD.md** is unusual for an engineering plan, and it is the point of the product. It is compiled into `packages/method`, a pure library with no database or network access, and a conformance suite fails the build when the document and the code disagree. Every coaching message the product sends cites a rule key that resolves back to it.

**The phase order is deliberate.** The AI and agent foundation lands in Phase 2, with the platform, so the coaching layer can ship in Phase 4 alongside the OKR core rather than years later. An OKR tool where the coach arrives last is just another tracker.

## Data importers

| Source | What it contributes | Reference |
|---|---|---|
| Spreadsheets (CSV, XLSX) | Goals, key results, KPIs and records, initiatives, tasks. AI proposes the column mapping, a human confirms it, a dry run precedes every import | Templates in the product |
| FlowyTeam | One company at a time: teams, cycles, objectives, key results, check-ins, KPIs with formulas, and tasks | [reference/flowyteam-okr-kpi-tasks-model.md](reference/flowyteam-okr-kpi-tasks-model.md) |

The other files in `reference/` are background knowledge about systems in this space. They inform nothing in the design and constrain nothing in the schema.

## Quick start

1. Run the bootstrap prompt in [PROMPT.md](PROMPT.md) §1.
2. Read the agent's reply and fix any contradiction it surfaces.
3. Start with task `P1-T01`.

## Provenance and licensing

OpenOKR is a new product. It is not a fork of anything.

The `reference/` knowledge base was extracted ahead of time so the importers can be built without access to the source systems. FlowyTeam is proprietary. OpenOKR reads its database, meaning data and not code, and reproduces observable behaviour described in our own words.

The OKR practice in METHOD.md is method, not expression: rules, thresholds, taxonomies and agendas, written here in our own words. No third party's copy, branding, typefaces, logos or course material appears anywhere in the product.

OpenOKR's own code is AGPL-3.0 with a contributor licence agreement. See [PLAN.md](PLAN.md) §4.
