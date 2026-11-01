# Self-host

| | |
|---|---|
| URL | `/open-source` |
| Audience | Developers, IT teams, and organisations that keep their data on their own machines |
| The page's one job | Get a running instance in half an hour, and remove every doubt about the licence |
| Primary CTA | Install it |
| Secondary CTA | Star on GitHub |
| Page title | Self-host OpenOKR: open source, every feature, about half an hour · OKRGoal |
| Meta description | Run OpenOKR on your own server with Docker Compose, or on Kubernetes with Helm. PostgreSQL is the only dependency. AGPL-3.0, every feature, no seat limit, no licence key, air-gap capable. |

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, buttons, a terminal showing the install |
| 2 | Four promises | Four short cards |
| 3 | Install in four steps | Numbered steps with code |
| 4 | What you need | Small table |
| 5 | Three ways to run it | Three cards |
| 6 | Day two | The lifecycle helper's commands |
| 7 | Upgrades you control | Short rules |
| 8 | Offline, if you need it | Air-gap checklist |
| 9 | Verify what you run | Supply chain |
| 10 | The licence, in plain English | Three lines |
| 11 | Help when you want it | Community and paid support |
| 12 | FAQ | |
| 13 | Final CTA | Including the install prompt for a coding agent |

---

## 1. Hero

**Eyebrow:** Open source · AGPL-3.0

# Your servers. Half an hour. Every feature.

OpenOKR is open source and complete. Run it on one server with Docker Compose, or on your own Kubernetes with Helm. PostgreSQL is the only thing it needs. Nothing is held back for a paid edition, and nothing limits how many people use it.

**Buttons:** `[ Install it ]` `[ ★ Star on GitHub {stars} ]`

**Terminal, animated line by line:**

```text
$ git clone https://github.com/open-okr/open-okr.git
$ cd open-okr/deploy/docker
$ ./openokr up
  Generating secrets into ./secrets ........ done
  Pulling ghcr.io/open-okr/open-okr ......... done
  Starting PostgreSQL ....................... healthy
  Running migrations ........................ done
  Starting OpenOKR .......................... healthy

  OpenOKR is ready at https://okr.example.com
  Open it to create the owner account.
```

> **Check before publishing:** match the terminal lines to what `./openokr up` prints in the current release. The sequence above follows the README; the exact wording is the helper's.

## 2. Four promises

| Every feature | No seat limit | No licence key | No phone-home |
|---|---|---|---|
| The self-hosted edition and the cloud are the same release. Single sign-on, the audit log, both agents: all of it | A thousand people cost the same as ten: nothing | Nothing to activate, renew or check in with us | No version check leaves your network. Telemetry is off unless you turn it on |

## 3. Install in four steps

## From nothing to signed in.

**1. Get the deployment files.**

```sh
git clone https://github.com/open-okr/open-okr.git
cd open-okr/deploy/docker
```

**2. Start it.**

```sh
./openokr up
```

On a real server, give it a domain and it gets its own certificate:

```sh
OPENOKR_DOMAIN=okr.example.com ./openokr up
```

On the first run it generates every secret it needs, pulls the signed image, starts PostgreSQL, runs the migrations, starts the application and the proxy, and waits until it answers its own health check.

**3. Finish in the browser.**
Open the address it prints. The setup wizard asks for one thing: the account that owns the instance. Registration closes the moment that account exists, and everybody after you joins by invitation. You are signed in, you have a workspace, and both agents are already members of it.

**4. Back up `secrets/`.**
It holds the root encryption key. Lose it, and stored credentials such as mail passwords and AI keys become unreadable. That is the worst way to find out.

**Button:** `[ Read the full install guide ]`

## 4. What you need

| Requirement | Why |
|---|---|
| Docker and Docker Compose | The whole instance runs as containers |
| 2 CPU cores, 4 GB memory, 20 GB disk | Comfortable for a few hundred people. The database is what grows |
| Ports 80 and 443 | The bundled proxy answers on them. Both can be changed |
| A DNS name, for HTTPS | Certificates are issued automatically for a real name |

**Line under the table:** No mail server, no AI provider and no identity provider are required. Each is optional, and the product is whole without them.

## 5. Three ways to run it

