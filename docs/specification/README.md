# OpenOKR: the specification

What OpenOKR is, how it is built, and the OKR practice it encodes. A change to the product starts here: when the code and one of these documents disagree, the document is updated in the same change, or the code is wrong.

## The documents

Read in this order the first time.

| # | File | What it is | Authority over |
|---|---|---|---|
| 1 | [REQUIREMENTS.md](REQUIREMENTS.md) | Product definition: personas, the operating model, modules, priorities, deployment, and what is deliberately out of scope | What the product does |
| 2 | [PLAN.md](PLAN.md) | Architecture principles, packages, adapters, licence, deployment tiers, the upgrade policy, product decisions | How it is architected |
| 3 | [METHOD.md](METHOD.md) | The OKR practice canon: the cycle model, scoring and confidence bands, the twenty-six quality checks with their word lists and coaching prompts, publish gates, alignment scoring, KPI corridors and recovery, the blocker and root-cause taxonomies, session agendas, the closing diagnostic, and the practice settings an organisation may change | What good OKR practice is |
| 4 | [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md) | Technical design: the identity and access model, the full schema by domain, adapter ports and the transactional outbox, the engines, importers, security, testing, performance budgets and the one-contract API | Technical design |
| 5 | [AI-NATIVE-PLAN.md](AI-NATIVE-PLAN.md) | The AI and agent layer: providers and bring-your-own-key, governance, chat channels, the Coach and the Champion with the full trigger and escalation catalogue, the copilot, retrieval, and the external agent surface | The AI domain |
| 6 | [UIUX-PLAN.md](UIUX-PLAN.md) | Design system, navigation, interaction patterns, the screen specifications, accessibility and quality gates | The user interface |

If two documents disagree, the one higher in this list wins, except that a disagreement between REQUIREMENTS.md and PLAN.md is settled by a maintainer rather than by either document.

Also here:

- [OVERVIEW.md](OVERVIEW.md): the product explained for users and administrators rather than builders.
- [DATABASE.md](DATABASE.md): the consolidated schema, every table with its key columns and relationships. A derived view; the authority is TECHNICAL-PLAN.md §4.
- [CI-GATES.md](CI-GATES.md): every gate that refuses a change, the command that runs it locally, and what each one catches.
- [reference/](reference/): the FlowyTeam data model, the ground truth the FlowyTeam importer is built against.

Detailed designs, one per engine or subsystem, are in [`docs/design/`](../design/). Eleven screens are drawn as [reference mockups](../mockups/README.md).

## How the pieces fit

```
REQUIREMENTS.md      what to build: the operating model, the modules, what is out of scope
METHOD.md            what good OKR practice is: every rule, band, corridor and ritual
      |
PLAN.md              principles, packages, deployment, upgrades
TECHNICAL-PLAN.md    schema, access model, outbox, engines, importers, security, budgets
AI-NATIVE-PLAN.md    providers, governance, channels, the Coach and the Champion, MCP
UIUX-PLAN.md         how it looks and behaves (screens S-01 to S-40, plus the cloud operator screens S-45 to S-49)
      |
docs/design/         the detailed design of each engine and subsystem
```

**METHOD.md is the point of the product.** It is compiled into `packages/method`, a pure library with no database or network access, and `pnpm method:check` fails the build when the document and the code disagree. Every coaching message the product sends cites a rule key that resolves back to it.

## Data importers

| Source | What it contributes | Reference |
|---|---|---|
| Spreadsheets (CSV, XLSX) | Goals, key results, KPIs and records, initiatives, tasks. AI proposes the column mapping, a human confirms it, a dry run precedes every import | Templates in the product |
| FlowyTeam | One company at a time: teams, cycles, objectives, key results, check-ins, KPIs with formulas, and tasks | [reference/flowyteam-okr-kpi-tasks-model.md](reference/flowyteam-okr-kpi-tasks-model.md) |

## Provenance and licensing

OpenOKR is a new product. It is not a fork of anything.

The `reference/` knowledge base lets the FlowyTeam importer be built and tested without access to a live FlowyTeam instance. FlowyTeam is proprietary. OpenOKR reads its database, meaning data and not code, and reproduces observable behaviour described in our own words.

The OKR practice in METHOD.md is method, not expression: rules, thresholds, taxonomies and agendas, written here in our own words. No third party's copy, branding, typefaces, logos or course material appears anywhere in the product.

OpenOKR's own code is AGPL-3.0 with a contributor licence agreement. See [PLAN.md](PLAN.md) §4.
