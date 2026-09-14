/**
 * Running an `in (...)` query in chunks (P7-T01b).
 *
 * **This is a correctness guard, not a speed one.** Drizzle's `inArray` sends
 * one placeholder per id and Postgres refuses a statement carrying more than
 * 65,535 parameters. Several list reads collect every id a member can see and
 * then look their children up in one statement, which is fine at the few
 * hundred rows a test fixture holds and fails outright at §13.1's hundred
 * thousand. Not slowly: with an error, so the Work Map and the alignment graph
 * would not open at all on a large workspace.
 *
 * Found by the budget harness on the seeded dataset, which is exactly the
 * reason §13.1 asks for the budgets to be measured there rather than on a
 * fixture.
 *
 * **It does not make an unbounded read bounded.** §13.2 asks for keyset
 * pagination everywhere, and a read that loads every visible row into memory
 * still does so a chunk at a time. The reads that need paginating are recorded
 * on the P7-T01b row; this stops them failing in the meantime.
 */

/**
 * Ids per statement.
 *
 * Two thousand leaves the 65,535-parameter ceiling far behind even for a
 * query carrying other parameters, and keeps every list a person actually
 * opens to a single round trip.
 */
const ID_CHUNK = 2_000;

/**
 * Runs `query` once per chunk of `ids` and concatenates the answers.
 *
 * Order is preserved across chunks in the order the ids were given, which is
 * not the same as a global sort: a caller that needs one sorts the result, as
 * it would have had to anyway once the rows came back from several statements.
 */
export async function selectInChunks<Id, Row>(
  ids: readonly Id[],
  query: (batch: Id[]) => Promise<Row[]>,
  size: number = ID_CHUNK,
): Promise<Row[]> {
  if (ids.length === 0) {
    return [];
  }
  if (ids.length <= size) {
    return query([...ids]);
  }
  const collected: Row[] = [];
  for (let start = 0; start < ids.length; start += size) {
    const rows = await query(ids.slice(start, start + size) as Id[]);
    // A loop rather than `push(...rows)`: spreading a hundred thousand rows
    // into an argument list overflows the call stack, which is the second
    // failure this read had once the parameter ceiling stopped hiding it.
    for (const row of rows) {
      collected.push(row);
    }
  }
  return collected;
}
