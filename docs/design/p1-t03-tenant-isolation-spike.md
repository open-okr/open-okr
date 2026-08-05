# P1-T03 spike decision: tenant isolation under connection pooling

- **Risk row**: PLAN.md §12 R1, "Tenant isolation discipline under connection pooling".
- **Decision**: **GO.** Row-level security keyed on a transaction-local setting holds under transaction pooling. The R1 fallback (query-layer filter injection) is **not** invoked.
- **Date**: 2026-08-05. **Task**: P1-T03. **Status**: proven by an automated suite that runs on every CI shard, not a one-off experiment.

## What was at risk

Every business table's row-level security policy keys on `current_setting('app.workspace_id')`. A connection pooler in transaction mode hands the same server connection to a different client after every transaction, with no reset in between. If the workspace setting survived the transaction, tenant A's setting would leak into tenant B's queries. That would poison the whole tenant floor.

## The discipline under test

One rule, implemented in `withWorkspace` (`packages/db/src/tenant.ts`), the only supported way to run tenant-scoped SQL:

1. Open a transaction.
2. Apply the workspace with `set_config('app.workspace_id', <uuid>, true)` — the function form of `SET LOCAL`: transaction-local, parameterised, never session-level, never from client input.
3. Run the work inside that transaction.

Policies read the setting with `nullif(current_setting('app.workspace_id', true), '')::uuid`, so an absent setting compares as NULL and matches zero rows: fail closed.

## Test environment

| Piece | Value |
|---|---|
| Postgres | 17 (`postgres:17-alpine`), RLS enabled and **forced** on the probe table |
| Pooler | PgBouncer 1.24 (`edoburu/pgbouncer:v1.24.1-p1`), `pool_mode = transaction`, `default_pool_size = 5` |
| Application role | `openokr_app`: no table ownership, `NOSUPERUSER`, `NOBYPASSRLS` |
| Suite | `packages/db/test/pooling-spike.test.ts`, plus the same assertions over a direct connection in `isolation.test.ts` |

## Results

| # | Scenario | Result |
|---|---|---|
| 1 | 30 concurrent transactions across 3 workspaces, more clients than server slots, transactions held open with `pg_sleep` to force interleaving on shared server connections | Every transaction saw only its own workspace's rows; all 30 writes landed with the right tenant stamp |
| 2 | A pooled connection with no workspace setting, while rows verifiably exist (superuser count is non-zero) | Zero rows |
| 3 | After each `withWorkspace` transaction commits, the next query on the pool inspects `current_setting` | Always empty: `SET LOCAL` died with its transaction |
| 4 | Deliberate wrong discipline: session-level `SET` through a single-server-connection PgBouncer database, then a **different** client queries the setting | The second client **received the first client's value**. The leak is real and reproducible on demand |
| 5 | Same single-server-connection setup, correct discipline (`SET LOCAL` in a transaction) | The second client saw nothing |

Result 4 is the important negative control: the failure mode R1 worries about genuinely exists and our harness can detect it, which is what makes results 1–3 and 5 meaningful rather than vacuous.

## What the decision commits us to

- `withWorkspace` is the only way tenant-scoped SQL runs. Session-level `SET` of `app.workspace_id` is forbidden everywhere, including migrations and seeds.
- Every business table ships `workspace_id`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` and its policy in the same migration file. The migration linter (`pnpm db:lint`) fails the build otherwise; escapes need an explicit `-- openokr:not-tenant-scoped: <reason>` marker.
- The application role never owns tables and never holds `BYPASSRLS`. Migrations run as the separate owner role (`DATABASE_ADMIN_URL`, falling back to `DATABASE_URL` for single-role local setups).
- The spike suite stays in the permanent test set and runs through PgBouncer on every CI shard, so a future regression in the discipline is caught, not re-argued.
- Self-hosters may put PgBouncer in transaction mode in front of Postgres without weakening tenancy. Session-mode poolers are also fine; statement mode remains unsupported because transactions are the unit of tenancy.

## Explicitly out of scope

Object-level authorisation (`can()`, P2-T02) sits above this floor; row-level security is the tenant boundary, not the permission model. The soft-delete scope and forward-only migration runner shipped in the same task but are not part of this decision.
