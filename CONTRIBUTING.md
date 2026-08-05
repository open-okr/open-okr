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

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the application locally |
| `pnpm test` | Run unit and integration tests |
| `pnpm typecheck` | Strict TypeScript checking across all packages |
| `pnpm lint` | Biome lint and format check (`pnpm lint:fix` writes the fixes) |
| `pnpm dead-code` | Fail on unused files, exports and dependencies |
| `pnpm build` | Production build |

All of these must pass before a change is reviewed. Continuous integration runs
them again, plus a dependency licence gate, a commit sign-off gate, dependency
review and code scanning.

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
