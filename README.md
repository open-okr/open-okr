# OpenOKR

**Your OKR coach, built in. Open source, AI-native, self-hosted or in the cloud.**

Most organisations do not fail at OKRs because their tool was bad. They fail because the practice never happened. Objectives get written in January, nobody checks in by March, and the quarterly review is a meeting where everyone agrees things went reasonably well.

OpenOKR fixes that in two ways at once.

**The method is in the product.** A guided eight-phase planning cycle that knows what is missing. Twenty quality rules that check every objective and key result as you type, each with a coaching prompt, the reason it matters and a weak-versus-strong example. Six publish gates that a weak OKR set cannot pass. An alignment score that names its own gaps. KPI health corridors that draft a recovery objective when a metric drops out of range. A four-step weekly session and a timed sixty-minute quarterly review that ends in a real diagnosis.

**The product is active.** Two AI teammates work the practice alongside you. The **OKR Coach** guards quality: it flags the task-shaped key result, the empty not-doing list, the sandbagged confidence, the goal reported on track whose numbers have not moved. The **OKR Champion** guards the rhythm: it nudges the champion whose check-in is due, escalates the blocker that aged past its twenty-four hour clock, chases acknowledgements, runs the weekly session, and prepares the quarterly review pack. They reach you in the browser, in Slack, Microsoft Teams, WhatsApp or Telegram, by email, and through your own AI agent.

Every message cites the rule behind it, so you can argue with it. Turn the AI off entirely and the coach still nudges, escalates, scores and diagnoses, because those rules are real code, not a prompt.

---

## Where things are

This repository currently holds the complete plan. Implementation starts at task `P1-T01`.

| Where | What |
|---|---|
| [docs/development-plan/](docs/development-plan/) | The full plan set. Start with its [README](docs/development-plan/README.md) |
| [docs/development-plan/OVERVIEW.md](docs/development-plan/OVERVIEW.md) | The product overview, written for users rather than builders. Read this first if you want to know what OpenOKR does |
| [docs/development-plan/METHOD.md](docs/development-plan/METHOD.md) | The OKR practice canon: every rule, band, corridor, taxonomy and ritual the product encodes |
| [docs/development-plan/STATUS.md](docs/development-plan/STATUS.md) | Live execution status across 104 tasks |
| [CLAUDE.md](CLAUDE.md) | Working rules for the Claude Code agent that builds it |

## The shape of it

| Area | What it does |
|---|---|
| **The cycle** | Eight guided phases from the annual frame to the close, with computed completion, an input pack that gates drafting, ranked strategic issues, priorities with 12-month success statements, a mandatory not-doing list, and automatic feed-forward into the next cycle |
| **OKRs** | Weighted, direction-aware key results with baseline, target, owner, indicator type, full value history, confidence and a trend forecast that flags a miss before anyone admits it |
| **Alignment** | Vertical contribution across company, department, team and individual, horizontal dependencies between teams, a health score that names its gaps, and a dependency register with confirmations and risk owners |
| **KPIs** | Driver trees, health corridors, calculated formulas over other KPIs, KPI-backed key results, recovery objectives drafted from an unhealthy metric's leading drivers, and a recovery board |
| **The rhythm** | A weekly session with private confidence voting, a five-type blocker taxonomy on a 24-hour clock, commitments, digests and a streak. A monthly review with a decision log. A quarterly review in three acts and eleven timed stages |
| **The coach** | Two scoped, metered, cost-capped agent members that initiate, escalate and propose. They propose by default and you approve |
| **Reach** | Browser, email, Slack, Microsoft Teams, WhatsApp, Telegram, and an agent surface so Claude, ChatGPT, Cursor or a custom agent works as you, within your permissions |
| **The work** | Initiatives that move a key result, a key-result-linked kanban board, and documents. Deliberately OKR-shaped, not a project-management suite |
| **Platform** | Spaces, the Work Map, the review inbox, a live activity feed, notifications that respect your timezone and quiet hours, search, people and org chart, admin, and a tamper-evident audit log |

## Running it

| How | Who it suits | What it takes |
|---|---|---|
| Self-hosted, one server | Any organisation that wants its data on its own machines | One Docker Compose file and a first-run web wizard. About 30 minutes |
| Self-hosted, Kubernetes | Universities and large organisations | A Helm chart, your Postgres, your single sign-on, your backups |
| Managed cloud | Teams that want no operations | Sign up and start |

Both are the same tagged release. Self-host is never seat-limited and never feature-gated. The cloud sells operation, not features.

Postgres is the only required service. Air-gapped installations are fully supported: a local AI model or none at all, self-hosted assets, no telemetry unless you opt in.

## Stack

Next.js with React and TypeScript in strict mode, PostgreSQL through Drizzle with row-level security as the tenant floor, Better Auth, Tailwind with shadcn/ui on Base UI, Turborepo and pnpm, Vitest and Playwright. One action contract registry generates the internal API, the public REST surface, OpenAPI, the command line, the agent tool catalogue and the chat commands, so every surface passes the same permission check.

## Licence

AGPL-3.0 with a contributor licence agreement. See [PLAN.md](docs/development-plan/PLAN.md) §4.
