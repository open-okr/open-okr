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
the spec drives. Five are not, and the prefix on those is an older label rather
than a screen id:

| File | Prefix reads as | Actually covers |
|---|---|---|
| `s12-blocker-board.spec.ts` | S-12, review and learn | The open-blocker board (METHOD.md §7.3) |
| `s26-session-entry.spec.ts` | S-26, initiatives | Reaching a session in two clicks (screens S-22 to S-25) |
| `s37-api-tokens.spec.ts` | S-37, the AI console | `/account/api-tokens` and the REST surface |
| `s38-device-login.spec.ts` | S-38, agent detail | The device login flow |
| `s41-mcp-transport.spec.ts` | S-41, which does not exist | The agent endpoint over its real transport |

**They are not renamed on purpose.** Design documents such as
`docs/design/api-contract.md` and `docs/design/agent-surface.md` cite these
paths, and each spec's own doc comment says what it covers, so the file itself
is never ambiguous.

**A new spec takes the screen number it drives**, or no prefix at all when it
drives something with no screen.

## Coverage

`apps/web/test/reachability.test.ts` asserts every route is findable in the
interface, and `apps/web/test/route-coverage.test.ts` asserts every route is
opened by a spec here or names the reason it is not.

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
