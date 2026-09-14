/**
 * A member's own data, out of every table that holds them (P7-T08b).
 *
 * **The list is the hard part, not the query.** Forty-eight tables in this
 * schema carry a member column. An export written by hand against the ones
 * somebody remembered would be wrong the first time a table was added, and
 * wrong silently: a missing table looks exactly like a member who wrote
 * nothing.
 *
 * So every one of the forty-eight is classified here, and
 * `people-export.test.ts` reads the schema source and fails when a table
 * carries a member column and is not in this file. Adding a table to the
 * product therefore fails a test until somebody decides whether it holds
 * that member's data. That decision is the point; the query is three lines.
 *
 * **A skip needs a reason, the same way every marker in this repository
 * does.** "Not their data" is a claim about somebody's personal
 * information, and a claim like that should be written down where the next
 * person can disagree with it.
 */

import type { WorkspaceTx } from "@openokr/db";
import { sql } from "drizzle-orm";

/**
 * Why a table is not in a member's export.
 *
 * Not exported: it is a vocabulary this file uses to argue with itself, and
 * the shape that leaves is `PersonalExport`.
 */
type SkipReason =
  /** Structure: it records where they sit, not anything they produced. */
  | "structural"
  /** Authorisation: exporting it would be exporting the access model. */
  | "access"
  /** Derived: recomputed from rows that are exported in their own right. */
  | "derived"
  /** A credential or an identifier, which erasure deletes rather than hands back. */
  | "credential"
  /** The workspace's own record of what happened, not the member's content. */
  | "workspace_record";

export interface ExportTable {
  /** The table, exactly as the database names it. */
  readonly table: string;
  /** The column holding the member. */
  readonly column: string;
  /** What a person would call this in the export they receive. */
  readonly label?: string;
  /** Absent means export it. Present means do not, and says why. */
  readonly skip?: SkipReason;
  /** Required whenever `skip` is set. */
  readonly because?: string;
}

/**
 * Every table with a member column, classified.
 *
 * Ordered by table name rather than by importance, so the list can be read
 * against the schema without anybody having to hold two orders in their
 * head.
 */
export const EXPORT_MANIFEST: readonly ExportTable[] = [
  {
    table: "access_group_memberships",
    column: "member_id",
    skip: "access",
    because: "Which access group they sit in is the authorisation model.",
  },
  {
    table: "access_groups",
    column: "member_id",
    skip: "access",
    because: "The personal access group exists to hold bindings, not content.",
  },
  {
    table: "activities",
    column: "actor_member_id",
    skip: "workspace_record",
    because:
      "The workspace's feed of what happened. The thing they did is exported from the table that holds it.",
  },
  {
    table: "agents",
    column: "member_id",
    skip: "structural",
    because: "An agent is a member of its own. A human never owns a row here.",
  },
  {
    table: "ai_credentials",
    column: "owner_member_id",
    skip: "credential",
    because: "A sealed provider key. Erasure deletes it; nobody exports it.",
  },
  {
    table: "ai_prompts",
    column: "created_by_member_id",
    skip: "workspace_record",
    because:
      "A workspace's prompt template, authored by an administrator for everyone. Not personal data.",
  },
  {
    table: "ai_threads",
    column: "member_id",
    label: "Copilot conversations",
  },
  {
    table: "ai_usage_events",
    column: "member_id",
    label: "AI usage recorded against you",
  },
  {
    table: "api_tokens",
    column: "member_id",
    skip: "credential",
    because:
      "Hashed tokens. Handing them back would be handing back a credential in a file.",
  },
  {
    table: "audit_events",
    column: "actor_member_id",
    skip: "workspace_record",
    because:
      "The append-only trail. It is the instance's record of who did what, and it is not editable or removable by design.",
  },
  {
    table: "blobs",
    column: "author_member_id",
    label: "Files you uploaded",
  },
  {
    table: "channel_conversations",
    column: "member_id",
    skip: "credential",
    because: "Keyed to their external account. Erasure deletes it.",
  },
  {
    table: "channel_identities",
    column: "member_id",
    skip: "credential",
    because:
      "The external account id and handle. Erasure deletes these; an export would put them in a file.",
  },
  {
    table: "channel_link_codes",
    column: "member_id",
    skip: "credential",
    because: "One-time codes. Erasure deletes them.",
  },
  {
    table: "channel_messages",
    column: "member_id",
    label: "Messages sent to you",
  },
  { table: "check_in_votes", column: "member_id", label: "Confidence votes" },
  { table: "check_ins", column: "author_member_id", label: "Check-ins" },
  { table: "comments", column: "author_member_id", label: "Comments" },
  {
    table: "cycle_calibrations",
    column: "author_member_id",
    label: "Calibration notes",
  },
  { table: "decisions", column: "author_member_id", label: "Decisions" },
  {
    table: "device_authorisations",
    column: "approved_member_id",
    skip: "credential",
    because: "A device login they approved. The grant, not their content.",
  },
  {
    table: "document_versions",
    column: "author_member_id",
    label: "Document versions",
  },
  { table: "documents", column: "author_member_id", label: "Documents" },
  {
    table: "goal_retrospectives",
    column: "author_member_id",
    label: "Retrospectives",
  },
  {
    table: "goals",
    column: "member_id",
    skip: "structural",
    because:
      "The champion or reviewer role on a goal. The goal belongs to the workspace; what they wrote about it is exported from check-ins, trends and retrospectives.",
  },
  {
    table: "invite_links",
    column: "invited_by_member_id",
    skip: "structural",
    because: "Who invited whom. A membership fact, not content.",
  },
  {
    table: "key_result_values",
    column: "author_member_id",
    label: "Values you recorded",
  },
  {
    table: "kpi_records",
    column: "author_member_id",
    label: "KPI values you recorded",
  },
  {
    table: "kpi_shares",
    column: "member_id",
    skip: "access",
    because: "Who a KPI is shared with is authorisation.",
  },
  {
    table: "kpis",
    column: "member_id",
    skip: "structural",
    because: "Ownership of a KPI. The readings are exported from kpi_records.",
  },
  { table: "kudos", column: "from_member_id", label: "Kudos you gave" },
  {
    table: "notification_batches",
    column: "member_id",
    skip: "derived",
    because:
      "A delivery window, rebuilt from notifications. Holds no words of theirs.",
  },
  {
    table: "notification_settings",
    column: "member_id",
    label: "Your notification settings",
  },
  {
    table: "notifications",
    column: "recipient_member_id",
    label: "Your inbox",
  },
  {
    table: "nudges",
    column: "recipient_member_id",
    label: "Nudges you were sent",
  },
  {
    table: "oauth_grants",
    column: "member_id",
    skip: "credential",
    because: "An app's access to their account. Erasure revokes it.",
  },
  {
    table: "objective_trends",
    column: "author_member_id",
    label: "Trend notes",
  },
  {
    table: "performance_snapshots",
    column: "member_id",
    skip: "derived",
    because:
      "Recomputed from scores and check-ins, both exported in their own right.",
  },
  {
    table: "proposed_changes",
    column: "decided_by_member_id",
    skip: "workspace_record",
    because:
      "An agent's proposal and the decision on it. The proposal is the agent's, the decision is one click.",
  },
  { table: "reactions", column: "member_id", label: "Reactions" },
  { table: "retro_notes", column: "author_member_id", label: "Retro notes" },
  { table: "retro_votes", column: "member_id", label: "Retro votes" },
  {
    table: "review_narratives",
    column: "author_member_id",
    label: "Review narratives",
  },
  { table: "score_entries", column: "member_id", label: "Scores you gave" },
  {
    table: "session_participants",
    column: "member_id",
    skip: "structural",
    because:
      "Attendance. What they said in the session is exported from votes, notes and narratives.",
  },
  {
    table: "space_members",
    column: "member_id",
    skip: "structural",
    because: "Which spaces they belong to. A membership fact.",
  },
  {
    table: "subscriptions",
    column: "member_id",
    label: "What you follow",
  },
  {
    table: "task_assignees",
    column: "member_id",
    skip: "structural",
    because: "Assignment. The task belongs to the workspace.",
  },
  {
    table: "check_ins",
    column: "reviewer_member_id",
    skip: "structural",
    because:
      "Being named as the reviewer of somebody else's check-in is a role, not content. What they wrote is exported under author_member_id.",
  },
  {
    table: "invite_links",
    column: "member_id",
    skip: "structural",
    because:
      "The membership an invitation created. A joining fact, and the invitation itself belongs to whoever sent it.",
  },
  {
    table: "kudos",
    column: "to_member_id",
    label: "Kudos you received",
  },
];

