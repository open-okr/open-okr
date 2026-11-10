# A direct connection beside a transaction pooler

Plan 0.8.0 row H7. A deployment that puts PgBouncer in transaction mode in front
of Postgres, to serve more replicas than the database has connections, breaks
the few things that need one server session for longer than a transaction. This
design gives those things their own connection setting. Read routing to a
replica is a separate, later design.

## 1. What needs a session, and what happens through a transaction pooler

Read from the code, not tried on a pooled deployment. In transaction mode,
PgBouncer hands a server connection to a client for one transaction and takes it
back at commit, so anything that outlives a transaction lands on whichever
server connection comes next.

| User | What it holds | Where | Through a transaction pooler |
|---|---|---|---|
| Realtime | One connection that runs `LISTEN` for every live channel | `apps/web/lib/realtime.ts`, `packages/adapters/src/drivers/realtime/postgres.ts` | **Broken.** The `LISTEN` runs on a server connection that is handed to another client at once, so notifications go nowhere and live screens stop updating |
| pg-boss | Its own pool, and a `LISTEN` for new jobs | `apps/web/lib/scheduler.ts`, `packages/adapters/src/drivers/jobs/pg-boss.ts` | **Slower, not broken.** pg-boss 12 takes its locks with `pg_advisory_xact_lock`, which is transaction-scoped, and falls back to polling when its `LISTEN` does not deliver |
| First workspace on sign-up | A session-level advisory lock on one pooled client, while the check and the creation run on others | `packages/core/src/workspaces/provisioning.ts` | **Broken.** The lock and the unlock can run on different server connections: the lock does not hold, and an unlock can fail or leave a lock behind on a connection somebody else gets |
| Creating another workspace | The same pattern | `packages/core/src/workspaces/create-own.ts` | Broken the same way |
| Finishing setup | The same pattern | `packages/core/src/setup/complete.ts` | Broken the same way |
| The migration runner | A session-level advisory lock | `packages/db/src/migrate.ts` | Not affected: migrations run on `DATABASE_ADMIN_URL`, which must already point at Postgres directly |

What already works through a transaction pooler, and stays as it is:

| Use | Why it works |
|---|---|
| The tenant setting | `SET LOCAL` per transaction. The P1-T03 spike proved it through PgBouncer on the test stack |
| The relay, the lockout counters, the audit chainer, the task reorder, the embedding writes | Each holds a client for one explicit transaction, and the chainer and the reorder take transaction-scoped locks |
| `NOTIFY` | Sent inside the writing transaction and delivered at commit |
| Queries | node-postgres sends unnamed statements unless a name is given, so no prepared statement outlives its transaction |

## 2. The setting

| Variable | Default | Used by |
|---|---|---|
| `DATABASE_DIRECT_URL` | The value of `DATABASE_URL` | Realtime's `LISTEN` connection, pg-boss, and the three session locks |

Environment only, like `DATABASE_URL`, because it is a credential. Declared in
`packages/config/src/env.ts` and in TECHNICAL-PLAN §4.14. With nothing set,
every connection goes where it goes today, so an instance that changes nothing
behaves exactly as before. It is refused at boot when set and not a
`postgres://` or `postgresql://` address.

## 3. The design

| Part | Change |
|---|---|
| A second, small pool | `getDirectPool()` in `apps/web/lib/pool.ts`, at most 4 connections, opened only on first use. When the variable is unset it returns the main pool rather than opening a second one |
| Realtime | Its `LISTEN` client connects to `DATABASE_DIRECT_URL` |
| pg-boss | Constructed with `DATABASE_DIRECT_URL`. Its own pool stays its own size |
| The three session locks | `provisionWorkspaceForUser`, `createOwnWorkspace` and `completeSetup` take a `guardPool` beside the pool they already take, and hold their lock on a client from it. The work they guard keeps using the main pool. Core stays free of environment reads: the web application passes `getDirectPool()` in |
| Commands | `pnpm` commands that provision or finish setup get the same through their own environment. `packages/core/src/bin` reads `DATABASE_DIRECT_URL` where it builds its pools |
| The Helm chart | `database.directUrl`, with `database.existingSecretDirectKey` for an operator's own Secret, as H8 did for the owner role. Unset renders nothing |
| Compose | Nothing: it runs no pooler |
| Docs | `docs/install/kubernetes.md` gains "Behind PgBouncer": transaction mode for `DATABASE_URL`, Postgres directly for `DATABASE_DIRECT_URL` and `DATABASE_ADMIN_URL`, and what breaks without it |

**Why not move the locks inside one transaction.** The check reads the person's
memberships across workspaces, and a transaction scoped to one workspace cannot
see the others under row-level security. That is why these three took a
session lock in the first place, and a separate connection keeps that design
whole.

## 4. Acceptance criteria

```
Given DATABASE_URL points at PgBouncer in transaction mode
And DATABASE_DIRECT_URL points at Postgres
When a goal changes in one browser
Then the live board in another browser updates

Given the same deployment
When two tabs finish sign-up for one person at the same moment
Then exactly one workspace is created, and no advisory lock is left held

Given DATABASE_DIRECT_URL is unset
Then the instance opens no second pool, and every test passes as before

Given DATABASE_DIRECT_URL is set to something that is not a Postgres address
Then the server refuses to start and names the variable
```

## 5. Tests

| Test | Kind |
|---|---|
| Realtime delivers through the pooler when given the direct address, and does not when given the pooled one | Adapters, against the test stack, which already runs PgBouncer in transaction mode on its second port |
| Two concurrent provisions through the pooler with a direct guard make one workspace; `pg_locks` holds nothing afterwards | Core, the same stack |
| The schema: unset, a valid address, a refused value | `packages/config` unit |
| The chart renders the variable from a value or an existing Secret's key, and nothing when unset | `deploy/helm/check.sh` |

## 6. What it does not do

- No read-replica routing. A separate design, when a deployment needs it.
- It does not put PgBouncer in Compose or in the chart. The operator runs it.
- It does not change pg-boss's pool size or polling interval.

## 7. Open questions

| # | Question | Options | Recommended |
|---|---|---|---|
| H7-Q1 | Is this worth building in 0.8.0? OKRGoal does not run PgBouncer today, and the plan says it is not needed until a deployment outgrows one database's connections | Build now; record the design and build when a deployment needs it | **Build when needed**, unless OKRGoal plans a pooler. The design is ready, and §1's table goes into `docs/install/kubernetes.md` now, so nobody puts a pooler in front without knowing what breaks |
| H7-Q2 | The variable's name | `DATABASE_DIRECT_URL`; `DATABASE_SESSION_URL`; `DATABASE_LISTEN_URL` | **`DATABASE_DIRECT_URL`**, the name Prisma and others use for the same idea, so an operator recognises it |
