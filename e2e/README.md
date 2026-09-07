# The end-to-end suite

Playwright specs driving the standalone server the Docker image runs, not the
development server. `pnpm test:e2e` after a `pnpm build`, and `pnpm
test:e2e:install` once for Chromium.

**Docker is not required.** `TEST_DB_PORT` points the harness at a Postgres you
already run, the same override the unit suites take:

```
TEST_DB_PORT=5432 pnpm build && TEST_DB_PORT=5432 pnpm test:e2e
```

Every run builds two databases: one instance already set up, for the dashboard
specs, and one that never has been, for the wizard specs.

## What a filename's prefix means

Most specs are named `sNN-<subject>` where `NN` is the UIUX-PLAN.md §6 screen
the spec drives. Five are not, and the prefix on those is the number the
task-era label carried rather than a screen id:

| File | Prefix reads as | Actually covers |
|---|---|---|
| `s12-blocker-board.spec.ts` | S-12, review and learn | The open-blocker board (P4-T15b-b, METHOD.md §7.3) |
| `s26-session-entry.spec.ts` | S-26, initiatives | Reaching a session in two clicks (P5-T01c, screens S-22 to S-25) |
| `s37-api-tokens.spec.ts` | S-37, the AI console | `/account/api-tokens` and the REST surface (P5-T07a) |
| `s38-device-login.spec.ts` | S-38, agent detail | The device login flow (P5-T07c) |
| `s41-mcp-transport.spec.ts` | S-41, which does not exist | The agent endpoint over its real transport (P5-T09b) |

**They are not renamed on purpose.** Six documents cite these paths, including
`docs/design/p5-t07-api-design.md`, `docs/design/p5-t00-agent-surface-design.md`
and STATUS.md rows that are the audit trail for work already reviewed. A rename
would make a historical record point at a file that does not exist, which is a
worse defect than a prefix that needs this table. Each spec's own doc comment
names its task and its plan section, so the file itself has never been
ambiguous.

**A new spec takes the screen number it drives**, or no prefix at all when it
drives something with no screen. The gap audit of 7 September 2026 raised the
drift; this is the answer to it.

## Coverage

`apps/web/test/reachability.test.ts` asserts every route is findable in the
interface. It does not assert every route has a spec here, and sixteen do not:
that is P6-G29, and `docs/development-plan/GAP-AUDIT.md` G-10 lists them.

## Failure artefacts are worth reading

`test-results/<name>/error-context.md` carries an accessibility snapshot of the
page at the moment it failed. That is how a "missing button" once turned out to
be an error boundary hiding a server crash.

## Two known intermittents

`s36-channels` (quiet hours, `toHaveValue`) and `sessions` (the last stage, a
four-second click timeout) each fail at roughly one run in four. `goTo` in
`instance-account.ts` retries navigation three times and waits for the load
state between attempts, which is what makes the rest survive the App Router
settling a freshly loaded page with a navigation of its own. Do not "fix" that
by skipping a `goto` when the page is already at that address: five specs
reload a page that way to prove a secret is not shown twice.
