/**
 * Short identifiers: the public address of every addressable aggregate
 * (TECHNICAL-PLAN §3, docs/design/short-ids.md).
 *
 * The generator itself is `newShortId` in `packages/db`, beside `newId`, so
 * the data change that backfills old rows draws from the same alphabet as the
 * write that makes a new one. What this adds is what a write needs on top: the
 * collision retry, and the two tests that tell an address from a key.
 */
import {
  newShortId,
  SHORT_ID_ALPHABET,
  SHORT_ID_LENGTH,
  type WorkspaceTx,
} from "@openokr/db";
import { sql } from "drizzle-orm";

export { newShortId, SHORT_ID_ALPHABET };

/**
 * Every kind of thing a short identifier addresses, and the table it is in.
 * KPIs have had one since migration 0026; the other seven since 0163.
 */
export const SHORT_ID_TABLES = {
  cycle: "cycles",
  goal: "goals",
  key_result: "key_results",
  kpi: "kpis",
  initiative: "initiatives",
  task: "tasks",
  document: "documents",
  session: "okr_sessions",
} as const;

/** One of the eight kinds a short identifier addresses. */
export type AddressKind = keyof typeof SHORT_ID_TABLES;

const SHORT_ID_PATTERN = new RegExp(
  `^[${SHORT_ID_ALPHABET}]{${SHORT_ID_LENGTH}}$`,
);

/**
 * Any string Postgres reads as a uuid, in either case. Looser than `z.uuid()`
 * on purpose: a value is either looked up as a key, as it always was, or as a
 * short identifier, and anything a key column would take goes the first way.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value has the shape of a short identifier. Case-sensitive. */
export function isShortId(value: string): boolean {
  return SHORT_ID_PATTERN.test(value);
}

/** Whether a value is a uuid, which an address treats as a key. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * How many candidates a write draws before it gives up. At 58^10 per workspace
 * a second draw is already a once-in-a-lifetime event; five is a bound on a
 * loop, not an estimate.
 */
const ATTEMPTS = 5;

/**
 * A short identifier no row of this kind in this workspace has, for a write
 * about to insert one.
 *
 * Checked against every row, deleted ones included, because the unique index
 * is not partial (migration 0163): a deleted goal keeps its address so that
 * restoring it never collides. Two writes drawing the same candidate at the
 * same moment is the one case this cannot see, and the index refuses the
 * second, which is a failed write rather than two things with one address.
 *
 * `generate` is a parameter so a test can force the collision this exists for.
 */
export async function freshShortId<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  kind: AddressKind,
  workspaceId: string,
  generate: () => string = newShortId,
): Promise<string> {
  const table = SHORT_ID_TABLES[kind];
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const candidate = generate();
    // Raw rather than through the table's Drizzle object: the check has to
    // see deleted rows, and one statement serves all eight tables.
    const taken = await tx.execute(
      sql`select 1 from ${sql.identifier(table)}
           where workspace_id = ${workspaceId}
             and short_id = ${candidate}
           limit 1`,
    );
    if (taken.rows.length === 0) {
      return candidate;
    }
  }
  throw new Error(
    `No free short identifier for a ${kind} after ${ATTEMPTS} draws. The generator is not random.`,
  );
}
