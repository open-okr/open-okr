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
  /**
   * Rows this batch looked at and deliberately left, for a script whose
   * skips an operator should hear about (0033 is the first). Reported for
   * this run only and not kept in the ledger, like the session's own count
   * of rows changed.
   */
  readonly rowsSkipped?: number;
}

export interface DataChangeScript {
  /** Versioned like a migration: sorted and applied in this order. */
  readonly name: string;
  /** One line: what this backfills and why. Shown in the log and the
   * conventions doc's own worked example is this field, not a comment. */
  readonly summary: string;
  readonly expects: readonly ColumnExpectation[];
  /**
   * The migration file that drops what this script reads, once a guard in
   * that migration has proved nothing was left for it to do
   * (docs/design/guided-inputs.md §4.7, change 13).
   *
   * With its columns gone and that migration recorded as applied, the
   * script is complete with nothing changed, rather than refused: a fresh
   * instance never ran it, and refusing would stop every script after it.
   * Not part of the checksum, so naming it does not stop a script that
   * started under an earlier release from resuming.
   */
  readonly retiredBy?: string;
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
export const DATA_CHANGE_LOCK_KEY = 761_803_3;

const scriptChecksum = (script: DataChangeScript): string =>
  createHash("sha256")
    .update(JSON.stringify({ name: script.name, expects: script.expects }))
    .digest("hex");

/** Whether any column the script expects is gone from the schema. */
async function anyColumnMissing(
  client: DataChangeClient,
  script: DataChangeScript,
): Promise<boolean> {
  for (const expectation of script.expects) {
    const { rows } = await client.query(
      `select 1 from information_schema.columns
        where table_name = $1 and column_name = $2`,
      [expectation.table, expectation.column],
    );
    if (rows.length === 0) {
      return true;
    }
  }
  return false;
}

/** Whether the migration runner has recorded this file as applied. */
async function migrationApplied(
  client: DataChangeClient,
  file: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `select 1 where to_regclass('_migrations') is not null`,
  );
  if (rows.length === 0) {
    return false;
  }
  const applied = await client.query(
    "select 1 from _migrations where name = $1",
    [file],
  );
  return applied.rows.length > 0;
}

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

export interface RunDataChangesWithinOptions extends RunDataChangesOptions {
  /** Seconds after which the run stops, between two batches. */
  readonly maxSeconds: number;
}

/** What a run inside a budget did. */
export interface DataChangeRun {
  /** False when another run held the lock, so this one ran nothing. */
  readonly ran: boolean;
  /** True when the budget ended the run with a script not yet complete. */
  readonly stopped: boolean;
  readonly outcomes: DataChangeOutcome[];
}

/** How a run takes the lock, and whether it stops on a clock. */
interface RunControl {
  readonly lock: "wait" | "try";
  readonly budgetMs?: number;
}

export interface DataChangeOutcome {
  readonly name: string;
  readonly batches: number;
  readonly rowsChanged: number;
  /** Present only when a batch reported skipping something. */
  readonly rowsSkipped?: number;
}

/**
 * Runs every registered script in name order, skipping any already
 * complete. Each batch commits on its own, so a crash between batches loses
 * no progress: the next run resumes from the last committed cursor.
 *
 * Waits for another run to finish first, if one holds the lock.
 */
export async function runDataChanges(
  client: DataChangeClient,
  options: RunDataChangesOptions,
): Promise<DataChangeOutcome[]> {
  const run = await runUnder(client, options.scripts, { lock: "wait" });
  return run.outcomes;
}

/**
 * The same run, inside a time budget (plan 0.8.0 H10c,
 * docs/design/worker-deployment.md D18), for the Helm chart's hook.
 *
 * **It stops between batches, never inside one.** After each batch commits it
 * looks at the clock, and once `maxSeconds` have passed it stops there: the
 * script keeps its cursor, a script not yet started stays not yet run, and
 * the next run resumes. Helm's own timeout would instead cut the batch in
 * flight and fail the release.
 *
 * **Another run going means nothing to do here.** The lock is tried, not
 * waited for: whoever holds it is already finishing what is pending, and a
 * hook that waited would spend its budget doing nothing.
 */
export async function runDataChangesWithin(
  client: DataChangeClient,
  options: RunDataChangesWithinOptions,
): Promise<DataChangeRun> {
  return runUnder(client, options.scripts, {
    lock: "try",
    budgetMs: options.maxSeconds * 1000,
  });
}

