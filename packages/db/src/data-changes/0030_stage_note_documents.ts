/**
 * Turns each private stage note written as text into a document
 * (guided-inputs change 11b).
 *
 * A facilitator's notes are values in `okr_sessions.notes`, keyed by stage.
 * The release that made them rich text writes documents, and its readers
 * take a string or a document; this rewrites every string, one paragraph per
 * blank-line block, so the release after can take documents only. A note of
 * whitespace alone is a note nobody wrote, and its key goes, as the save has
 * always removed an emptied one. Values that are already documents are left
 * as they are, so the script is safe to run again.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";
import { plainTextDocument } from "./plain-text-document.ts";

const BATCH_SIZE = 200;

export const stageNoteDocuments: DataChangeScript = {
  name: "0030_stage_note_documents",
  summary:
    "Turns each facilitator's private stage note written as text into an editor document.",
  expects: [
    { table: "okr_sessions", column: "id", dataType: "uuid" },
    { table: "okr_sessions", column: "notes", dataType: "jsonb" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{
      id: string;
      notes: Record<string, unknown>;
    }>(
      `select id, notes from okr_sessions s
        where exists (
                select 1 from jsonb_each(s.notes) as e
                 where jsonb_typeof(e.value) = 'string'
              )
          and ($1::uuid is null or id > $1::uuid)
        order by id limit $2`,
      [cursor, BATCH_SIZE],
    );
    const rewritten = rows.map((row) => {
      const notes: Record<string, unknown> = {};
      for (const [stage, value] of Object.entries(row.notes)) {
        if (typeof value !== "string") {
          notes[stage] = value;
          continue;
        }
        const document = plainTextDocument(value);
        if (document.content.length > 0) {
          notes[stage] = document;
        }
      }
      return { id: row.id, notes };
    });
    if (rewritten.length > 0) {
      await client.query(
        `update okr_sessions s
            set notes = f.notes
           from unnest($1::uuid[], $2::jsonb[]) as f(id, notes)
          where s.id = f.id`,
        [
          rewritten.map((row) => row.id),
          rewritten.map((row) => JSON.stringify(row.notes)),
        ],
      );
    }
    return {
      done: rows.length < BATCH_SIZE,
      cursor: rows.at(-1)?.id,
      rowsChanged: rewritten.length,
    };
  },
};