/** One table's rows, as the export carries them. Internal, like SkipReason. */
interface ExportedTable {
  readonly table: string;
  readonly label: string;
  readonly rows: readonly Record<string, unknown>[];
}

export interface PersonalExport {
  readonly memberId: string;
  readonly takenAt: string;
  readonly tables: readonly ExportedTable[];
  /**
   * What was left out and why, in the export itself.
   *
   * **An export that silently omits things is worse than a short one.** A
   * person receiving this should be able to see that their access bindings
   * and their tokens were not included, and read the reason, rather than
   * conclude the product has less of their data than it does.
   */
  readonly omitted: readonly {
    readonly table: string;
    readonly reason: SkipReason;
    readonly because: string;
  }[];
}

/**
 * Reads everything the manifest marks for export.
 *
 * **Runs on the caller's transaction**, so an erasure can take the export
 * and anonymise in one commit. An export taken in a separate transaction
 * could miss a row written between the two, which for an erasure means
 * handing somebody an incomplete copy of what was about to be destroyed.
 *
 * The table and column names come from `EXPORT_MANIFEST`, which is a
 * literal in this file, so the interpolation below is over a closed list
 * the code declares rather than over anything a caller supplies. Written
 * as raw SQL rather than through the query builder deliberately: an export
 * wants every column of every row including the soft-deleted ones, and
 * naming forty-eight tables' columns in a builder would be a second schema
 * to keep in step with the first.
 */
export async function buildPersonalExport(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly memberId: string },
): Promise<PersonalExport> {
  const tables: ExportedTable[] = [];

  for (const entry of EXPORT_MANIFEST) {
    if (entry.skip) {
      continue;
    }
    // **Identifiers through `sql.identifier`, values as parameters.** The
    // table and column come from the manifest above, which is a literal in
    // this file, but interpolating them as text would still be a pattern
    // the next person copies somewhere it is not safe. The member and the
    // workspace are parameters, never text: they arrive from a caller, and
    // a validated uuid is not a reason to build a query by concatenation.
    const result = await tx.execute(
      sql`select * from ${sql.identifier(entry.table)}
           where ${sql.identifier(entry.column)} = ${input.memberId}
             and workspace_id = ${input.workspaceId}`,
    );
    const rows = (result as unknown as { rows?: Record<string, unknown>[] })
      .rows;
    tables.push({
      table: entry.table,
      label: entry.label ?? entry.table,
      rows: rows ?? [],
    });
  }

  return {
    memberId: input.memberId,
    takenAt: new Date().toISOString(),
    tables,
    omitted: EXPORT_MANIFEST.filter((entry) => entry.skip).map((entry) => ({
      table: entry.table,
      reason: entry.skip as SkipReason,
      because: entry.because ?? "",
    })),
  };
}
