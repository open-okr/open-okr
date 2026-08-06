# Phase 1 exit checklist

Run at P1-T10, 2026-08-06. The criteria are IMPLEMENTATION-PLAN.md's Phase 1
exit line, one row each, with the evidence rather than an assertion.

Where a criterion is met with a caveat, the caveat is written down. A checklist
that only ever produces ticks is the same fail-open shape this phase met four
times in its gates.

## The criteria

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | The skeleton runs on Compose | **Met** | `deploy/docker/smoke-test.sh`: 11 checks, from nothing to a signed-in admin in 17s against a 30-minute budget. Runs in CI as the "Compose target" job on every pull request |
| 2 | The skeleton runs on Helm | **Met** | `deploy/helm/cluster-test.sh`: 12 checks against a real kind cluster. Installs, both replicas ready, registers a user, upgrades without rotating the encryption key. Runs in CI as the "Helm chart" job |
| 3 | CI is green with the P1-T02 machinery | **Met** | Ten jobs on every pull request: scope detection, quality, two test shards, end to end, Compose target, Helm chart, flakiness, build, compliance. Turbo `--affected`, shard matrix, flakiness merge and quarantine all in use |
| 4 | Tenant isolation is proven, including the pooling decision | **Met** | `docs/design/p1-t03-tenant-isolation-spike.md` records the GO against PLAN §12 R1. `packages/db/test/isolation.test.ts` and `pooling-spike.test.ts` run against Postgres behind PgBouncer in transaction mode on every shard. The R1 fallback was not needed |
| 5 | Outbox semantics are proven | **Met** | `packages/db/test/outbox.test.ts` and `packages/adapters/test/relay.test.ts`: leased at-least-once delivery, visibility timeout, retry and the boundary gate that fails a direct driver call on a write path |
| 6 | The Operation pipeline and hash-chained audit are live | **Met** | `packages/core/test/operation-pipeline.test.ts` and `audit-chain.test.ts`. Every write commits its change, activity and audit row in one transaction; the chain is verified by `pnpm audit:verify`, which refuses to report on workspaces it cannot see |
| 7 | The action registry drives the internal API | **Met, and narrow** | `workspace.overview` and `workspace.rename` are declared in the registry and the dashboard reads through it. Two actions is a working registry, not a populated one: the projections to REST, OpenAPI, the CLI and the agent catalogue are P2-T09, and `pnpm gen:contract` does not exist yet |
| 8 | Passkeys and one-time passwords work | **Met** | `packages/core/test/auth.test.ts`, `session-hashing.test.ts`, and the S-35 screens. Better Auth with the passkey plugin, session tokens hashed at rest, lockout with backoff. Exercised in a browser by the end-to-end suite |
| 9 | The wizard provisions an instance inside budget | **Met** | 17 seconds measured, against 30 minutes. Asserted in CI, not just observed once |
| 10 | No vendor SDK sits outside the adapters package | **Met** | `pnpm check:boundaries`, 127 files, green on every pull request. Four rules: vendor SDKs, driver imports, write-path side effects, and mutations outside the Operation pipeline |

## Caveats worth carrying into Phase 2

**The registry is real but nearly empty.** Criterion 7 is met in the sense the
plan means — reads and writes are declared once and the interface is a
projection — but with two actions. The drift check that compares generated
artefacts against committed ones cannot exist until there are artefacts.
P2-T09 is where this becomes load-bearing.

**Authorisation is a seam, not a model.** The pipeline resolves the acting
member and compares the action's declared access level, but every active
member resolves to full, because bindings arrive at P2-T01. This is recorded
on the P2-T02 row and is the single largest piece of Phase 1 that is shaped
rather than finished.

**Mail is configurable but untested against a real server.** The SMTP driver,
its live connection test and the settings resolution all work, and the wizard
reports a refused connection honestly. Nothing has yet sent an email to a real
mailbox, because nothing sends email until invitations at P2-T04.

**One deliberate exception to a hard rule.** Instance settings writes sit
outside the Operation pipeline behind a stated `openokr:allow-mutation`
marker: `audit_events.workspace_id` is not null, so an instance write has no
chain to join. Recorded on P8-T03.

## What Phase 1 learned about its own gates

Four gates passed while checking nothing, and each was found by running the
software rather than by reading it:

| Gate | Reported | Actually |
|---|---|---|
| Soft-delete lint (P1-T06) | "passed" | Had never seen a schema file; the table registry was empty |
| Audit verifier (P1-T07) | "0 chains intact" | The tenant floor hid every workspace from it |
| Migration lint (P1-T09) | "passed" | Never said what it read |
| `./openokr up` (P1-T09) | "ready" | The proxy was crash-looping behind a healthy application |

And one inverse case, found in the P1-T09 review: the mail driver, its
settings and its documentation all existed, and nothing could reach any of it.

**Two rules carried forward.** A gate that cannot find its input must fail,
not pass — ask what it prints when it checks nothing. And a capability is not
shipped until something can reach it.

## What the post-exit review found

This checklist was written before a full review of Phase 1. That review, in
`chore/p1-hardening`, found eleven more things and both rules held again.

Two more gates that passed while checking nothing: the migration linter
accepted a policy on `invitations` as a policy on a table called `invitation`
and read a sentence about a marker as the marker itself, and the boundary gate
did not cover `apps` at all while a direct mail send was already sitting there.

One more capability nothing could reach: `./openokr rotate-key` had never run.
It pointed at a file the image did not contain. The documentation, the helper
and the rotation code were all correct and none of them had ever met.

And a third rule worth adding, from the widest of the findings: **a test that
asserts the current behaviour is not the same as a test that asserts the
intended one.** Every read inside every operation was returning rows from
other workspaces, and the reason it survived review is that a test named the
union, described it in a comment, and passed. The tenant floor's proof said
what the code did rather than what the rule required.

## Verdict

Phase 1 exits. The skeleton runs on both targets, the tenant floor and the
audit chain are load-bearing, and no vendor SDK has escaped the adapters
package. The gaps above are all scheduled, and none of them blocks Phase 2's
first task.