async function runUnder(
  client: DataChangeClient,
  scripts: readonly DataChangeScript[],
  control: RunControl,
): Promise<DataChangeRun> {
  const names = new Set(scripts.map((script) => script.name));
  if (names.size !== scripts.length) {
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

  if (control.lock === "try") {
    const { rows } = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [DATA_CHANGE_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      return { ran: false, stopped: false, outcomes: [] };
    }
  } else {
    await client.query("select pg_advisory_lock($1)", [DATA_CHANGE_LOCK_KEY]);
  }
  const started = Date.now();
  const overBudget = () =>
    control.budgetMs !== undefined && Date.now() - started >= control.budgetMs;
  let stopped = false;
  try {
    const outcomes: DataChangeOutcome[] = [];
    for (const script of [...scripts].sort((a, b) =>
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

      // Before the ledger row, so a script the budget never reached still
      // reads as not yet run.
      if (overBudget()) {
        stopped = true;
        break;
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

      if (
        script.retiredBy !== undefined &&
        (await anyColumnMissing(client, script)) &&
        (await migrationApplied(client, script.retiredBy))
      ) {
        await client.query(
          "update _data_changes set completed_at = now() where name = $1",
          [script.name],
        );
        outcomes.push({ name: script.name, batches: 0, rowsChanged: 0 });
        continue;
      }

      await assertColumnsExist(client, script);

      let cursor = ledger?.cursor ?? null;
      // Lifetime totals, persisted to the ledger across every resume.
      let batches = ledger?.batches ?? 0;
      let rowsChanged = ledger ? Number(ledger.rows_changed) : 0;
      // This call's own contribution, reported back to this caller. Kept
      // apart from the lifetime totals above: an operator re-running
      // `pnpm db:change` on a script that already progressed through a
      // prior, since-crashed invocation wants to know what THIS run did,
      // not a total that keeps climbing across unrelated invocations.
      let sessionBatches = 0;
      let sessionRowsChanged = 0;
      let sessionRowsSkipped = 0;

      for (;;) {
        await client.query("begin");
        let result: DataChangeBatchResult;
        try {
          result = await script.runBatch(client, cursor);
          batches += 1;
          rowsChanged += result.rowsChanged;
          sessionBatches += 1;
          sessionRowsChanged += result.rowsChanged;
          sessionRowsSkipped += result.rowsSkipped ?? 0;
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
        // Between batches, after this one committed with its cursor.
        if (overBudget()) {
          stopped = true;
          break;
        }
      }

      outcomes.push({
        name: script.name,
        batches: sessionBatches,
        rowsChanged: sessionRowsChanged,
        ...(sessionRowsSkipped > 0 ? { rowsSkipped: sessionRowsSkipped } : {}),
      });
      if (stopped) {
        break;
      }
    }
    return { ran: true, stopped, outcomes };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [DATA_CHANGE_LOCK_KEY]);
  }
}

/** Where one registered script stands, as `dataChangeStatus` reports it. */
type DataChangeState = "complete" | "in progress" | "not yet run";

export interface DataChangeStatus {
  readonly name: string;
  readonly summary: string;
  readonly state: DataChangeState;
}

/**
 * What each registered script's ledger says, without running anything
 * (PLAN §5.1, plan 0.7.0 P9).
 *
 * **Read-only, and that is the point.** It takes no lock and creates no
 * ledger, so `./openokr status` can ask it on a live instance while a run is
 * going: a run in progress reads as "in progress", which is what it is.
 *
 * A retired script whose migration has dropped its columns reads as
 * complete, because the runner would mark it complete with nothing to do.
 * Every other script with no ledger row has not run yet, even where it would
 * change nothing, because that is only known by running it.
 */
export async function dataChangeStatus(
  client: DataChangeClient,
  scripts: readonly DataChangeScript[],
): Promise<DataChangeStatus[]> {
  const { rows: found } = await client.query<{ found: string | null }>(
    "select to_regclass('_data_changes')::text as found",
  );
  const ledger = new Map<string, { completed_at: string | null }>();
  if (found[0]?.found) {
    const { rows } = await client.query<{
      name: string;
      completed_at: string | null;
    }>("select name, completed_at from _data_changes");
    for (const row of rows) {
      ledger.set(row.name, row);
    }
  }

  const status: DataChangeStatus[] = [];
  for (const script of [...scripts].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  )) {
    const row = ledger.get(script.name);
    let state: DataChangeState;
    if (row?.completed_at) {
      state = "complete";
    } else if (row) {
      state = "in progress";
    } else if (
      script.retiredBy !== undefined &&
      (await anyColumnMissing(client, script)) &&
      (await migrationApplied(client, script.retiredBy))
    ) {
      state = "complete";
    } else {
      state = "not yet run";
    }
    status.push({ name: script.name, summary: script.summary, state });
  }
  return status;
}
