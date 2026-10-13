/**
 * Writes each monthly review decision as a document (guided-inputs change
 * 11a, migration 0140).
 *
 * The release that added `decisions.text_document` writes both columns from
 * then on, and its readers wrap the plain column while this has not reached
 * a row. This fills the document for every decision recorded before it, one
 * paragraph per blank-line block. A row that already has a document is left
 * as it is, so the script is safe to run again.
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

export const decisionTextDocument: DataChangeScript = {
  name: "0028_decision_text_document",
  summary:
    "Writes each monthly review decision as an editor document beside the plain text.",
  expects: [
    { table: "decisions", column: "id", dataType: "uuid" },
    { table: "decisions", column: "text", dataType: "text" },
    { table: "decisions", column: "text_document", dataType: "jsonb" },
    {
      table: "decisions",
      column: "text_document_version",
      dataType: "integer",
    },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ id: string; text: string }>(
      `select id, text from decisions
        where text_document is null
          and ($1::uuid is null or id > $1::uuid)
        order by id limit $2`,
      [cursor, BATCH_SIZE],
    );
    const filled = rows
      .map((row) => ({ id: row.id, document: plainTextDocument(row.text) }))
      .filter((row) => row.document.content.length > 0);
    if (filled.length > 0) {
      await client.query(
        `update decisions d
            set text_document = f.document,
                text_document_version = $3
           from unnest($1::uuid[], $2::jsonb[]) as f(id, document)
          where d.id = f.id and d.text_document is null`,
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
