# P1-T09: the Compose target and the first-run wizard

What was built, what was decided, and what was deliberately left out.

Authority: PLAN.md §120 (deployment tiers), TECHNICAL-PLAN.md §4.2 (settings
scopes), §4.14 (the settings map), §8.2 (secrets and security controls).

## The shape

| Piece | Where | Why there |
|---|---|---|
| Key ring, envelope encryption | `packages/core/src/secrets/key-ring.ts` | Pure functions, no I/O, so rotation is testable without a database |
| Instance settings store | `packages/core/src/secrets/instance-settings.ts` | The one place a `system_settings` row becomes a value |
| The settings map | `packages/core/src/secrets/instance-registry.ts` | Every instance setting with a working default |
| Setup state | `packages/core/src/setup/state.ts` | One definition of "configured", read by every guard |
| Connection tests | `packages/core/src/setup/{connection-tests,probes}.ts` | Framework apart from probes, so Phase 5 and 6 add one file each |
| The wizard | `apps/web/app/setup/` | A web wizard has to be served by the application |
| Image, compose, proxy, helper | `deploy/docker/` | Deployment, not application |

## Decisions, and what they cost

### Caddy for the reverse proxy

Automatic certificates are built in rather than a second process with its own
renewal timer. nginx would need certbot as a fourth moving part, which is the
file-editing the 30-minute budget exists to avoid. Traefik is stronger at
dynamic service discovery, which a fixed three-service compose does not need.

**Cost:** an operator who already knows nginx has one more thing to learn.

### Local disk only, no object storage service

The local-disk driver covers a single server. S3-compatible storage is reachable
by environment variable without running anything. A default install is three
containers and Postgres remains the only required service.

### Envelope encryption now, not later

The wizard stores SMTP credentials. There is no acceptable interim where those
sit in plaintext, so the key ring could not wait for a later task.

A per-secret data key seals the secret; a root key from the environment wraps
the data key. Rotation re-wraps data keys only.

| Property | Consequence |
|---|---|
| Rotation never decrypts | No plaintext credential is ever held in memory during rotation |
| Ciphertext is copied untouched | A half-finished rotation leaves every secret readable |
| Retired keys stay on the ring | Installing a new key does not make stored secrets unreadable |
| The root key never reaches the database | A database backup alone discloses nothing |

### `system_settings` is instance scope, not infrastructure

It sits above every workspace, so it carries no `workspace_id`. The migration
linter gained an `instance-scope` marker rather than letting the table use
`not-tenant-scoped`, which would have waived its policy and soft-delete checks
too. This is the table holding the instance's credentials; it keeps every check
except the column it cannot have.

Writes need a transaction-local opt-in, `app.instance_admin`, the same shape as
the tenant floor. An ordinary request path never sets it, so a stray write is
refused by Postgres rather than caught in review. The end-to-end preparation
script had to set it explicitly, which is the policy proving itself.

### Instance settings writes are outside the Operation pipeline

Marked with `openokr:allow-mutation` and a stated reason. The pipeline needs a
workspace and an acting member to write its activity and audit rows, and
`audit_events.workspace_id` is not null, so there is no chain for an instance
write to join. The wizard has neither when it stores secrets, because it runs
before any workspace exists.

**Follow-up:** instance-level audit, recorded on P8-T03.

### Completion is recorded last

The wizard writes settings, then records completion. Interrupted between the
two, an instance reopens the wizard and finishes the job. The reverse order
would leave a closed wizard on an instance that was never configured, with no
way back in.

The account step handles the same case: if an account exists but completion was
never recorded, it offers to finish rather than a form that can only fail on a
duplicate address.

### Three guards on the wizard, not one

| Guard | Stops |
|---|---|
| `app/setup/layout.tsx` | Seeing any setup route on a configured instance |
| `finishSetup` server action | Calling it directly, which a server action allows |
| `completeSetup` advisory lock | Two callers claiming the same instance at once |

## What was left out, and why

**Demo data.** The deliverable asks the wizard to offer it. Demo data means
objectives, key results and a cycle, and those arrive in Phase 3. A checkbox
that seeded nothing would be worse than its absence. Recorded on P3-T01.

**Channel and AI connection tests.** Both report "not in this build" rather
than a tick. The framework is complete; the probes arrive with the drivers in
Phase 5 and Phase 6.

## Measured

On a developer machine, against the shipped image:

| Measure | Result | Budget |
|---|---|---|
| Nothing to a healthy instance | 17s | 30 minutes |
| Image size | 204MB | none stated |
| Migrations applied on boot | 7 | all |

The image was 726MB before the migration runner stopped shipping the build's
`node_modules` to run a few hundred lines of SQL. Next already traces `pg` into
the standalone output, so the runner needs no dependency install of its own.

## Gates that failed open, again

Two more, found by running the software rather than testing it. This is the
third and fourth instance of the same pattern, after the P1-T06 soft-delete lint
and the P1-T07 audit verifier.

| Gate | Reported | Actually |
|---|---|---|
| Migration lint | "passed" | Never said what it read. A renamed directory would have made it a permanent pass |
| `./openokr up` | "ready" | Waited on the application only, while the proxy crash-looped behind it |

Both now state their coverage and fail when they cannot do their job. The
container's database check gained a third exit code for the same reason: a
check that cannot load its own driver looked exactly like a database that was
down, which would have sent an operator to Postgres for the afternoon.

**The rule this keeps proving:** a gate that cannot find its input must fail,
not pass. Ask of every gate, "what does it print when it checks nothing?"

## Seams for later tasks

| Task | What changes here |
|---|---|
| P1-T10 | Helm reuses the image and the migration runner; migrations move to a hook, and the advisory lock already makes both correct |
| P2-T04 | Invitations need mail; the SMTP driver and its live test are ready |
| P3-T01 | Demo data, and the wizard's offer of it |
| P8-T03 | Instance-level audit for settings writes |
| Phase 5 / 6 | Channel and AI probes replace `notInThisBuild` |
