# OpenOKR documentation

Start where you are.

| You are | Start here |
|---|---|
| Putting OpenOKR on a server | [Install on one server](install/compose.md) |
| Putting it on Kubernetes | [Install on Kubernetes](install/kubernetes.md) |
| Using the managed cloud | [Start on the cloud](install/cloud.md) |
| Running an instance somebody installed | [Administrator guide](admin/README.md) |
| Using OpenOKR day to day | [User guide](use/README.md) |
| Running the OKR practice | [The OKR handbook](handbook/README.md) |
| Calling the API or writing an agent | [The API](api/README.md) |
| Building OpenOKR itself | [CONTRIBUTING.md](../CONTRIBUTING.md) and [the plan set](development-plan/) |

## Install

| Page | What it covers |
|---|---|
| [One server with Docker Compose](install/compose.md) | The whole install, from an empty machine to a signed-in owner |
| [Kubernetes with Helm](install/kubernetes.md) | What the chart does, what it deliberately does not, and the secret to back up |
| [The managed cloud](install/cloud.md) | Signing up, and what the vendor operates |
| [The first run](install/first-run.md) | The wizard, the owner account, and the five things to do next |
| [A public demonstration instance](install/demo.md) | The seeded, self-resetting instance anybody can sign into |
| [Running with no internet](runbooks/air-gap.md) | What works air-gapped, and how to validate it |

## Administering an instance

| Page | What it covers |
|---|---|
| [Administrator guide](admin/README.md) | What an administrator owns, and where each control lives |
| [People and access](admin/people.md) | Invitations, trusted domains, access levels, suspension |
| [Security](admin/security.md) | Single sign-on, directory sync, the second-factor policy, the audit trail |
| [Settings](admin/settings.md) | Every setting that changes behaviour, and its default |
| [Operations](admin/operations.md) | Health, logs, upgrades, backups, restores, key rotation |

## Using it

| Page | What it covers |
|---|---|
| [User guide](use/README.md) | What each screen is for, checking in, the review inbox, KPIs |
| [The OKR handbook](handbook/README.md) | The practice itself, for practitioners rather than builders |
| [Writing objectives and key results](handbook/writing.md) | What a good one looks like, and the checks that fire on a bad one |
| [The weekly rhythm](handbook/weekly.md) | The four-step session, blockers and commitments |
| [The quarterly cycle](handbook/quarterly.md) | Eight phases, six gates, scoring and the closing diagnostic |
| [The numbers](handbook/numbers.md) | Every threshold the practice runs on |
| [Ways of working](handbook/ways-of-working.md) | Spaces, cycles and initiatives for four common shapes of organisation |

## Building on it

| Page | What it covers |
|---|---|
| [The API](api/README.md) | Tokens, scopes, errors, the command line and the agent surface |
| [API reference](api/reference.md) | Every action, generated from the contract |
| [Importing](import/README.md) | Spreadsheets and FlowyTeam, and the rules both obey |

## Runbooks

Written for the person holding the pager, not for a reader.

| Runbook | When you need it |
|---|---|
| [Upgrade](runbooks/upgrade.md) | Moving to a new release |
| [Restore](runbooks/restore.md) | Bringing an instance back from a backup |
| [Incident](runbooks/incident.md) | Something is wrong right now |
| [Observability](runbooks/observability.md) | What the instance reports about itself |
| [Migration cutover](runbooks/migration-cutover.md) | Moving from another system |
| [Air gap](runbooks/air-gap.md) | No route to the internet |
| [Cutting a release](runbooks/release.md) | Tagging a version, and the three checks nobody else will do |
| [The announcement](runbooks/announcement.md) | The text to post when a release goes out |
| [Good first issues](runbooks/good-first-issues.md) | What makes one, and the ones that are open now |

## About the project

| Page | What it covers |
|---|---|
| [The method](development-plan/METHOD.md) | The OKR practice canon. Every rule, threshold and gate the product runs |
| [The plan set](development-plan/) | Requirements, architecture, schema, interface, and the task list |
| [Governance](../GOVERNANCE.md) | Who decides what |
| [Contributing](../CONTRIBUTING.md) | Getting a development instance running |
| [Acceptance test workbook](testing/OpenOKR-UAT.xlsx) | The manual test a person runs through the whole UI, module by module. [How to refresh it](testing/PROMPT-UAT.md) |

## How this stays true

`pnpm check:docs` refuses a link that resolves to nothing, a page nothing leads
to, and an instruction naming a command that does not exist. It also checks
every threshold [the numbers](handbook/numbers.md) quotes against the method
registry, and the [API reference](api/reference.md) against the contract it is
generated from. A page here cannot quietly stop being true.
