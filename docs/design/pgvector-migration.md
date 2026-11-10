# Migrating with pgvector installed

**Approved by Akmal on 11 November 2026** ("design approved"), with every open question answered as recommended.

Plan 0.8.0 row H5. With the pgvector extension available, migrations stop at
`0031_embeddings.sql` and the instance cannot be installed or upgraded. Fixing it
means changing a migration that has shipped, which CLAUDE.md puts with the
human, so this design needs Akmal's answer to H5-Q1 and "design approved"
before any code.

## 1. What is true today

| Fact | Where |
|---|---|
| 0031 creates the extension when it can, catching the error when it cannot | `packages/db/migrations/0031_embeddings.sql`, the first `do` block |
| With the extension present it turns `embeddings.embedding` into `vector`, with no dimensions, and builds an HNSW index on it | The second `do` block |
| pgvector refuses an HNSW or IVFFlat index on a column with no dimensions ("column does not have dimensions"). Before 0.5.0 it has no HNSW at all. **So the second block has never succeeded anywhere** | pgvector |
| Each migration runs in its own transaction, so a failure rolls 0031 back entirely and the ledger never records it | `packages/db/src/migrate.ts`, `runMigrations` |
| The runner records a checksum per applied migration and refuses an upgrade when an applied file changed: "was edited after it ran". Only the line-ending variants of the same SQL are accepted (`legacyChecksums`) | `packages/db/src/migrate.ts` |
| `db:lint` refuses any edit to a migration the newest release tag holds | `packages/db/src/shipped-migrations.ts` |
| The test stack and the Compose target use `postgres:17-alpine`, which has no pgvector, so CI only ever takes the first branch | `packages/test-support/docker/compose.yaml`, `deploy/docker/compose.yaml` |
| Managed Postgres offers pgvector by default (RDS, Cloud SQL, Azure), so a fresh install there fails at 0031. OKRGoal runs with the extension removed, and search uses the full-text fallback | Plan section 3.2 |

Two faults sit next to it, found while reading the retrieval code:

| Fault | Where | Effect |
|---|---|---|
| `hasPgvector()` asks whether the extension exists, not whether the column is a vector | `packages/core/src/embeddings/service.ts` | An instance that applied 0031 without pgvector and adds the extension later gets `text <=> vector` errors instead of the fallback |
| The vector query does not filter by `dimensions` | Same file, `#vectorRetrieve` | After the embedding model changes, rows of two sizes meet in one comparison and pgvector raises "different vector dimensions" |

## 2. The options for 0031

Every instance that recorded 0031 took the branch without pgvector. Every
instance with pgvector failed at it and recorded nothing. So the second block
can change without changing what any recorded instance has, provided the
runner is told the old checksum is still that same migration.

| Option | What it does | For an instance that applied 0031 | For an instance with pgvector |
|---|---|---|---|
| **A. Rewrite the pgvector branch, and sanction its old checksum** | The second block only changes the column type and builds no index. `migrate.ts` gains a named list of sanctioned rewrites, holding this one file and its old checksum with the reason, accepted exactly as a line-ending variant is. The shipped-migration gate reads the same list | Upgrades as before: the recorded checksum is accepted | Installs and upgrades |
| B. Leave 0031 and document | Operators keep the extension out of the database until after 0031, as OKRGoal does | Unchanged | A fresh install on managed Postgres fails until somebody reads the note |
| C. Rewrite without sanctioning | | **Every** such instance refuses its next upgrade with "was edited after it ran", which is the failure of 7 October 2026 again | Works |

## 3. The design (option A)

### 3.1 0031

```sql
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'alter table embeddings alter column embedding type vector using embedding::vector';
  end if;
end
$$;
```

The index statement goes, with a comment saying why: an index needs a fixed
size, the size belongs to the embedding model, and the model is chosen after
migrations run.

### 3.2 The runner's sanctioned rewrites

```ts
/**
 * Shipped migrations whose SQL changed on purpose, with the checksum every
 * instance that ran them recorded. A rewrite belongs here only when no
 * instance can have run the part that changed.
 */
const SANCTIONED_REWRITES: Record<string, readonly string[]> = {
  // H5: the pgvector branch never succeeded anywhere (docs/design/pgvector-migration.md).
  "0031_embeddings.sql": ["<the shipped checksum>"],
};
```

