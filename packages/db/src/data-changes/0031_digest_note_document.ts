/**
 * Writes each digest's coordinator note as a document (guided-inputs change
 * 11c, migration 0142).
 *
 * The release that added `digests.note_document` writes both columns from
 * then on, and its readers wrap the plain column while this has not reached a
 * row. This fills the document for every note written before it, one
 * paragraph per blank-line block. A digest with no note, or one that already
 * has a document, is left as it is, so the script is safe to run again.
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

export const digestNoteDocument: DataChangeScript = {
  name: "0031_digest_note_document",
  summary:
    "Writes each weekly digest's coordinator note as an editor document beside the plain text.",
  // Its columns go in 0.4, once migration 0144 has found nothing left for it.
  retiredBy: "0144_drop_plain_prose_columns.sql",
  expects: [
    { table: "digests", column: "id", dataType: "uuid" },
    { table: "digests", column: "note", dataType: "text" },
    { table: "digests", column: "note_document", dataType: "jsonb" },
    { table: "digests", column: "note_document_version", dataType: "integer" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ id: string; note: string }>(
      `select id, note from digests
        where note is not null and note_document is null
          and ($1::uuid is null or id > $1::uuid)
        order by id limit $2`,
      [cursor, BATCH_SIZE],
    );
    const filled = rows
      .map((row) => ({ id: row.id, document: plainTextDocument(row.note) }))
      .filter((row) => row.document.content.length > 0);
    if (filled.length > 0) {
      await client.query(
        `update digests d
            set note_document = f.document,
                note_document_version = $3
           from unnest($1::uuid[], $2::jsonb[]) as f(id, document)
          where d.id = f.id and d.note_document is null`,
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
