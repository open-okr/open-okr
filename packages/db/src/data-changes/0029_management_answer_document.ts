/**
 * Writes each management retro answer as a document (guided-inputs change
 * 11b, migration 0141).
 *
 * The release that added `management_answers.body_document` writes both
 * columns from then on, and its readers wrap the plain column while this has
 * not reached a row. This fills the document for every answer written before
 * it, one paragraph per blank-line block. A row that already has a document
 * is left as it is, so the script is safe to run again.
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

export const managementAnswerDocument: DataChangeScript = {
  name: "0029_management_answer_document",
  summary:
    "Writes each quarterly review management retro answer as an editor document beside the plain text.",
  expects: [
    { table: "management_answers", column: "id", dataType: "uuid" },
    { table: "management_answers", column: "body", dataType: "text" },
    { table: "management_answers", column: "body_document", dataType: "jsonb" },
    {
      table: "management_answers",
      column: "body_document_version",
      dataType: "integer",
    },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ id: string; body: string }>(
      `select id, body from management_answers
        where body_document is null
          and ($1::uuid is null or id > $1::uuid)
        order by id limit $2`,
      [cursor, BATCH_SIZE],
    );
    const filled = rows
      .map((row) => ({ id: row.id, document: plainTextDocument(row.body) }))
      .filter((row) => row.document.content.length > 0);
    if (filled.length > 0) {
      await client.query(
        `update management_answers a
            set body_document = f.document,
                body_document_version = $3
           from unnest($1::uuid[], $2::jsonb[]) as f(id, document)
          where a.id = f.id and a.body_document is null`,
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