The runner accepts a recorded checksum found there, as it accepts a line-ending
variant, and heals the ledger row to the new checksum. `db:lint`'s shipped gate
accepts the same file only when the shipped copy's checksum is in the list, so
any other edit to 0031 is still refused.

### 3.3 No vector index, for now

Retrieval is filtered to one workspace first, and an exact search over that
workspace's chunks is correct. Whether it is fast enough is not known: global
search goes through the same service (`packages/core/src/search/service.ts`)
and carries §13.1's 300 ms budget for suggestions, and no stack has ever run the
vector path to measure it. So before H5 is called done, the pgvector leg runs
`pnpm db:seed:large --scale 0.1` and `pnpm perf:budgets` once, and the result is
written here. Over budget means H5-Q3's second option.

### 3.4 The two neighbouring faults

| Fix | Rule |
|---|---|
| `hasPgvector()` | True only when the extension exists **and** `embeddings.embedding` is of type `vector` (`format_type` from `pg_attribute`). Otherwise the full-text path, as today without the extension |
| The vector query | `and dimensions = <the query vector's length>`, so rows from another model are left out rather than raising. The worker re-embeds a chunk only when its content changes (`content_hash`), so after a model change the old chunks stay at the old size until edited; this leaves them out instead of raising |

### 3.5 An instance that adds pgvector later

A new migration converts the column when the extension exists at the time it
runs and the column is still text, and does nothing otherwise. An operator who
adds the extension after that runs the same statement by hand, written in
`docs/runbooks/upgrade.md`. Until either happens, retrieval keeps the
full-text path, because of §3.4 (H5-Q2).

### 3.6 A CI leg with pgvector

One job in `.github/workflows/ci.yml` runs the migrations and the embedding tests
on `pgvector/pgvector:pg17`, so the branch the product ships for managed
Postgres is the branch a test takes. The default stack stays `postgres:17-alpine`,
because the product must be whole without the extension.

## 4. Acceptance criteria

```
Given a fresh database with pgvector available
When pnpm db:migrate runs
Then every migration applies, and embeddings.embedding is of type vector

Given an instance that recorded 0031 from the shipped file, without pgvector
When it upgrades to 0.8.0
Then the runner accepts the recorded checksum, heals the ledger row, and applies
the rest

Given any other edit to 0031
When db:lint runs, or the runner meets an instance that recorded 0031
Then it is refused as today

Given an instance whose column is text and whose database gains the extension
When a member asks the copilot
Then retrieval uses the full-text path and raises nothing

Given chunks embedded by two models of different sizes
When a member asks the copilot
Then only chunks of the query's size are compared, and nothing raises
```

## 5. Tests

| Test | Kind |
|---|---|
| The sanctioned checksum is accepted and healed; any other change to an applied file is refused | `packages/db/test`, the runner's existing suite |
| The shipped gate accepts the sanctioned rewrite only | `packages/db/test`, the shipped-migration suite |
| A fresh migrate with pgvector, and retrieval by vector | The new CI leg, `pgvector/pgvector:pg17` |
| `hasPgvector()` with the extension and a text column; mixed dimensions | Core, against the default stack (no pgvector needed for the first; the second runs in the new leg) |
| An upgrade from 0.7.0 over the shipped 0031 | The nightly upgrade rehearsal, `.github/workflows/upgrade.yml`, unchanged |

## 6. What it does not do

- No approximate-nearest-neighbour index (H5-Q3).
- It does not create the extension anywhere it is not already creatable.
- It does not re-embed anything. Re-embedding every chunk after a model change is a separate item; until then those chunks are left out of the vector search and still found by the full-text half.

## 7. Open questions

| # | Question | Options | Recommended |
|---|---|---|---|
| H5-Q1 | May 0031 change? | A, B or C in §2 | **A.** It is the only option that fixes a fresh install on managed Postgres without breaking an instance that already upgraded, and the sanction is one named file with its reason |
| H5-Q2 | Convert the column for an instance that adds pgvector later? | A new migration plus a runbook step; the runbook step only; nothing | **A new migration plus the runbook step.** The migration covers the common case, the step covers adding it later, and §3.4 keeps both safe meanwhile |
| H5-Q3 | Build an approximate index now? | None, unless the measurement in §3.3 is over budget; partial HNSW indexes on `embedding::vector(n)` for the configured model's size, built by an operator command | **None unless the measurement says otherwise.** An index needs the model's size, which migrations cannot know, and an exact search is correct |
