/**
 * The data-change runner (P2-T12, IMPLEMENTATION-PLAN.md).
 *
 * Schema migrations reshape tables; this reshapes the rows already in them,
 * and the two are never mixed (EXECUTION-GUIDE §9, `migrate.ts`'s own
 * header). A change script is versioned like a migration, but batched and
 * resumable rather than one statement: production data can be too large for
 * a single transaction, and a crash partway through must resume from where
 * it stopped, not from zero and not by re-touching rows it already fixed.
 *
 * **Frozen column expectations.** A script names the columns and types its
 * SQL depends on. The runner checks every one against
 * `information_schema.columns` before the script's first batch, every run
 * — not once at review time. A later migration that renames or retypes a
 * column a script still assumes would otherwise let that script keep
 * running, silently touching rows on a premise that stopped being true.
 * Failing loudly here is what "a later schema change cannot silently alter
 * what an old script does" (the task's own acceptance line) means in code.
 *
 * **Idempotent by ledger, resumable by cursor.** `_data_changes` records one
 * row per script: `cursor` is the script's own bookmark (opaque to this
 * runner) for its next batch, `completed_at` is set once its last batch
 * reports `done`. A completed script is skipped entirely on every later
 * run — same as the acceptance criterion asks for, in the same words: run
 * twice, do nothing the second time, the ledger shows one completion.
 */
import { createHash } from "node:crypto";

/** A dedicated connection, not a pool: batches use transaction control. */
export interface DataChangeClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/** One column a script's SQL depends on existing, with this type. */
export interface ColumnExpectation {
  readonly table: string;
  readonly column: string;
  /** As `information_schema.columns.data_type` reports it, e.g. `"text"`,
   * `"uuid"`, `"jsonb"`, `"timestamp with time zone"`. */
  readonly dataType: string;
}

export interface DataChangeBatchResult {
  /** True once this script has nothing left to touch. */
  readonly done: boolean;
  /** This batch's own bookmark for the next call. Ignored once `done`. */
  readonly cursor?: string;
  /** Rows this batch actually changed, for the ledger and the log — not
   * the same as "rows considered", when some considered rows are skipped. */
  readonly rowsChanged: number;
}

export interface DataChangeScript {
  /** Versioned like a migration: sorted and applied in this order. */
  readonly name: string;
  /** One line: what this backfills and why. Shown in the log and the
   * conventions doc's own worked example is this field, not a comment. */
  readonly summary: string;
  readonly expects: readonly ColumnExpectation[];
  /** Processes one batch starting after `cursor` (null on the first call),
   * inside a transaction the runner opens and commits around this call. */
  runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult>;
}

export class DataChangeError extends Error {
  override readonly name = "DataChangeError";
}

/** Serialises concurrent runners against the same database. Distinct from
 * `migrate.ts`'s own key, so the two runners never contend with each other. */
const DATA_CHANGE_LOCK_KEY = 761_803_3;

const scriptChecksum = (script: DataChangeScript): string =>
  createHash("sha256")
    .update(JSON.stringify({ name: script.name, expects: script.expects }))
    .digest("hex");

async function assertColumnsExist(
  client: DataChangeClient,
  script: DataChangeScript,
): Promise<void> {
  for (const expectation of script.expects) {
    const { rows } = await client.query<{ data_type: string }>(
      `select data_type from information_schema.columns
        where table_name = $1 and column_name = $2`,
      [expectation.table, expectation.column],
    );
    const found = rows[0];
    if (!found) {
      throw new DataChangeError(
        `${script.name} expects ${expectation.table}.${expectation.column} ` +
          `to exist, but it does not. The schema has moved on; update or ` +
          `retire this script rather than let it run against a premise ` +
          `that stopped being true.`,
      );
    }
    if (found.data_type !== expectation.dataType) {
      throw new DataChangeError(
        `${script.name} expects ${expectation.table}.${expectation.column} ` +
          `to be ${expectation.dataType}, but it is ${found.data_type}. ` +
          `Update the script's frozen expectation once you have confirmed ` +
          `its SQL still means what it did when it was written.`,
      );
    }
  }
}

export interface RunDataChangesOptions {
  readonly scripts: readonly DataChangeScript[];
}

export interface DataChangeOutcome {
  readonly name: string;
  readonly batches: number;
  readonly rowsChanged: number;
}

/**
 * Runs every registered script in name order, skipping any already
 * complete. Each batch commits on its own, so a crash between batches loses
 * no progress: the next run resumes from the last committed cursor.
 */
export async function runDataChanges(
  client: DataChangeClient,
  options: RunDataChangesOptions,
): Promise<DataChangeOutcome[]> {
  const names = new Set(options.scripts.map((script) => script.name));
  if (names.size !== options.scripts.length) {
    throw new DataChangeError("Duplicate data-change script name.");
  }

  await client.query(`
    create table if not exists _data_changes (
      name text primary key,
      checksum text not null,
      cursor text,
      batches int not null default 0,
      rows_changed bigint not null default 0,
      started_at timestamptz not null default now(),
      completed_at timestamptz
    )
  `);

  await client.query("select pg_advisory_lock($1)", [DATA_CHANGE_LOCK_KEY]);
  try {
    const outcomes: DataChangeOutcome[] = [];
    for (const script of [...options.scripts].sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const checksum = scriptChecksum(script);
      const { rows } = await client.query<{
        checksum: string;
        cursor: string | null;
        batches: number;
        rows_changed: string;
        completed_at: string | null;
      }>("select * from _data_changes where name = $1", [script.name]);
      const ledger = rows[0];

      if (ledger?.completed_at) {
        continue;
      }

      if (!ledger) {
        await client.query(
          `insert into _data_changes (name, checksum) values ($1, $2)`,
          [script.name, checksum],
        );
      } else if (ledger.checksum !== checksum) {
        throw new DataChangeError(
          `${script.name}'s frozen column expectations changed after it ` +
            `started running. Finish it as written, or start a new script ` +
            `for the new expectations — never edit one mid-run.`,
        );
      }

      await assertColumnsExist(client, script);

      let cursor = ledger?.cursor ?? null;
      let batches = ledger?.batches ?? 0;
      let rowsChanged = ledger ? Number(ledger.rows_changed) : 0;

      for (;;) {
        await client.query("begin");
        let result: DataChangeBatchResult;
        try {
          result = await script.runBatch(client, cursor);
          batches += 1;
          rowsChanged += result.rowsChanged;
          cursor = result.done ? cursor : (result.cursor ?? cursor);
          await client.query(
            `update _data_changes
                set cursor = $2, batches = $3, rows_changed = $4,
                    completed_at = case when $5 then now() else null end
              where name = $1`,
            [script.name, cursor, batches, rowsChanged, result.done],
          );
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw new DataChangeError(
            `${script.name} failed on batch ${batches + 1}. Progress through ` +
              `the previous batch is kept; re-run to resume from there.`,
            { cause: error },
          );
        }
        if (result.done) {
          break;
        }
      }

      outcomes.push({ name: script.name, batches, rowsChanged });
    }
    return outcomes;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [DATA_CHANGE_LOCK_KEY]);
  }
}
