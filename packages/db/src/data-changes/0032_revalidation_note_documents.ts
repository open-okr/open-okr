/**
 * Writes each quarterly revalidation's two notes as documents (guided-inputs
 * change 12, migration 0143).
 *
 * The release that added `change_note_document` and `focus_note_document`
 * writes both columns of each from then on, and its readers wrap the plain
 * column while this has not reached a row. This fills each document still
 * missing, one paragraph per blank-line block. A note that is absent, or one
 * that already has a document, is left as it is, so the script is safe to
 * run again.
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

/** The document for a note, or null where there is nothing to wrap. */
function documentFor(note: string | null): string | null {
  if (note === null) {
    return null;
  }
  const document = plainTextDocument(note);
  return document.content.length > 0 ? JSON.stringify(document) : null;
}

export const revalidationNoteDocuments: DataChangeScript = {
  name: "0032_revalidation_note_documents",
  summary:
    "Writes each quarterly revalidation's change note and focus note as editor documents beside the plain text.",
  // Its columns go in 0.4, once migration 0144 has found nothing left for it.
  retiredBy: "0144_drop_plain_prose_columns.sql",
  expects: [
    { table: "cycle_revalidations", column: "cycle_id", dataType: "uuid" },
    { table: "cycle_revalidations", column: "change_note", dataType: "text" },
    { table: "cycle_revalidations", column: "focus_note", dataType: "text" },
    {
      table: "cycle_revalidations",
      column: "change_note_document",
      dataType: "jsonb",
    },
    {
      table: "cycle_revalidations",
      column: "change_note_document_version",
      dataType: "integer",
    },
    {
      table: "cycle_revalidations",
      column: "focus_note_document",
      dataType: "jsonb",
    },
    {
      table: "cycle_revalidations",
      column: "focus_note_document_version",
      dataType: "integer",
    },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{
      cycle_id: string;
      change_note: string | null;
      focus_note: string | null;
      change_note_document: unknown;
      focus_note_document: unknown;
    }>(
      `select cycle_id, change_note, focus_note,
              change_note_document, focus_note_document
         from cycle_revalidations
        where ((change_note is not null and change_note_document is null)
            or (focus_note is not null and focus_note_document is null))
          and ($1::uuid is null or cycle_id > $1::uuid)
        order by cycle_id limit $2`,
      [cursor, BATCH_SIZE],
    );
    const filled = rows
      .map((row) => ({
        id: row.cycle_id,
        change:
          row.change_note_document === null
            ? documentFor(row.change_note)
            : null,
        focus:
          row.focus_note_document === null ? documentFor(row.focus_note) : null,
      }))
      .filter((row) => row.change !== null || row.focus !== null);
    if (filled.length > 0) {
      // Each document only where it is still missing, and its version with
      // it, so the check that pairs the two holds row by row.
      await client.query(
        `update cycle_revalidations r
            set change_note_document = coalesce(r.change_note_document, f.change),
                change_note_document_version = case
                  when r.change_note_document is null and f.change is not null
                    then $4 else r.change_note_document_version end,
                focus_note_document = coalesce(r.focus_note_document, f.focus),
                focus_note_document_version = case
                  when r.focus_note_document is null and f.focus is not null
                    then $4 else r.focus_note_document_version end
           from unnest($1::uuid[], $2::jsonb[], $3::jsonb[]) as f(id, change, focus)
          where r.cycle_id = f.id`,
        [
          filled.map((row) => row.id),
          filled.map((row) => row.change),
          filled.map((row) => row.focus),
          BACKFILL_RICH_TEXT_VERSION,
        ],
      );
    }
    return {
      done: rows.length < BATCH_SIZE,
      cursor: rows.at(-1)?.cycle_id,
      rowsChanged: filled.length,
    };
  },
};
