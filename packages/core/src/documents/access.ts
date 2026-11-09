/**
 * Who may read a document, and the subject it hangs on (TECHNICAL-PLAN §4.9,
 * P5-T12).
 *
 * Moved here from `actions/documents.ts` at plan 0.7.0 R2, unchanged, so the
 * attachment rules in `attachments/access.ts` can ask them without the two
 * action files importing each other.
 *
 * **A document inherits its subject's access**, and the draft rule narrows it
 * further: a draft is its author's alone, enforced in the query.
 */
import {
  activeOnly,
  type DocumentSubjectType,
  documents,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, or, sql } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";

/**
 * Which resource decides whether a document may be read.
 *
 * A key result inherits its goal's context and has no resolver of its own, so a
 * document on one has to be asked about through the goal. Every other subject
 * here resolves directly.
 */
export const RESOURCE_FOR: Readonly<Record<DocumentSubjectType, string>> = {
  space: "space",
  goal: "goal",
  // Resolved through the owning goal below, for the reason `access/reads.ts`
  // gives: "no such key result" and "not yours to see" must answer alike.
  key_result: "goal",
  initiative: "initiative",
  // Neither has a context of its own: a cycle and a session belong to the
  // workspace and the space respectively, and both are readable by anybody who
  // reads those. Checked against the workspace, which every active member
  // reaches, so the draft rule is what narrows a document on one.
  cycle: "workspace",
  session: "workspace",
};

/**
 * Refuses unless this member may read the subject a document hangs off.
 *
 * The key result case resolves its goal first, which is why this takes a
 * transaction rather than being a lookup table.
 */
export async function requireDocumentSubject(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  kind: DocumentSubjectType,
  subjectId: string,
  requires: number = ACCESS_LEVELS.view,
): Promise<void> {
  const resourceType = RESOURCE_FOR[kind];
  let resourceId = subjectId;

  if (kind === "key_result") {
    const rows = await tx.execute<{ goal_id: string }>(
      sql`select goal_id from key_results
           where id = ${subjectId}
             and workspace_id = ${workspaceId}
             and deleted_at is null
           limit 1`,
    );
    const goalId = rows.rows[0]?.goal_id;
    if (!goalId) {
      throw new OperationError("not_found", "No such key result.");
    }
    resourceId = goalId;
  }
  if (resourceType === "workspace") {
    resourceId = workspaceId;
  }

  await getAccessScoped(tx, {
    workspaceId,
    memberId,
    resourceType,
    resourceId,
    requires: requires as never,
  });
}

/**
 * The privacy rule, as a clause rather than as a habit.
 *
 * Every read composes this. It is one function so that a read written later
 * cannot forget it and quietly return somebody else's draft.
 */
export const readableDocuments = (memberId: string) =>
  or(eq(documents.state, "published"), eq(documents.authorMemberId, memberId));

/**
 * One document this member may read, or not-found.
 *
 * The subject check and the draft rule both run. Somebody else's draft answers
 * exactly as a document that never existed, which is what makes a direct
 * identifier probe useless.
 */
export async function loadReadableDocument(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  id: string,
) {
  const [row] = await tx
    .select({
      id: documents.id,
      shortId: documents.shortId,
      subjectType: documents.subjectType,
      subjectId: documents.subjectId,
      title: documents.title,
      body: documents.body,
      state: documents.state,
      publishedAt: documents.publishedAt,
      authorMemberId: documents.authorMemberId,
      authorName: workspaceMembers.name,
      updatedAt: documents.updatedAt,
      versionCount: sql<number>`(
        select count(*)::int from document_versions v
         where v.document_id = ${documents.id}
      )`,
    })
    .from(documents)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.id, documents.authorMemberId),
    )
    .where(
      and(
        activeOnly(
          documents,
          eq(documents.workspaceId, workspaceId),
          eq(documents.id, id),
        ),
        readableDocuments(memberId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new OperationError("not_found", "No such document.");
  }
  await requireDocumentSubject(
    tx,
    workspaceId,
    memberId,
    row.subjectType,
    row.subjectId,
  );

  return {
    ...row,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    body: row.body ?? null,
  };
}
