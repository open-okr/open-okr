/**
 * Writes each monthly review's shifts as a document (guided-inputs change
 * 11a, migration 0140).
 *
 * The release that added `okr_sessions.shifts_document` writes both columns
 * from then on, and its readers wrap the plain column while this has not
 * reached a row. This fills the document for every row written before it,
 * one paragraph per blank-line block. A row that already has a document is
 * left as it is, so the script is safe to run again and never overwrites a
 * note written in the editor.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";
import {
  BACKFILL_RICH_TEXT_VERSION,
  plainTextDocument,
} from "./plain-text-document.ts";

const BATCH_SIZE = 200;

export const sessionShiftsDocument: DataChangeScript = {
  name: "0027_session_shifts_document",
  summary:
    "Writes each monthly review's resource or priority shifts as an editor document beside the plain text.",
  expects: [
    { table: "okr_sessions", column: "id", dataType: "uuid" },
    { table: "okr_sessions", column: "shifts", dataType: "text" },
    { table: "okr_sessions", column: "shifts_document", dataType: "jsonb" },
    {
      table: "okr_sessions",
      column: "shifts_document_version",
      dataType: "integer",
    },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ id: string; shifts: string }>(
      `select id, shifts from okr_sessions
        where shifts is not null and shifts_document is null
          and ($1::uuid is null or id > $1::uuid)
        order by id limit $2`,
      [cursor, BATCH_SIZE],
    );
    // Whitespace alone wraps to a document with nothing in it, which is the
    // old column's "nothing noted" too, so it stays without a document.
    const filled = rows
      .map((row) => ({ id: row.id, document: plainTextDocument(row.shifts) }))
      .filter((row) => row.document.content.length > 0);
    if (filled.length > 0) {
      await client.query(
        `update okr_sessions s
            set shifts_document = f.document,
                shifts_document_version = $3
           from unnest($1::uuid[], $2::jsonb[]) as f(id, document)
          where s.id = f.id and s.shifts_document is null`,
        [
          filled.map((row) => row.id),
          filled.map((row) => JSON.stringify(row.document)),
          BACKFILL_RICH_TEXT_VERSION,
        ],
      );
    }
    return {
      done: rows.length < BATCH_SIZE,
      cursor: rows.at(-1)?.id,
      rowsChanged: filled.length,
    };
  },
};
