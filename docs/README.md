# OpenOKR documentation

Start where you are.

| You are | Start here |
|---|---|
| Putting OpenOKR on a server | [Install on one server](install/compose.md) |
| Putting it on Kubernetes | [Install on Kubernetes](install/kubernetes.md) |
| Using the managed cloud | [Start on the cloud](install/cloud.md) |
| Running an instance somebody installed | [Administrator guide](admin/README.md) |
| Using OpenOKR day to day | The user guide, at P8-T11b |
| Running the OKR practice | The handbook, at P8-T11b |
| Calling the API or writing an agent | The reference, at P8-T11b |
| Building OpenOKR itself | [CONTRIBUTING.md](../CONTRIBUTING.md) and [the plan set](development-plan/) |

## Install

| Page | What it covers |
|---|---|
| [One server with Docker Compose](install/compose.md) | The whole install, from an empty machine to a signed-in owner |
| [Kubernetes with Helm](install/kubernetes.md) | What the chart does, what it deliberately does not, and the secret to back up |
| [The managed cloud](install/cloud.md) | Signing up, and what the vendor operates |
| [The first run](install/first-run.md) | The wizard, the owner account, and the five things to do next |
| [Running with no internet](runbooks/air-gap.md) | What works air-gapped, and how to validate it |

## Administering an instance

| Page | What it covers |
|---|---|
| [Administrator guide](admin/README.md) | What an administrator owns, and where each control lives |
| [People and access](admin/people.md) | Invitations, trusted domains, access levels, suspension |
| [Security](admin/security.md) | Single sign-on, directory sync, the second-factor policy, the audit trail |
| [Settings](admin/settings.md) | Every setting that changes behaviour, and its default |
| [Operations](admin/operations.md) | Health, logs, upgrades, backups, restores, key rotation |

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

## About the project

| Page | What it covers |
|---|---|
| [The method](development-plan/METHOD.md) | The OKR practice canon. Every rule, threshold and gate the product runs |
| [The plan set](development-plan/) | Requirements, architecture, schema, interface, and the task list |
| [Governance](../GOVERNANCE.md) | Who decides what |
| [Contributing](../CONTRIBUTING.md) | Getting a development instance running |

## What is not here yet

The user guide, the OKR handbook, the generated API reference and the importer
runbook arrive at P8-T11b. This page links to them from the moment they exist,
and `pnpm check:docs` fails if it names a page that is missing, so nothing here
can point at a document nobody wrote.
