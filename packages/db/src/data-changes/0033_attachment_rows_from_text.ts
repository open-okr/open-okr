/**
 * Records an attachment row for each file already in a comment's or a
 * document's text (docs/design/rich-text-editor.md §11, Q1, approved by Akmal
 * on 9 November 2026; migration 0155).
 *
 * From 0.7.0 every write that saves a comment or a document records a `text`
 * row for each file its text names, and the row is what lets a reader of the
 * comment or the document open the file. Text written before that has no
 * row, so only its uploader can open the file. The one place real data holds
 * such files is an import: each inline image in a FlowyTeam comment was stored
 * as a blob uploaded by whoever ran the import, so nobody else can see it.
 *
 * **What it opens.** A `ready` node gets a `text` row on its comment or
 * document when its blob is live in the same workspace, is not `pending`, and
 * either was uploaded by the member who wrote that text or sits in an
 * imported comment (one with a legacy key). For a document, the text is its
 * body and every published version's body, each judged by its own author.
 * Every other file is skipped and counted: another member's private file in
 * somebody's comment stays as closed as it was, because a row would publish
 * it to every reader.
 *
 * **One workspace a batch, inside its own tenant setting.** `packages/db`
 * cannot import the rich-text module, so the nodes are found with
 * `jsonb_path_query`. A deployment's admin connection may be the table owner
 * rather than a superuser, and FORCE ROW LEVEL SECURITY binds the owner too,
 * so the script lists workspaces through the scheduler's read-only scan
 * setting and then opens each one as the application does. The floor is
 * never lifted.
 *
 * Safe to run again: a file that already has a live row on its subject, of
 * either origin, is left as it is.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

const UUID_PATTERN =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/**
 * The one statement a batch runs, for the workspace in `$1`.
 *
 * Positions follow the highest live one on each subject, in the order the
 * files appear: a document's body first, then its versions oldest first.
 */
const RECORD_ROWS = `
with bodies as (
  select 'comment'::text as subject_type, c.id as subject_id, c.body,
         c.author_member_id as writer, c.legacy_id is not null as imported,
         0::bigint as source
    from comments c
   where c.workspace_id = $1
  union all
  select 'document', d.id, d.body, d.author_member_id, false, 0
    from documents d
   where d.workspace_id = $1 and d.body is not null
  union all
  select 'document', v.document_id, v.body, v.author_member_id, false,
         v.version::bigint
    from document_versions v
   where v.workspace_id = $1 and v.body is not null
),
named as (
  select b.subject_type, b.subject_id, b.writer, b.imported, b.source,
         n.place,
         case when n.node #>> '{attrs,blobId}' ~* '${UUID_PATTERN}'
              then (n.node #>> '{attrs,blobId}')::uuid end as blob_id
    from bodies b
   cross join lateral jsonb_path_query(
           b.body,
           'strict $.** ? (@.type == "attachment" && @.attrs.status == "ready")'
         ) with ordinality as n(node, place)
),
judged as (
  select n.subject_type, n.subject_id, n.blob_id,
         min(array[n.source, n.place]) as first_seen,
         bool_or(
           f.id is not null and (n.imported or f.author_member_id = n.writer)
         ) as usable
    from named n
    left join blobs f
      on f.id = n.blob_id
     and f.workspace_id = $1
     and f.deleted_at is null
     and f.status <> 'pending'
   group by n.subject_type, n.subject_id, n.blob_id
),
missing as (
  select j.*
    from judged j
   where not exists (
     select 1 from attachments a
      where a.workspace_id = $1
        and a.subject_type = j.subject_type
        and a.subject_id = j.subject_id
        and a.blob_id = j.blob_id
        and a.deleted_at is null
   )
),
inserted as (
  insert into attachments
    (id, workspace_id, subject_type, subject_id, blob_id, position, origin)
  select gen_random_uuid(), $1, o.subject_type, o.subject_id, o.blob_id,
         coalesce((
           select max(a.position) from attachments a
            where a.workspace_id = $1
              and a.subject_type = o.subject_type
              and a.subject_id = o.subject_id
              and a.deleted_at is null
         ), 0) + row_number() over (
           partition by o.subject_type, o.subject_id order by o.first_seen
         ),
         'text'
    from missing o
   where o.usable
  returning 1
)
select (select count(*) from inserted)::int as inserted,
       (select count(*) from missing where not usable)::int as skipped
`;

export const attachmentRowsFromText: DataChangeScript = {
  name: "0033_attachment_rows_from_text",
  summary:
    "Records an attachment row for each file already in a comment's or a document's text, so its readers can open it.",
  expects: [
    { table: "workspaces", column: "id", dataType: "uuid" },
    { table: "comments", column: "workspace_id", dataType: "uuid" },
    { table: "comments", column: "body", dataType: "jsonb" },
    { table: "comments", column: "author_member_id", dataType: "uuid" },
    { table: "comments", column: "legacy_id", dataType: "text" },
    { table: "documents", column: "body", dataType: "jsonb" },
    { table: "documents", column: "author_member_id", dataType: "uuid" },
    { table: "document_versions", column: "document_id", dataType: "uuid" },
    { table: "document_versions", column: "body", dataType: "jsonb" },
    { table: "document_versions", column: "version", dataType: "integer" },
    {
      table: "document_versions",
      column: "author_member_id",
      dataType: "uuid",
    },
    { table: "blobs", column: "author_member_id", dataType: "uuid" },
    { table: "blobs", column: "status", dataType: "text" },
    {
      table: "blobs",
      column: "deleted_at",
      dataType: "timestamp with time zone",
    },
    { table: "attachments", column: "subject_type", dataType: "text" },
    { table: "attachments", column: "subject_id", dataType: "uuid" },
    { table: "attachments", column: "blob_id", dataType: "uuid" },
    { table: "attachments", column: "position", dataType: "integer" },
    { table: "attachments", column: "origin", dataType: "text" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    // The scheduler's read-only scan lists tenants without a role that
    // bypasses the floor (migration 0099). Local to this batch.
    await client.query("select set_config('app.system_scan', 'on', true)");
    const { rows: next } = await client.query<{ id: string }>(
      `select id from workspaces
        where ($1::uuid is null or id > $1::uuid)
        order by id limit 2`,
      [cursor],
    );
    await client.query("select set_config('app.system_scan', '', true)");

    const workspace = next[0];
    if (!workspace) {
      return { done: true, rowsChanged: 0 };
    }

    await client.query("select set_config('app.workspace_id', $1, true)", [
      workspace.id,
    ]);
    const { rows } = await client.query<{ inserted: number; skipped: number }>(
      RECORD_ROWS,
      [workspace.id],
    );
    await client.query("select set_config('app.workspace_id', '', true)");

    return {
      done: next.length < 2,
      cursor: workspace.id,
      rowsChanged: rows[0]?.inserted ?? 0,
      rowsSkipped: rows[0]?.skipped ?? 0,
    };
  },
};
