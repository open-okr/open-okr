<div align="center">

# 🎯 OpenOKR

### Your OKR coach, built in.

**Open source · AI-native · Self-hosted, on one server or on Kubernetes**

[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/open-okr/open-okr?label=release)](https://github.com/open-okr/open-okr/releases/latest)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](#-the-stack)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-the%20only%20required%20service-336791.svg)](#-the-stack)
[![Self-hosted](https://img.shields.io/badge/self--host-never%20feature--gated-success.svg)](#-install-it)

[Install it](#-install-it) ·
[Documentation](docs/README.md) ·
[The method](docs/specification/METHOD.md) ·
[The specification](docs/specification/README.md) ·
[Releases](https://github.com/open-okr/open-okr/releases) ·
[Contributing](CONTRIBUTING.md)

<br/>

<img src="docs/mockups/png/01-work-map.png" alt="The Work Map. One tree of goals, key results, initiatives and KPIs. An outdated badge overrides reported health. An unhealthy KPI shows its recovery objective." width="90%"/>

</div>

---

Most organisations do not fail at OKRs because their software was bad. They fail because the practice never happened. Somebody wrote objectives in a spreadsheet in January, nobody checked in by March, and the quarterly review was a meeting where everyone agreed things had gone reasonably well.

The practice that makes OKRs work has been understood for twenty years. It just does not live in the software.

| What organisations use today | Why the practice still dies |
|---|---|
| **Spreadsheets** | No cadence, no accountability, no quality bar. Nobody is ever told anything |
| **Conventional OKR trackers** | A database with a progress bar. They store objectives faithfully and are entirely passive |
| **Consulting and training** | The method is real, but it walks out of the door with the consultant. Nothing keeps it going on a wet Tuesday in week six |

OpenOKR fixes this in two ways at once.

## ✨ What makes it different

### 1. The method is in the product

The full OKR practice ships as executable rules, not templates or help articles: a guided eight-phase cycle, twenty-six quality checks that run as you type, publish gates, an alignment health score that names its own gaps, KPI health bands with recovery OKRs, the weekly, monthly and quarterly rituals, and a diagnostic at the close.

The whole canon lives in [one specification](docs/specification/METHOD.md) and compiles into a pure library with no database, no network and no AI dependency. The same rules run in the browser as you type, on the server before any write, inside the agents, and in the importer. A conformance suite fails the build when the specification and the code disagree.

Every coaching message cites the rule behind it, so you can open the rule and argue with it. Nothing is a mysterious red dot.

### 2. Defaults, not dogma

Every rule is a recommended default, backed by published practice, and an organisation can change it. Twenty-five practice settings cover who may write and when, how binding the planning phases are, committed and aspirational objectives, the kinds of key result in use, which checks and gates block, warn or are off, how confidence is shown, score colours, how the quarterly review runs, and more. Five profiles set them in one move:

| Profile | For |
|---|---|
| **Recommended** | Most organisations. The defaults in the method |
| **Google-style** | Organisations following Google's playbook closely |
| **Radical Focus** | Small companies and teams starting out, following Wodtke |
| **Lightweight** | Teams that want to track OKRs without the planning workflow |
| **Governed** | Organisations that run a formal planning process |

By default anybody who can edit a space can write and change its OKRs at any time, coaching never refuses them, and only structural defects block publishing.

### 3. The product is active

Two AI teammates ship with every workspace. They are members, not features: they have names, they appear in feeds, they can be mentioned, and they are accountable.

| Agent | Guards | What it actually does |
|---|---|---|
| 🧠 **OKR Coach** | Quality | Reviews every draft against the quality checks. Flags the task-shaped key result, the missing baseline, the sandbagged confidence, and the goal reported on track whose numbers have not moved. Runs a nightly semantic sweep for duplicated metrics, better parents and hidden dependencies |
| ⏰ **OKR Champion** | Rhythm | Reminds the champion before a check-in is due and escalates visibly up a ladder that stops at the space coordinator. Holds every blocker's next action to the next check-in. Opens and closes the weekly session, keeps the streak, watches every KPI band, and drafts the recovery OKR when one stays unhealthy. Sends any one person at most five nudges a week; the rest wait in their morning summary |

They reach you in the browser, in **Slack, Microsoft Teams, WhatsApp and Telegram**, by email, and through **your own AI agent**. Everything a human can do, an agent can do, through one permission-checked contract, so your Claude, ChatGPT or Cursor works as you, within your permissions, fully audited.

### And it all works with AI switched off

Every rule, nudge, escalation, gate, score, band and diagnostic is deterministic code, not a prompt. Turn the AI provider off and the coach still coaches. That makes OpenOKR fit for regulated, air-gapped and AI-sceptical environments that would reject an LLM-dependent product outright. AI adds drafting, rewriting, semantic judgement and language. It never makes the decision.

## 📸 A tour of the product

The images are the reference mockups the screens are built from.

<details open>
<summary><b>Quality at the point of writing</b>: twenty-six checks judge every line as it is typed</summary>
<br/>

Each check returns pass, warn or fail with a coaching prompt, the reason it matters and a weak-versus-strong example. The set carries a live strength score. "Hold twelve customer interviews" gets asked what the interviews are for. A target without a baseline gets told movement cannot be proved.

<img src="docs/mockups/png/03-draft-coach.png" alt="Drafting with the coach running. Rule verdicts appear inline and the strength meter updates on every keystroke." width="90%"/>

Every verdict opens into the rule itself. Coaching is arguable by design.

<img src="docs/mockups/png/03b-rule-card.png" alt="A coaching card: the prompt, the reason, the weak-versus-strong pair, and a rewrite to apply or dismiss." width="60%"/>

</details>

<details>
<summary><b>Publish gates</b>: a set is checked before it goes live</summary>
<br/>

Six gates run when a cycle's OKRs are published: champions and reviewers named, key results that pass their blocking checks, alignment mapped, dependencies confirmed or risk-owned, capacity checked with the cuts recorded, and a publication date. Each gate blocks, warns or is off. By default the two structural gates block and the rest warn, and an admin may override a blocking gate with a recorded reason. The company set publishes before the cycle starts, the team sets in its first weeks.

<img src="docs/mockups/png/04-gates-capacity.png" alt="Align and commit. Capacity is read from the initiatives actually planned, and the gates are listed with the reason each one is unmet." width="90%"/>

The capacity gate is the one most organisations have never had. A plan where nothing was cut is a plan that has not been made.

</details>

<details>
<summary><b>The guided cycle</b>: eight phases with computed completion, not self-reported ticks</summary>
<br/>

The product knows which phase it is in, what is missing, who owes what, and how many weeks remain. By default the phases guide rather than lock; a workspace that runs a formal planning process can make them binding, and one that only tracks OKRs can hide them.

<img src="docs/mockups/png/02-cycle-workspace.png" alt="Phase 1. The input pack shows which of its seven items are missing." width="90%"/>

</details>

<details>
<summary><b>Committed and aspirational, and four kinds of key result</b></summary>
<br/>

Every objective is committed, expected to land at 1.0, or aspirational, where 0.7 is a good result. Each key result is a metric moved from a baseline to a target, a number maintained inside a band, a milestone done by a date, or a baseline established. Each is scored by its own kind, a committed miss asks for an explanation, and a computed score may be adjusted at the close with a reason.

OKRs can be added, stopped, re-parented or moved to another space mid-cycle. Easing a target asks for a reason, and the history keeps every change.

</details>

<details>
<summary><b>Alignment that means something</b>: contribution, not copying</summary>
<br/>

Vertical alignment is contribution. Horizontal alignment is a dependency both teams know about, which can be escalated when it stalls. The product scores alignment health as the share of goals aligned or standing alone with a reason, names every gap, and the Coach's nightly sweep finds what structure alone cannot see.

<img src="docs/mockups/png/05-alignment-studio.png" alt="The OKRs diagram. Key results sit inside each objective's card, an objective hangs from the key result it aligns to, and the alignment panel names each gap." width="90%"/>

</details>

<details>
<summary><b>KPIs and recovery OKRs</b>: the fix is visible before the number catches up</summary>
<br/>

Every KPI sits in a health band in its own units: above a threshold, below one, or inside a range. When one turns unhealthy, OpenOKR offers three responses: fix it now as day-to-day work, add a key result to an existing objective, or launch a recovery OKR, drafted with one key result per leading driver. The KPI then shows its real band and the recovery's progress side by side.

<img src="docs/mockups/png/06-kpi-recovery.png" alt="A KPI driver tree with a live recovery objective and the cross-tree recovery board." width="90%"/>

</details>

<details>
<summary><b>The weekly, monthly and quarterly rhythm</b>: run by the product, not remembered by a person</summary>
<br/>

The weekly check-in is fifteen to thirty minutes in four steps: a private confidence round revealed together, what dropped, with a next action due by the next check-in for every low score and a typed blocker where something is actually stuck, commitments and wins, and a generated digest. A space may check in weekly, every two weeks or monthly. Holidays pause the rhythm without breaking the streak, and a member on leave names a delegate.

<img src="docs/mockups/png/07-weekly-session.png" alt="The weekly session mid-flight. Team votes reveal together. A low score has a next action and an owner." width="90%"/>

The quarterly review is ninety minutes, four acts and eleven timed stages, in one session or as a review and a separate retrospective. It ends in a diagnosis measured from the cycle's real check-ins: was the miss a strategy problem or a rhythm problem? That is the one question every executive asks and no tracker answers. An annual review closes the year the same way.

<img src="docs/mockups/png/08-quarterly-review.png" alt="The quarterly review at the root-cause stage. The diagnostic reads the cycle score against the rhythm score and returns a verdict with a prescription." width="90%"/>

</details>

<details>
<summary><b>Accountability that reaches people</b>: the review inbox, and four chat channels</summary>
<br/>

The review inbox says what you owe, computed on the server, overdue first. Every proactive message shows its provenance: which rule sent it, on which channel, and where it sits on the escalation ladder. A snooze quietens the message and never hides the obligation.

<img src="docs/mockups/png/10-review-inbox.png" alt="The review inbox. Every message shows the rule that sent it, the channel, and its escalation step." width="90%"/>

Every channel is two-way: nudges out, real work in. A check-in typed into WhatsApp runs through the same permission checks as a click in the browser.

<img src="docs/mockups/png/09-channels.png" alt="The same practice on four channels: Slack cards, a Teams adaptive card, a conversational WhatsApp check-in, and a Telegram escalation." width="90%"/>

</details>

## 🧩 Everything in the box

Nothing is gated behind a paid tier. The [product overview](docs/specification/OVERVIEW.md) walks through every part.

| Pillar | What it holds |
|---|---|
| **The OKR core** | Annual and quarterly cycles, the eight guided phases, committed and aspirational objectives, four kinds of key result with baseline, history and a trend forecast, alignment with a dependency register, KPI driver trees with calculated formulas, health bands and recovery boards, check-ins with immutable snapshots, a scorecard by cycle |
| **The practice settings** | Twenty-five settings and five profiles, with the recommended default for every one. A closed cycle keeps the rules it ran under |
| **The rhythm** | The four-step weekly session, seven blocker types held to the next check-in, commitments and wins, the monthly review with its decision log, the eleven-stage quarterly review and the annual review, holidays and leave, staleness that overrides reported health, the review inbox and digests |
| **The work** | Initiatives that move a key result, a key-result-linked kanban board, rich documents with versions, and files. Deliberately OKR-shaped, not a project management suite |
| **Coaching and AI** | The twenty-six-check engine, both agents, propose-by-default governance with hard cost caps, a grounded copilot, and bring-your-own AI: Anthropic, OpenAI, Google, OpenRouter, Ollama or any compatible endpoint, including fully local |
| **Channels and reach** | Browser, email, Slack, Microsoft Teams, WhatsApp, Telegram, and an external agent surface with a consent screen and a full audited tool catalogue |
| **Platform** | Spaces, people and org chart, relationship-based access control with workspace roles, single sign-on and directory sync, comments and notifications with quiet hours, a live activity feed, search, admin, a tamper-evident audit log, signed workspace export, spreadsheet and FlowyTeam importers, WCAG 2.1 AA target, English and Bahasa Melayu |

## 🚀 Install it

PostgreSQL is the only service OpenOKR requires. No mail server, no AI provider, no identity provider. Every one of those is optional and the product is whole without them.

| Option | Who it suits | What it takes |
|---|---|---|
| **One server with Docker Compose** | Any organisation that wants its data on its own machines | One command, then a web wizard in the browser |
| **Kubernetes with Helm** | Universities, government and large enterprises | A chart, your PostgreSQL, your ingress, your backups |
| **A local checkout** | Contributors, and anyone evaluating the code | Node 22 and pnpm |

**Self-host is never seat-limited and never feature-gated.** Air-gapped installation is supported: a local AI model or none at all, self-hosted assets, and telemetry only if you opt in.

Every release publishes a multi-architecture image to `ghcr.io/open-okr/open-okr`, signed with cosign and with a software bill of materials, and the Helm chart to `oci://ghcr.io/open-okr/charts/openokr`. [Releases](https://github.com/open-okr/open-okr/releases) lists them with their notes.

### Option 1: one server with Docker Compose

**What you need first**

| Requirement | Why |
|---|---|
| Docker and Docker Compose | The whole instance runs as containers |
| 2 CPU cores, 4 GB memory, 20 GB disk | Comfortable for a few hundred people. The database is what grows |
| Ports 80 and 443 free | The bundled Caddy proxy answers on them. Both are overridable |
| A DNS name pointing at the machine, for HTTPS | Certificates are issued automatically for a real name, and skipped without one |

**1. Get the deployment files.**

```sh
git clone https://github.com/open-okr/open-okr.git
cd open-okr/deploy/docker
```

**2. Start the instance.**

```sh
./openokr up
```

For a real domain with an automatic certificate, and a pinned release, which is the better habit on a server:

```sh
OPENOKR_DOMAIN=okr.example.com OPENOKR_IMAGE=ghcr.io/open-okr/open-okr:0.2.0 ./openokr up
```

With no domain it serves plain HTTP on `http://localhost`, which is right for a laptop and wrong for a server anybody else reaches.

On the first run this generates every secret it needs into `./secrets/` with mode 600, pulls the image, starts PostgreSQL, runs the migrations, starts the application and the proxy, and waits until the application answers its own health check. It prints the address to open when it is ready.

**3. Finish setup in the browser.**

Open the address it printed. The wizard asks for one thing: the account that owns the instance. Name, address, and a password of at least twelve characters.

Registration closes the moment that account exists. Everybody after you joins by invitation, which is the point: an instance on the open internet with open registration is a mailing list.

That is the install. You are signed in, you have a workspace, and both agents are already members of it.

**4. Back up `deploy/docker/secrets/`.**

It holds the root encryption key. Lose it and stored credentials, such as mail passwords, channel credentials and AI provider keys, become unreadable while everything else keeps working. That is the worst way to find out.

**Everyday commands**, run from `deploy/docker/`:

| Command | What it does |
|---|---|
| `./openokr status` | What is running, and whether it is healthy |
| `./openokr logs` | Follow the application log. `./openokr logs proxy` for the proxy |
| `./openokr upgrade` | Back up, pull the new image, restart, re-run migrations, report |
| `./openokr backup` | An encrypted database dump and a copy of the files, with a checksum |
| `./openokr verify-backup DIR` | Prove a backup would restore, without touching the live database |
| `./openokr restore DIR` | Restore from a directory `backup` made |
| `./openokr rotate-key` | Re-wrap every stored secret under a new root key |
| `./openokr down` | Stop, keeping the data |
| `./openokr destroy` | Stop and delete every volume. There is no undo |

The full page, including building the image yourself and what to do when it does not come up, is [Install on one server](docs/install/compose.md).

### Option 2: Kubernetes with Helm

The chart deploys no database, manages no certificates and runs no mail server. Your cluster already has answers for all three.

```sh
kubectl create namespace openokr
kubectl -n openokr create secret generic openokr-database \
  --from-literal=database-url='postgres://user:password@host:5432/openokr'

helm install openokr oci://ghcr.io/open-okr/charts/openokr \
  --version 0.2.0 \
  --namespace openokr \
  --set database.existingSecret=openokr-database \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=okr.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

Keep the connection string in a Secret rather than on the command line: a URL passed with `--set database.url` lands in the release's stored values, which anyone with `helm get values` can read. The PostgreSQL needs the `pgvector` extension available, and the role must not be a superuser or have `BYPASSRLS`, because row-level security is what keeps one workspace out of another's rows.

Then open the host, and the first-run wizard takes over exactly as it does on a single server. Migrations run as a hook from the same image before the application rolls, so an upgrade is `helm upgrade` and nothing else.

**Back up the generated Secret.** The chart generates a root encryption key on first install, keeps it across upgrades and across `helm uninstall`, and cannot recover it.

```sh
kubectl -n openokr get secret openokr-secrets -o yaml > openokr-secrets-backup.yaml
```

Two pages cover the rest: [Install on Kubernetes](docs/install/kubernetes.md) for what surrounds the chart, and [the chart's own README](deploy/helm/README.md) for every value worth knowing.

### Option 3: run it from a checkout

For contributors, and for anyone who wants to read the code while it runs. Node 22 is required, and pnpm comes through Corepack.

```sh
git clone https://github.com/open-okr/open-okr.git
cd open-okr
corepack enable
pnpm install

pnpm db:up                       # PostgreSQL in Docker on port 55432
docker exec openokr-test-postgres-1 psql -U postgres -c "CREATE DATABASE openokr;"
cp .env.example apps/web/.env
DATABASE_URL=postgres://postgres:postgres@localhost:55432/openokr pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`. A database with no account in it redirects to `/setup`, the same first-run wizard the Compose target serves. Everything else has a working default, so nothing above needs editing to boot.

To see the product with a year of data in it, run `pnpm db:seed` after the wizard: it fills the workspace with [a year of OKRs at Northwind](docs/scenarios/northwind-year/README.md), placed on the real calendar as of today.

Details, and the full command list, are in [CONTRIBUTING.md](CONTRIBUTING.md).

### After the install

| Next | Page |
|---|---|
| What the wizard did, and the five things worth doing next | [The first run](docs/install/first-run.md) |
| People, security, settings, backups, upgrades | [Administrator guide](docs/admin/README.md) |
| Choosing how your organisation runs OKRs | [Settings](docs/admin/settings.md) and [the OKR handbook](docs/handbook/README.md) |
| Turning on mail, AI, Slack, Teams, WhatsApp or Telegram | [Settings](docs/admin/settings.md) |
| Bringing objectives in from a spreadsheet or FlowyTeam | [Importing](docs/import/README.md) |
| Moving to a new release | [Upgrade](docs/runbooks/upgrade.md) |
| Running with no route to the internet | [Air gap](docs/runbooks/air-gap.md) |
| Something is wrong right now | [Incident runbook](docs/runbooks/incident.md) |

## 🛠 The stack

TypeScript in strict mode everywhere. Next.js App Router and React. PostgreSQL through Drizzle, with row-level security in the database as the tenant floor. Better Auth. Tailwind with shadcn/ui. Turborepo and pnpm. Vitest and Playwright.

| Principle | What it buys |
|---|---|
| **The method is a pure library** | The same rules everywhere, and a build that fails when code drifts from the specification |
| **One write path** | Every write is one transaction: the change, its audit row and its outbox row commit together |
| **Tenant isolation in the database** | Row-level security shipped in the same migration as every table. Application code cannot leak across tenants even if it is wrong |
| **One authorisation checkpoint** | Every read of a protected object goes through a single access-aware getter. No per-endpoint checks |
| **One contract, many surfaces** | The API, OpenAPI, the CLI, the agent tool catalogue and the chat commands are generated projections of one action registry, checked for drift in CI |
| **Vendor code is quarantined** | No vendor SDK outside one adapters package. That is what makes air-gapped operation real rather than aspirational |

```
apps/web            Next.js app: interface, internal API, public REST, agent endpoint, channel webhooks
packages/method     The METHOD.md canon as data and pure functions. No I/O
packages/core       Domain logic, the Operation pipeline, the action registry, access, the engines
packages/db         Drizzle schema, migrations, row-level security, the data-change runner
packages/adapters   Ports and drivers, the only place vendor SDKs live, and the outbox relay
packages/agents     Agent runs, their schedule, structured extraction and the AI capabilities
packages/importer   The import command line and the FlowyTeam connector
packages/cli        The `okr` command line, generated from the contract
packages/ui         Shared components
deploy/             Docker Compose, the Helm chart, and the cloud overlay
```

## 📚 Documentation

| Read this | If you want |
|---|---|
| [**The documentation index**](docs/README.md) | Everything below, plus the administrator guide, the user guide, the API and the runbooks |
| [Install on one server](docs/install/compose.md) · [on Kubernetes](docs/install/kubernetes.md) · [the first run](docs/install/first-run.md) | To put it on a machine |
| [The OKR handbook](docs/handbook/README.md) | To run the practice, rather than to build the software |
| [A year of OKRs at Northwind](docs/scenarios/northwind-year/README.md) | One company's full year in OpenOKR, step by step |
| [The product overview](docs/specification/OVERVIEW.md) | The product explained for users and administrators |
| [METHOD.md](docs/specification/METHOD.md) | The OKR practice canon: every rule, band, setting, taxonomy and ritual the product encodes |
| [The specification](docs/specification/README.md) · [the designs](docs/design/) | Requirements, architecture, the technical design, the AI design and the interface |
| [The API](docs/api/README.md) | Tokens, scopes, the command line and the agent surface |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [GOVERNANCE.md](GOVERNANCE.md) | To contribute, and to know who decides what |
| [CLAUDE.md](CLAUDE.md) | The working rules for AI coding agents in this repository |

## 🤝 Working with us

Three different conversations, depending on who you are.

| If you are | The ask | What you get |
|---|---|---|
| **A methodology practitioner** | Review [the method](docs/specification/METHOD.md) and challenge any rule, threshold or agenda you think is wrong | Your practice becomes enforceable software, with every rule attributable, versioned and arguable |
| **An organisation running OKRs** | Run a real quarter on it and tell us where the coaching is wrong | Direct influence on the rules, and no lock-in because the whole workspace exports at any time |
| **A contributor** | Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [good first issues](docs/runbooks/good-first-issues.md) | A codebase where the interesting problems are method, coaching and agents, not CRUD |

Found a bug? [Open an issue](https://github.com/open-okr/open-okr/issues/new/choose) with what you ran and what it printed. Security reports go through the route in the issue chooser, not a public issue.

## ⚖️ Licence

**AGPL-3.0** with a lightweight contributor licence agreement. The full text is in [LICENSE](LICENSE), the reasoning in [PLAN.md §4](docs/specification/PLAN.md), and the agreement in [CONTRIBUTING.md](CONTRIBUTING.md).

- AGPL stops a third party from selling a closed hosted version. Anyone who modifies it and offers it over a network must publish their changes.
- An organisation that self-hosts for its own staff takes on no obligations at all.
- The methodology is implemented in our own words. No third party's copy, branding or course material appears in the product.

---

<div align="center">

**The practice, inside the product.** ⭐ Star the repository to follow new releases.

</div>