| One server | Kubernetes | From a checkout |
|---|---|---|
| **For most organisations.** Docker Compose, a bundled proxy with automatic certificates, and a lifecycle helper for upgrades and backups | **For universities, government and large enterprises.** A Helm chart with your PostgreSQL, your ingress and your backups. Migrations run as a hook before the application rolls | **For contributors and evaluators.** Node 22 and pnpm. Read the code while it runs |
| `./openokr up` | `helm install openokr oci://ghcr.io/open-okr/charts/openokr` | `pnpm dev` |

## 6. Day two

## Run it without a platform team.

The lifecycle helper that installed it also runs it.

| Command | What it does |
|---|---|
| `./openokr status` | What is running, and whether it is healthy |
| `./openokr upgrade` | Back up, pull the new release, restart, migrate, report |
| `./openokr backup` | An encrypted database dump and a copy of the files, with a checksum |
| `./openokr verify-backup` | Prove a backup would restore, without touching the live database |
| `./openokr restore` | Restore from a backup |
| `./openokr rotate-key` | Re-wrap every stored secret under a new root key |
| `./openokr logs` | Follow the application log |

## 7. Upgrades you control

## Nothing updates itself.

You choose when to upgrade. Releases follow semantic versioning: a major release names any action you must take, a minor one needs nothing from you, a patch is a fix. Any release upgrades straight to any later release in the same major, with no stops in between. The helper takes a backup first and will not upgrade without one, because rolling back means restoring that backup.

## 8. Offline, if you need it

## Runs with no route to the internet.

- **AI:** a local model through Ollama or your own inference server, or no AI at all
- **Assets:** fonts and scripts served from the instance, never from a CDN
- **Telemetry:** none, unless you opt in
- **Chat:** optional. Email and the browser cover everything
- **Checked:** an air-gap checklist runs against the source on every change, so a new external call cannot sneak in

**Link:** Read the air-gap guide →

## 9. Verify what you run

## Signed, with a bill of materials.

Every release publishes a multi-architecture image to `ghcr.io/open-okr/open-okr`, signed with cosign and shipped with a software bill of materials, and the Helm chart to `oci://ghcr.io/open-okr/charts/openokr`. Verify the signature before you run it. Pin the version you tested.

## 10. The licence, in plain English

## AGPL-3.0, and what it means for you.

| If you | Then |
|---|---|
| Run OpenOKR for your own organisation's staff | You have no obligations. Use it, change it, keep your changes |
| Change it and offer it to other people over a network | You must publish your changes under the same licence |
| Want to sell a closed hosted version | You cannot. That is what the licence is for |

**Small print:** Contributions come under a lightweight contributor licence agreement, signed with one click. The full reasoning is in PLAN.md §4.

## 11. Help when you want it

## The community, or us.

| Community | Support from OKR Institute |
|---|---|
| GitHub issues and discussions, the documentation, and the runbooks for upgrades, incidents and the air gap. Free | For organisations that want a named contact, response times in a contract, help with the rollout and help passing the security review. Same open source product |
| `[ Open GitHub ]` | `[ Talk to us ]` |

## 12. FAQ

**Is the self-hosted edition really complete?**
Yes. It is the same release the cloud runs. There is no enterprise edition, no licence key and no feature flag that a payment turns on.

**What does it cost to run?**
The server. A small machine with 2 CPU cores and 4 GB of memory is comfortable for a few hundred people. If you connect an AI provider, you pay that provider for what you use, and you can cap it.

**Can we start self-hosted and move to the cloud later, or the other way round?**
Yes. Export the workspace to a signed, encrypted archive and import it into the other, after a dry run. It works in both directions.

**Do we need Kubernetes?**
No. One server with Docker Compose is the main path. The Helm chart is there for organisations that already run Kubernetes.

**How do we get security fixes?**
Watch the repository's releases. A patch release carries fixes only and upgrades with one command.

**Can we use it commercially?**
Yes. Running it for your own business is exactly what it is for.

## 13. Final CTA

## Up and running before lunch.

**Buttons:** `[ Install it ]` `[ Try the live demo first ]`

**Or hand this to your coding agent:** `[ Copy install prompt ]`

```text
Install OpenOKR on this machine with Docker Compose.
1. Check that Docker and Docker Compose are installed. If not, tell me how to install them for this system and stop.
2. Run: git clone https://github.com/open-okr/open-okr.git && cd open-okr/deploy/docker && ./openokr up
3. Wait until it prints the address, then tell me to open it and create the owner account in the setup wizard.
4. Remind me to back up deploy/docker/secrets/, because it holds the root encryption key.
```
