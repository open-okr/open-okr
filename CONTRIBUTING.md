# Contributing to OpenOKR

Thank you for considering a contribution. This page explains how to set up the project, how work is organised, and what we need from you legally before a change can merge.

## Project state

OpenOKR is being built plan-first. The complete plan lives in `docs/development-plan/`, and work proceeds one task at a time from `IMPLEMENTATION-PLAN.md` with progress tracked in `STATUS.md`. Read `README.md` for what the product is.

While the plan is being executed, large unsolicited pull requests are hard to land. Open an issue first and we will find a task-shaped piece of work together.

## Setup

You need Node.js 22 or newer. The repository pins its package manager (pnpm) through Corepack, which ships with Node.

```sh
corepack enable   # once per machine; makes the pinned pnpm available
pnpm install
```

## Running it locally

Postgres is the only service you need. `pnpm db:up` starts one in Docker on
port 55432, chosen so a Postgres already installed on this machine is never
touched. It ships no application database, so create one once:

```sh
pnpm db:up
docker exec openokr-test-postgres-1 psql -U postgres -c "CREATE DATABASE openokr;"
```

The settings live in `apps/web/.env`, not the repository root. Nothing here
loads a dotenv file: Next.js reads `apps/web/.env` by itself, and a file at the
root is silently ignored.

```sh
cp .env.example apps/web/.env
```

The command line tools read the process environment rather than that file, so
migrations take the connection string inline:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:55432/openokr pnpm db:migrate
pnpm dev
```

Open http://localhost:3000. A database with no account in it redirects to
`/setup`, the first-run wizard. The account you create there claims the
instance, becomes its admin, and gets a workspace provisioned automatically.

Everything else has a working default, so nothing above needs editing to boot.
Mail is written to the log rather than sent, the session secret falls back to a
development placeholder that production refuses to start with, and the
encryption key is regenerated per process. That last one means anything sealed
locally, such as a stored provider key, stops opening after a restart. Set
`OPENOKR_ENCRYPTION_KEY` if you need it to survive one.

The database keeps its data in memory, so `pnpm db:down` discards it. Starting
again means repeating the `CREATE DATABASE` and `pnpm db:migrate` above.
`pnpm dev` on its own leaves it alone.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the application locally |
| `pnpm test` | Run unit and integration tests |
| `pnpm typecheck` | Strict TypeScript checking across all packages |
| `pnpm lint` | Biome lint and format check (`pnpm lint:fix` writes the fixes) |
| `pnpm dead-code` | Fail on unused files, exports and dependencies |
| `pnpm build` | Production build |

All of these must pass before a change is reviewed.

Some need a database. `pnpm db:up` starts Postgres and PgBouncer in Docker,
and `pnpm db:down` stops them.

| Command | What it does |
|---|---|
| `pnpm db:up` / `pnpm db:down` | Start and stop the test database stack |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:lint` | The tenant floor and soft-delete checks on migrations |
| `pnpm test:e2e` | Playwright, against a built standalone server |
| `pnpm test:ci` | The whole repository as one suite, with the flakiness report |

And the gates continuous integration runs, all of which you can run yourself:

| Command | What it checks |
|---|---|
| `pnpm check:boundaries` | Vendor SDKs stay in `packages/adapters`, application code consumes ports, write paths cause side effects only through the outbox, and domain writes go through the Operation pipeline |
| `pnpm check:licences` | Every dependency licence is on the allow list |
| `pnpm check:signoff` | Commits carry a sign-off |
| `pnpm audit:verify` | The append-only audit hash chain is intact |
| `sh deploy/docker/smoke-test.sh` | The compose target boots from nothing and reaches a secured instance |
| `sh deploy/helm/check.sh` | What the chart refuses, and that no credential lands in a pod spec |

Continuous integration also runs dependency review and code scanning, which
need GitHub and have no local equivalent.

## Environment

Copy `.env.example` to `.env`. Only `DATABASE_URL` has to be set; everything else
has a working default. The application validates its environment at boot and
exits naming any variable that is wrong.

## Flaky tests

Tests retry twice in CI. A test that only passes on a retry is recorded in the
flakiness report on the run summary rather than passing silently, and can be
moved into `test-quarantine.json` with `pnpm flaky quarantine`. A quarantined
test no longer fails the build, which makes it a debt to pay, not a fix. Fix or
delete it.

## Code rules

- TypeScript strict mode everywhere. No loose types without a comment justifying them.
- Formatting and linting are Biome's job. Run `pnpm exec biome check --write .` before committing.
- Tests come with the change, not after it.
- Plain English in documentation and messages. Short sentences.

## Sign-off on every commit

Every commit must carry a `Signed-off-by` line with your real name and email:

```sh
git commit -s
```

This is the Developer Certificate of Origin (DCO), a short statement that you have the right to contribute the code you are committing. Continuous integration rejects unsigned commits.

## Contributor licence agreement

Before your first pull request merges, you sign the contributor licence agreement (CLA). Signing is one click through a bot on the pull request. The agreement lets the project relicense contributions later, which keeps two doors open: offering the code under a more permissive licence one day, and running a managed cloud. You keep the copyright to your work.

## Licence

OpenOKR is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See `LICENSE`. By contributing, you agree your contributions are licensed under it too, subject to the CLA above.

## Governance

Decision-making is described in `GOVERNANCE.md`.
