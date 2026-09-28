<div align="center">

# 🎯 OpenOKR

### Your OKR coach, built in.

**Open source · AI-native · Self-hosted, on one server or on Kubernetes**

[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](#the-stack)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-the%20only%20required%20service-336791.svg)](#the-stack)
[![Status](https://img.shields.io/badge/status-feature%20complete%2C%20pre--release-yellow.svg)](docs/development-plan/STATUS.md)
[![Self-hosted](https://img.shields.io/badge/self--host-never%20feature--gated-success.svg)](#-install-it)

[Install it](#-install-it) ·
[Documentation](docs/README.md) ·
[Product overview (PDF)](docs/stakeholder/OpenOKR-Overview.pdf) ·
[Pitch deck (PDF)](docs/stakeholder/OpenOKR-Deck.pdf) ·
[The method](docs/development-plan/METHOD.md) ·
[The plan](docs/development-plan/) ·
[Live status](docs/development-plan/STATUS.md)

<br/>

<img src="docs/stakeholder/mockups/png/01-work-map.png" alt="The Work Map. One tree of goals, key results, initiatives and KPIs. An outdated badge overrides reported health. An unhealthy KPI shows a live recovery objective." width="90%"/>

</div>

---

Most organisations do not fail at OKRs because their software was bad. They fail because the practice never happened. Somebody wrote objectives in a spreadsheet in January, nobody checked in by March, and the quarterly review was a meeting where everyone agreed things had gone reasonably well.

The practice that makes OKRs work has been understood for twenty years. It just does not live in the software.

| What organisations use today | Why the practice still dies |
|---|---|
| **Spreadsheets** | No cadence, no accountability, no quality bar. Nobody is ever told anything |
| **Conventional OKR trackers** | A database with a progress bar. They store objectives faithfully and are entirely passive |
| **Consulting and training** | The method is real, but it walks out of the door with the consultant. Nothing enforces it on a wet Tuesday in week six |

OpenOKR fixes this in two ways at once.

## ✨ What makes it different

### 1. The method is in the product

The full OKR practice ships as executable rules, not templates or help articles: a guided eight-phase cycle, twenty-six quality checks that run as you type, six hard publish gates, an alignment health score that names its own gaps, KPI health corridors with automatic recovery objectives, two timed session formats, and a diagnostic at the close.

The whole canon lives in [one specification](docs/development-plan/METHOD.md) and compiles into a pure library with no database, no network and no AI dependency. The same rules run in the browser as you type, on the server before any write, inside the agents, and in the importer. A conformance suite fails the build when the specification and the code disagree.

Every coaching message cites the rule behind it, so you can open the rule and argue with it. Nothing is a mysterious red dot.

### 2. The product is active

Two AI teammates ship with every workspace. They are members, not features: they have names, they appear in feeds, they can be mentioned, and they are accountable.

| Agent | Guards | What it actually does |
|---|---|---|
| 🧠 **OKR Coach** | Quality | Reviews every draft against the quality checks. Flags the task-shaped key result, the missing baseline, the empty not-doing list, the sandbagged confidence, and the goal reported on track whose numbers have not moved. Runs a nightly semantic sweep for duplicated metrics, better parents and hidden dependencies |
| ⏰ **OKR Champion** | Rhythm | Reminds the champion before a check-in is due and escalates visibly up a five-step ladder. Runs the blocker clock with a warning at twenty hours and an escalation at twenty-four. Opens and closes the weekly session, keeps the streak, watches every KPI corridor, and drafts the recovery objective when one drops out of range |

They reach you in the browser, in **Slack, Microsoft Teams, WhatsApp and Telegram**, by email, and through **your own AI agent**. Everything a human can do, an agent can do, through one permission-checked contract, so your Claude, ChatGPT or Cursor works as you, within your permissions, fully audited.

### And it all works with AI switched off

Every rule, nudge, escalation, gate, score, corridor and diagnostic is deterministic code, not a prompt. Turn the AI provider off and the coach still coaches. That makes OpenOKR fit for regulated, air-gapped and AI-sceptical environments that would reject an LLM-dependent product outright. AI adds drafting, rewriting, semantic judgement and language. It never makes the decision.

## 📸 A tour of the product

<details open>
<summary><b>Quality at the point of writing</b>: twenty-six checks judge every line as it is typed</summary>
<br/>

Each check returns pass, warn or fail with a coaching prompt, the reason it matters and a weak-versus-strong example. The set carries a live strength score. "Hold twelve customer interviews" gets asked what the interviews are for. A target without a baseline gets told movement cannot be proved.

<img src="docs/stakeholder/mockups/png/03-draft-coach.png" alt="Drafting with the coach running. Rule verdicts appear inline and the strength meter updates on every keystroke." width="90%"/>

Every verdict opens into the rule itself. Coaching is arguable by design.

<img src="docs/stakeholder/mockups/png/03b-rule-card.png" alt="A coaching card: the prompt, the reason, the weak-versus-strong pair, and a rewrite to apply or dismiss." width="60%"/>

</details>

<details>
<summary><b>Six publish gates, enforced</b>: a weak OKR set cannot be published</summary>
<br/>

Every objective needs a champion and a reviewer. Every key result must pass its checks. Alignment must be mapped, dependencies confirmed or risk-owned, capacity checked with the cuts recorded, and a publication date set. Fail one and the publish control is disabled with the reason stated.

<img src="docs/stakeholder/mockups/png/04-gates-capacity.png" alt="Align and commit. Capacity is read from the initiatives actually planned. One key result exceeds and nothing was cut, so gate five stays red." width="90%"/>

Gate five is the one most organisations have never had. A plan where nothing was cut is a plan that has not been made.

</details>

<details>
<summary><b>The guided cycle</b>: eight phases with computed completion, not self-reported ticks</summary>
<br/>

The product knows which phase it is in, what is missing, who owes what, and how many weeks remain. Drafting is refused until the input pack is complete, because a planning session without inputs produces objectives written from opinion.

<img src="docs/stakeholder/mockups/png/02-cycle-workspace.png" alt="Phase 1. Drafting is locked because three of seven input pack items are missing, and the block states exactly which." width="90%"/>

</details>

<details>
<summary><b>Alignment that means something</b>: contribution, not copying</summary>
<br/>

Vertical alignment is contribution. Horizontal alignment is a dependency both teams know about. The product scores alignment health and names every gap, and the Coach's nightly sweep finds what structure alone cannot see.

<img src="docs/stakeholder/mockups/png/05-alignment-studio.png" alt="The alignment studio. Solid connectors are contribution, dashed are dependencies. The orphan goal is flagged and the health score names each gap." width="90%"/>

</details>

<details>
<summary><b>KPI corridors and recovery objectives</b>: the fix is visible before the number catches up</summary>
<br/>

Every KPI sits in a health corridor. When one turns unhealthy, OpenOKR drafts a recovery objective, one key result per leading child driver. The KPI reads "recovering" and its effective health rises with the recovery's progress.

<img src="docs/stakeholder/mockups/png/06-kpi-recovery.png" alt="A KPI driver tree with a live recovery objective and the cross-tree recovery board." width="90%"/>

</details>

<details>
<summary><b>The weekly and quarterly rhythm</b>: run by the product, not remembered by a person</summary>
<br/>

The weekly session is fifteen to thirty minutes in four steps: a private confidence round revealed together, blockers typed against a five-item taxonomy with an owner and a twenty-four hour clock, commitments closed out loud, and a generated digest. It ends with a streak.

<img src="docs/stakeholder/mockups/png/07-weekly-session.png" alt="The weekly session mid-flight. Team votes reveal together. A low score has become a typed blocker with an owner and a clock." width="90%"/>

The quarterly review is sixty minutes, three acts, eleven timed stages, and it ends in a diagnosis: was the miss a strategy problem or a cadence problem? That is the one question every executive asks and no tracker answers.

<img src="docs/stakeholder/mockups/png/08-quarterly-review.png" alt="The quarterly review at the root-cause stage. The diagnostic reads the cycle score against the rhythm score and returns a verdict with a prescription." width="90%"/>

</details>

<details>
<summary><b>Accountability that reaches people</b>: the review inbox, and four chat channels</summary>
<br/>

The review inbox says what you owe, computed on the server, overdue first. Every proactive message shows its provenance: which rule sent it, on which channel, and where it sits on the escalation ladder. A snooze quietens the message and never hides the obligation.

<img src="docs/stakeholder/mockups/png/10-review-inbox.png" alt="The review inbox. Every message shows the rule that sent it, the channel, and its escalation step." width="90%"/>

Every channel is two-way: nudges out, real work in. A check-in typed into WhatsApp runs through the same permission checks as a click in the browser.

<img src="docs/stakeholder/mockups/png/09-channels.png" alt="The same practice on four channels: Slack cards, a Teams adaptive card, a conversational WhatsApp check-in, and a Telegram escalation." width="90%"/>

</details>

## 🧩 Everything in the box

Nothing is gated behind a paid tier. See the [full module inventory](docs/stakeholder/OpenOKR-Overview.md) for the complete list.

| Pillar | What it holds |
|---|---|
| **The OKR core** | Annual and quarterly cycles, the eight guided phases, weighted direction-aware key results with baseline, history and a trend forecast, alignment with a dependency register, KPI driver trees with calculated formulas, health corridors and recovery boards, check-ins with immutable snapshots |
| **The rhythm** | The four-step weekly session, a five-type blocker taxonomy on a 24-hour clock, commitments, monthly reviews with a decision log, the eleven-stage quarterly review, staleness that overrides reported health, the review inbox and digests |
| **The work** | Initiatives that move a key result, a key-result-linked kanban board, rich documents with versions, and files. Deliberately OKR-shaped, not a project management suite |
| **Coaching and AI** | The twenty-six-check engine, both agents, propose-by-default governance with hard cost caps, a grounded copilot, and bring-your-own AI: Anthropic, OpenAI, Google, OpenRouter, Ollama or any compatible endpoint, including fully local |
| **Channels and reach** | Browser, email, Slack, Microsoft Teams, WhatsApp, Telegram, and an external agent surface with a consent screen and a full audited tool catalogue |
| **Platform** | Spaces, people and org chart, relationship-based access control, comments and notifications with quiet hours, a live activity feed, search, admin, a tamper-evident audit log, signed workspace export, spreadsheet and FlowyTeam importers, WCAG 2.1 AA target, English and Bahasa Melayu at launch |

## 🚀 Install it

PostgreSQL is the only service OpenOKR requires. No mail server, no AI provider, no identity provider. Every one of those is optional and the product is whole without them.

| Option | Who it suits | What it takes |
|---|---|---|
| **One server with Docker Compose** | Any organisation that wants its data on its own machines | One command, then a web wizard in the browser |
| **Kubernetes with Helm** | Universities, government and large enterprises | A chart, your PostgreSQL, your ingress, your backups |
| **A local checkout** | Contributors, and anyone evaluating the code | Node 22 and pnpm |

**Self-host is never seat-limited and never feature-gated.** Air-gapped installation is supported: a local AI model or none at all, self-hosted assets, and telemetry only if you opt in.

> **There is no tagged release yet.** Nothing has been published, so neither the image at `ghcr.io/open-okr/open-okr` nor the chart at `oci://ghcr.io/open-okr/charts/openokr` exists, and a pull of either will fail. Build the image from the checkout, as shown below.
>
> The first `v*.*.*` tag publishes both, signs the image with cosign and attaches a software bill of materials, all from [the release workflow](.github/workflows/release.yml). The build step below then disappears. [Cutting a release](docs/runbooks/release.md) is the procedure.

### Option 1: one server with Docker Compose

**What you need first**

| Requirement | Why |
|---|---|
| Docker and Docker Compose | The whole instance runs as containers |
| 2 CPU cores, 4 GB memory, 20 GB disk | Comfortable for a few hundred people. The database is what grows |
| Ports 80 and 443 free | The bundled Caddy proxy answers on them. Both are overridable |
| A DNS name pointing at the machine, for HTTPS | Certificates are issued automatically for a real name, and skipped without one |

**1. Get the code and build the image.**

```sh
git clone https://github.com/open-okr/open-okr.git
cd open-okr
docker build -f deploy/docker/Dockerfile -t openokr:local .
```

The build takes a few minutes and produces one image of roughly 235 MB. It is the same Dockerfile continuous integration builds and the same one a release publishes.

**2. Start the instance.**

```sh
cd deploy/docker
OPENOKR_IMAGE=openokr:local ./openokr up
```

For a real domain with an automatic certificate, name it:

```sh
OPENOKR_DOMAIN=okr.example.com OPENOKR_IMAGE=openokr:local ./openokr up
```

With no domain it serves plain HTTP on `http://localhost`, which is right for a laptop and wrong for a server anybody else reaches.

On the first run this generates every secret it needs into `./secrets/` with mode 600, starts PostgreSQL, runs the migrations, starts the application and the proxy, and waits until the application answers its own health check. It prints the address to open when it is ready. A failed registry pull is not fatal, so a locally built image is a supported path rather than a workaround.

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
| `./openokr upgrade` | Pull the new image, restart, re-run migrations, report |
| `./openokr backup` | An encrypted database dump and a copy of the files, with a checksum |
| `./openokr verify-backup DIR` | Prove a backup would restore, without touching the live database |
| `./openokr restore DIR` | Restore from a directory `backup` made |
| `./openokr rotate-key` | Re-wrap every stored secret under a new root key |
| `./openokr down` | Stop, keeping the data |
| `./openokr destroy` | Stop and delete every volume. There is no undo |

Set `OPENOKR_IMAGE=openokr:local` on `upgrade` too, until a published image exists to pull.

The full page, including what to do when it does not come up, is [Install on one server](docs/install/compose.md).

### Option 2: Kubernetes with Helm

The chart deploys no database, manages no certificates and runs no mail server. Your cluster already has answers for all three.

```sh
git clone https://github.com/open-okr/open-okr.git
cd open-okr

# Build and push to a registry your cluster can reach.
docker build -f deploy/docker/Dockerfile -t registry.example.com/openokr:local .
docker push registry.example.com/openokr:local

helm install openokr ./deploy/helm \
  --namespace openokr --create-namespace \
  --set image.repository=registry.example.com/openokr \
  --set image.tag=local \
  --set database.existingSecret=openokr-database \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=okr.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

Put the connection string in a Secret rather than on the command line. A URL passed with `--set database.url` lands in the release's stored values, which anyone with `helm get values` can read. The PostgreSQL needs the `pgvector` extension available.

Then open the host, and the first-run wizard takes over exactly as it does on a single server. Migrations run as a hook from the same image before the application rolls, so an upgrade is `helm upgrade` and nothing else.

**Back up the generated Secret.** The chart generates a root encryption key on first install, keeps it across upgrades and across `helm uninstall`, and cannot recover it.

```sh
kubectl -n openokr get secret openokr-secrets -o yaml > openokr-secrets-backup.yaml
```

Once a release is tagged this becomes `helm install openokr oci://ghcr.io/open-okr/charts/openokr` with no build and no registry of your own. Every value carries over unchanged.

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

Point the suite at a PostgreSQL you already run with `TEST_DB_PORT` instead of `pnpm db:up`. Details, and the full command list, are in [CONTRIBUTING.md](CONTRIBUTING.md).

### After the install

| Next | Page |
|---|---|
| What the wizard did, and the five things worth doing next | [The first run](docs/install/first-run.md) |
| People, security, settings, backups, upgrades | [Administrator guide](docs/admin/README.md) |
| Turning on mail, AI, Slack, Teams, WhatsApp or Telegram | [Settings](docs/admin/settings.md) |
| Bringing objectives in from a spreadsheet or FlowyTeam | [Importing](docs/import/README.md) |
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

## 🗺 Status and where it stands

**All eight phases are built.** The plan set holds requirements, architecture, the method canon, the complete database schema, the AI and agent design, forty screen specifications and the cloud operator screens, cut into **200 scoped tasks**, each with acceptance criteria and a test plan. Every row in [STATUS.md](docs/development-plan/STATUS.md) reads done.

**No version has been tagged yet**, so nothing is published to a container registry and nobody outside this repository has run it. Treat it as feature complete and unproven in the field rather than as a release. Build the image yourself, as the install section shows.

| Phase | What it delivered |
|---|---|
| **1. Foundation** | Monorepo, CI, the tenant floor, adapter ports, the transactional outbox, auth, workspaces, the write pipeline, Compose and Helm |
| **2. Platform and agent spine** | Access model, people, notifications, the design system, and the AI foundation with metering, caps and the agent runtime |
| **3. The OKR core** | Cycles, goals and key results, scoring and health engines, check-ins, alignment, KPIs and recovery, the Work Map |
| **4. The coaching layer** | The full rule catalogue, the Draft Coach, both agents, all three session formats, the diagnostic, the copilot |
| **5. Reach** | Slack, Teams, WhatsApp, Telegram, the external agent surface, initiatives, tasks, documents and search |
| **6. Data** | The spreadsheet and FlowyTeam importers, workspace export and import, backups with restore drills |
| **7. Hardening** | Performance, load and soak, the security review, the accessibility audit, observability |
| **8. Cloud and launch** | Tenant provisioning, single sign-on and directory sync, the air-gap guide, the documentation set, the hosted demo |

The order was deliberate. The agent foundation landed in phase two so the coaching layer could ship alongside the OKR core. An OKR tool where the coach arrives last is just another tracker.

**What would help most now** is somebody installing it on a machine that is not ours and telling us what broke. Open an issue with what you ran and what it printed.

## 📚 Documentation

| Read this | If you want |
|---|---|
| [**The documentation index**](docs/README.md) | Everything below, plus the administrator guide, the user guide, the API and the runbooks |
| [Install on one server](docs/install/compose.md) · [on Kubernetes](docs/install/kubernetes.md) · [the first run](docs/install/first-run.md) | To put it on a machine |
| [The OKR handbook](docs/handbook/README.md) | To run the practice, rather than to build the software |
| [**Product overview** (PDF)](docs/stakeholder/OpenOKR-Overview.pdf) · [source](docs/stakeholder/OpenOKR-Overview.md) | The complete product on paper: the problem, the method, every module, security, licensing and roadmap. Written for a partner, an investor or an early customer |
| [**Pitch deck** (PDF)](docs/stakeholder/OpenOKR-Deck.pdf) · [pptx](docs/stakeholder/OpenOKR-Deck.pptx) | The same story in 36 slides |
| [OVERVIEW.md](docs/development-plan/OVERVIEW.md) | The product explained for end users |
| [METHOD.md](docs/development-plan/METHOD.md) | The OKR practice canon: every rule, band, corridor, taxonomy and ritual the product encodes |
| [The development plan](docs/development-plan/) | Requirements, architecture, the technical design, the AI design, the UI specifications and the implementation plan |
| [STATUS.md](docs/development-plan/STATUS.md) | Execution status across all 200 tasks, row by row |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [GOVERNANCE.md](GOVERNANCE.md) | To contribute, and to know who decides what |
| [CLAUDE.md](CLAUDE.md) | Working rules for the AI agent that builds it |

## 🤝 Working with us

Three different conversations, depending on who you are.

| If you are | The ask | What you get |
|---|---|---|
| **A methodology practitioner** | Review [the method](docs/development-plan/METHOD.md) and challenge any rule, threshold or agenda you think is wrong | Your practice becomes enforceable software, with every rule attributable, versioned and arguable |
| **An early customer or design partner** | Run a real quarter on it, with us, and tell us where the coaching is wrong | Free pilot use, direct influence on the rules, and no lock-in because the whole workspace exports at any time |
| **A contributor** | Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [good first issues](docs/runbooks/good-first-issues.md). The build follows a strict [task loop](docs/development-plan/IMPLEMENTATION-PLAN.md) with tests first and a definition of done | A codebase where the interesting problems are method, coaching and agents, not CRUD |

## ⚖️ Licence

**AGPL-3.0** with a lightweight contributor licence agreement. The full text is in [LICENSE](LICENSE), the reasoning in [PLAN.md §4](docs/development-plan/PLAN.md), and the agreement in [CONTRIBUTING.md](CONTRIBUTING.md).

- AGPL stops a third party from selling a closed hosted version. Anyone who modifies it and offers it over a network must publish their changes.
- An organisation that self-hosts for its own staff takes on no obligations at all.
- The methodology is implemented in our own words. No third party's copy, branding or course material appears in the product.

---

<div align="center">

**The practice, inside the product.** ⭐ Star the repository to follow the build.

</div>
