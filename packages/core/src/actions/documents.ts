/**
 * Documents, their versions and attachments (TECHNICAL-PLAN §4.9, P5-T12).
 *
 * **A draft is invisible to everybody but its author, and the query is what
 * makes it so.** Every read here adds `(state = 'published' or
 * author_member_id = $me)` to its own where clause, so there is no code path
 * that returns a draft to somebody else, including a direct identifier probe.
 * That answers not-found, the same as everything else a reader may not see. A
 * filter in a component is a filter one careless read forgets, which is why the
 * work-layer design's §4.2 puts it here.
 *
 * **A document inherits its subject's access.** A document on a goal is
 * readable by whoever reads the goal; one on a space by whoever reads the
 * space. Giving a document its own context would be a second answer about who
 * can see a goal's material.
 *
 * **Publishing emits the activity and the notification. Drafting emits
 * neither.** A draft nobody can read must not appear in anybody's feed: an entry
 * for something the reader cannot open is a leak with extra steps.
 */
import {
  ATTACHMENT_SUBJECT_TYPES,
  activeOnly,
  attachments,
  blobs,
  DOCUMENT_STATES,
  DOCUMENT_SUBJECT_TYPES,
  type DocumentSubjectType,
  documents,
  documentVersions,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { notifyRecipients } from "../notifications/create.ts";
import { resolveRecipients } from "../notifications/recipients.ts";
import { ensureSubscriptionList } from "../notifications/subscriptions.ts";
import type { OperationTx } from "../operations/operation.ts";
import { OperationError } from "../operations/operation.ts";
import { diffLines } from "../rich-text/diff.ts";
import { plainTextLines } from "../rich-text/excerpt.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const richText = z
  .unknown()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    { message: "not valid editor JSON for the current rich text schema" },
  );

const subjectType = z.enum(DOCUMENT_SUBJECT_TYPES);

/**
 * Which resource decides whether a document may be read.
 *
 * A key result inherits its goal's context and has no resolver of its own, so a
 * document on one has to be asked about through the goal. Every other subject
 * here resolves directly.
 */
const RESOURCE_FOR: Readonly<Record<DocumentSubjectType, string>> = {
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

const documentSummary = z.object({
  id: z.uuid(),
  subjectType,
  subjectId: z.uuid(),
  title: z.string(),
  state: z.enum(DOCUMENT_STATES),
  publishedAt: z.string().nullable(),
  authorMemberId: z.uuid(),
  authorName: z.string(),
  updatedAt: z.string(),
  /** How many published versions there are. Zero on a draft nobody has shown. */
  versionCount: z.number().int(),
});

function requireMemberId(memberId: string | null | undefined): string {
  if (!memberId) {
    throw new OperationError("forbidden", "A system actor cannot do this.");
  }
  return memberId;
}

async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such document.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such document.");
  }
  return member.id;
}

/**
 * Refuses unless this member may read the subject a document hangs off.
 *
 * The key result case resolves its goal first, which is why this takes a
 * transaction rather than being a lookup table.
 */
async function requireSubject(
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
 * Every read below composes this. It is one function so that a read written
 * later cannot forget it and quietly return somebody else's draft.
 */
const readableDocuments = (memberId: string) =>
  or(eq(documents.state, "published"), eq(documents.authorMemberId, memberId));

export const listDocuments = defineReadAction({
  name: "documents.list",
  summary:
    "The documents on one subject. Somebody else's draft is not among them.",
  input: z.object({ subjectType, subjectId: z.uuid() }),
  output: z.array(documentSummary),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      return [];
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        await requireSubject(
          tx,
          context.workspaceId,
          memberId,
          input.subjectType,
          input.subjectId,
        );

        const rows = await tx
          .select({
            id: documents.id,
            subjectType: documents.subjectType,
            subjectId: documents.subjectId,
            title: documents.title,
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
                eq(documents.workspaceId, context.workspaceId),
                eq(documents.subjectType, input.subjectType),
                eq(documents.subjectId, input.subjectId),
              ),
              readableDocuments(memberId),
            ),
          )
          .orderBy(desc(documents.updatedAt));

        return rows.map((row) => ({
          ...row,
          publishedAt: row.publishedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        }));
      },
    );
  },
});

export const readDocument = defineReadAction({
  name: "documents.read",
  summary:
    "One document with its body and its version list. Drives screen S-29.",
  input: z.object({ id: z.uuid() }),
  output: documentSummary.extend({
    body: z.unknown().nullable(),
    versions: z.array(
      z.object({
        id: z.uuid(),
        version: z.number().int(),
        title: z.string(),
        authorName: z.string(),
        createdAt: z.string(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such document.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const row = await loadReadable(
          tx,
          context.workspaceId,
          memberId,
          input.id,
        );

        const versions = await tx
          .select({
            id: documentVersions.id,
            version: documentVersions.version,
            title: documentVersions.title,
            authorName: workspaceMembers.name,
            createdAt: documentVersions.createdAt,
          })
          .from(documentVersions)
          .innerJoin(
            workspaceMembers,
            eq(workspaceMembers.id, documentVersions.authorMemberId),
          )
          .where(
            and(
              eq(documentVersions.workspaceId, context.workspaceId),
              eq(documentVersions.documentId, input.id),
            ),
          )
          .orderBy(desc(documentVersions.version));

        return {
          ...row,
          versions: versions.map((one) => ({
            ...one,
            createdAt: one.createdAt.toISOString(),
          })),
        };
      },
    );
  },
});

/**
 * One document this member may read, or not-found.
 *
 * The subject check and the draft rule both run. Somebody else's draft answers
 * exactly as a document that never existed, which is what makes a direct
 * identifier probe useless.
 */
async function loadReadable(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  id: string,
) {
  const [row] = await tx
    .select({
      id: documents.id,
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
  await requireSubject(
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

export const readDocumentDifference = defineReadAction({
  name: "documents.difference",
  summary:
    "What changed between two published versions of a document, line by line.",
  input: z.object({
    id: z.uuid(),
    /** The older version. Defaults to the one before `to`. */
    from: z.number().int().min(1).optional(),
    /** The newer version. Defaults to the latest. */
    to: z.number().int().min(1).optional(),
  }),
  output: z.object({
    from: z.number().int().nullable(),
    to: z.number().int().nullable(),
    added: z.number().int(),
    removed: z.number().int(),
    truncated: z.boolean(),
    lines: z.array(
      z.object({
        kind: z.enum(["same", "added", "removed"]),
        text: z.string(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such document.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        // Through the same reader every other document read uses, so a
        // difference cannot become a way to read somebody else's draft.
        await loadReadable(tx, context.workspaceId, memberId, input.id);

        const rows = await tx
          .select({
            version: documentVersions.version,
            body: documentVersions.body,
          })
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.workspaceId, context.workspaceId),
              eq(documentVersions.documentId, input.id),
            ),
          )
          .orderBy(asc(documentVersions.version));

        const empty = {
          from: null,
          to: null,
          added: 0,
          removed: 0,
          truncated: false,
          lines: [],
        };
        if (rows.length === 0) {
          return empty;
        }

        const latest = rows[rows.length - 1]?.version ?? 1;
        const to = input.to ?? latest;
        const from = input.from ?? to - 1;
        const after = rows.find((one) => one.version === to);
        if (!after) {
          return empty;
        }
        const before = rows.find((one) => one.version === from);

        // One line per block, not the collapsed excerpt: a line comparison
        // against a single-line rendering says the whole document changed
        // whenever a word did.
        const text = (body: unknown) =>
          body === null || body === undefined
            ? ""
            : plainTextLines(body as never).join("\n");

        const result = diffLines(text(before?.body ?? null), text(after.body));
        return {
          from: before ? from : null,
          to,
          added: result.added,
          removed: result.removed,
          truncated: result.truncated,
          lines: [...result.lines],
        };
      },
    );
  },
});

export const createDocument = defineWriteAction({
  name: "documents.create",
  summary:
    "Starts a document on a subject. It is a draft, and a draft is private to its author.",
  input: z.object({
    subjectType,
    subjectId: z.uuid(),
    title: z.string().trim().min(1).max(300),
    body: richText.optional(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      await requireSubject(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.subjectType,
        input.subjectId,
        ACCESS_LEVELS.edit,
      );
      return undefined;
    },
    async execute({ tx, workspaceId, actor }) {
      // openokr:allow-mutation: the calling Operation's own transaction.
      const [row] = await tx
        .insert(documents)
        .values({
          workspaceId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          title: input.title.trim(),
          body: (input.body ?? null) as never,
          bodyVersion:
            input.body === undefined || input.body === null
              ? null
              : RICH_TEXT_SCHEMA_VERSION,
          state: "draft",
          authorMemberId: requireMemberId(actor.memberId),
        })
        .returning({ id: documents.id });
      if (!row) {
        throw new Error("The document insert returned no row.");
      }

      return {
        result: { id: row.id },
        // No notification and no feed entry. A draft nobody else can read must
        // not appear in anybody's feed: an entry for something the reader
        // cannot open is a leak with extra steps (design §4.2). The activity
        // row is the author's own record that they started one.
        activity: {
          kind: "document.drafted",
          subjectType: "document",
          subjectId: row.id,
          payload: { title: input.title.trim() },
        },
        audit: {
          action: "documents.create",
          targetType: "document",
          targetId: row.id,
          payload: { subjectType: input.subjectType },
        },
      };
    },
  }),
});

export const updateDocument = defineWriteAction({
  name: "documents.update",
  summary:
    "Edits a document. Editing a published one changes it without publishing a version.",
  input: z
    .object({
      id: z.uuid(),
      title: z.string().trim().min(1).max(300).optional(),
      body: richText.optional(),
    })
    .refine((value) => Object.keys(value).length > 1, {
      message: "an update has to change something",
    }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireWritable(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
      );
    },
    async execute({ tx, workspaceId }) {
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(documents)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined
            ? {}
            : {
                body: input.body as never,
                bodyVersion:
                  input.body === null ? null : RICH_TEXT_SCHEMA_VERSION,
              }),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            documents,
            eq(documents.workspaceId, workspaceId),
            eq(documents.id, input.id),
          ),
        );
      return {
        result: { id: input.id },
        activity: {
          kind: "document.edited",
          subjectType: "document",
          subjectId: input.id,
          payload: {},
        },
        audit: {
          action: "documents.update",
          targetType: "document",
          targetId: input.id,
        },
      };
    },
  }),
});

interface WritableDocument {
  readonly subjectType: DocumentSubjectType;
  readonly subjectId: string;
  readonly title: string;
  readonly body: unknown;
  readonly state: "draft" | "published";
  readonly authorMemberId: string;
}

/**
 * The document this member may change, or not-found.
 *
 * A draft is its author's alone to change; a published one is the subject's, so
 * anybody with edit on the subject may work on it. Both refusals are not-found.
 */
async function requireWritable(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  id: string,
): Promise<WritableDocument> {
  const [row] = await tx
    .select({
      subjectType: documents.subjectType,
      subjectId: documents.subjectId,
      title: documents.title,
      body: documents.body,
      state: documents.state,
      authorMemberId: documents.authorMemberId,
    })
    .from(documents)
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
  await requireSubject(
    tx,
    workspaceId,
    memberId,
    row.subjectType,
    row.subjectId,
    ACCESS_LEVELS.edit,
  );
  return row;
}

export const publishDocument = defineWriteAction({
  name: "documents.publish",
  summary:
    "Publishes a document, writing a version and telling the subject's watchers.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), version: z.number().int() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireWritable(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
      );
    },
    async execute({ tx, workspaceId, actor, loaded }) {
      const rows = await tx
        .select({
          highest: sql<number | null>`max(${documentVersions.version})`,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.workspaceId, workspaceId),
            eq(documentVersions.documentId, input.id),
          ),
        );
      const version = (rows[0]?.highest ?? 0) + 1;
      const now = new Date();

      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx.insert(documentVersions).values({
        workspaceId,
        documentId: input.id,
        version,
        title: loaded.title,
        body: loaded.body as never,
        bodyVersion:
          loaded.body === null || loaded.body === undefined
            ? null
            : RICH_TEXT_SCHEMA_VERSION,
        authorMemberId: requireMemberId(actor.memberId),
      });

      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(documents)
        .set({ state: "published", publishedAt: now, updatedAt: now })
        .where(
          activeOnly(
            documents,
            eq(documents.workspaceId, workspaceId),
            eq(documents.id, input.id),
          ),
        );

      // Only now. Everybody watching the subject is told, except whoever
      // published it. The list is ensured first, because a subject nobody has
      // ever commented on has none and `resolveRecipients` answers empty
      // rather than throwing.
      await ensureSubscriptionList(tx, {
        workspaceId,
        subjectType: loaded.subjectType,
        subjectId: loaded.subjectId,
      });
      const recipients = await resolveRecipients(tx, {
        workspaceId,
        subjectType: loaded.subjectType,
        subjectId: loaded.subjectId,
        ...(actor.memberId ? { excludeMemberId: actor.memberId } : {}),
      });
      if (recipients.length > 0) {
        await notifyRecipients(tx, {
          workspaceId,
          subjectType: loaded.subjectType,
          subjectId: loaded.subjectId,
          recipients,
        });
      }

      return {
        result: { id: input.id, version },
        activity: {
          kind: "document.published",
          subjectType: "document",
          subjectId: input.id,
          payload: { title: loaded.title, version },
        },
        audit: {
          action: "documents.publish",
          targetType: "document",
          targetId: input.id,
          payload: { version },
        },
      };
    },
  }),
});

export const deleteDocument = defineWriteAction({
  name: "documents.delete",
  summary: "Soft-deletes a document and the versions under it.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return requireWritable(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.id,
      );
    },
    async execute({ tx, workspaceId, loaded }) {
      const now = new Date();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(documents)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          activeOnly(
            documents,
            eq(documents.workspaceId, workspaceId),
            eq(documents.id, input.id),
          ),
        );
      return {
        result: { id: input.id },
        activity: {
          kind: "document.deleted",
          subjectType: "document",
          subjectId: input.id,
          payload: { title: loaded.title },
        },
        audit: {
          action: "documents.delete",
          targetType: "document",
          targetId: input.id,
          payload: { title: loaded.title },
        },
      };
    },
  }),
});

// ── Attachments ───────────────────────────────────────────────────────

const attachmentSubject = z.enum(ATTACHMENT_SUBJECT_TYPES);

export const listAttachments = defineReadAction({
  name: "attachments.list",
  summary: "The files attached to one subject.",
  input: z.object({ subjectType: attachmentSubject, subjectId: z.uuid() }),
  output: z.array(
    z.object({
      id: z.uuid(),
      blobId: z.uuid(),
      filename: z.string(),
      contentType: z.string(),
      filesize: z.number().nullable(),
      position: z.number().int(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      return [];
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        await requireAttachmentSubject(
          tx,
          context.workspaceId,
          memberId,
          input.subjectType,
          input.subjectId,
        );

        const rows = await tx
          .select({
            id: attachments.id,
            blobId: attachments.blobId,
            filename: blobs.filename,
            contentType: blobs.contentType,
            filesize: blobs.filesize,
            position: attachments.position,
          })
          .from(attachments)
          .innerJoin(blobs, eq(blobs.id, attachments.blobId))
          .where(
            activeOnly(
              attachments,
              eq(attachments.workspaceId, context.workspaceId),
              eq(attachments.subjectType, input.subjectType),
              eq(attachments.subjectId, input.subjectId),
            ),
          )
          .orderBy(asc(attachments.position));

        return rows.map((row) => ({
          ...row,
          filesize: row.filesize === null ? null : Number(row.filesize),
        }));
      },
    );
  },
});

/**
 * Refuses unless this member may reach the subject a file is being hung on.
 *
 * Wider than `requireSubject` because attachments go on more things. A task and
 * a document resolve through their own contexts; a check-in through its goal.
 */
async function requireAttachmentSubject(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  kind: (typeof ATTACHMENT_SUBJECT_TYPES)[number],
  subjectId: string,
  requires: number = ACCESS_LEVELS.view,
): Promise<void> {
  if (kind === "task") {
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "task",
      resourceId: subjectId,
      requires: requires as never,
    });
    return;
  }
  if (kind === "document") {
    await loadReadable(tx, workspaceId, memberId, subjectId);
    return;
  }
  if (kind === "check_in") {
    const rows = await tx.execute<{ subject_id: string }>(
      sql`select subject_id from check_ins
           where id = ${subjectId}
             and workspace_id = ${workspaceId}
             and deleted_at is null
           limit 1`,
    );
    const goalId = rows.rows[0]?.subject_id;
    if (!goalId) {
      throw new OperationError("not_found", "No such check-in.");
    }
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "goal",
      resourceId: goalId,
      requires: requires as never,
    });
    return;
  }
  await requireSubject(
    tx,
    workspaceId,
    memberId,
    kind as DocumentSubjectType,
    subjectId,
    requires,
  );
}

export const attachFile = defineWriteAction({
  name: "attachments.attach",
  summary: "Hangs an uploaded file on a subject.",
  input: z.object({
    subjectType: attachmentSubject,
    subjectId: z.uuid(),
    blobId: z.uuid(),
  }),
  output: z.object({ id: z.uuid(), attached: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      await requireAttachmentSubject(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        input.subjectType,
        input.subjectId,
        ACCESS_LEVELS.edit,
      );
      // And the file itself: attaching is a way of showing somebody a blob, so
      // the person doing it has to be able to read it.
      await getAccessScoped(tx, {
        workspaceId,
        memberId: requireMemberId(actor.memberId),
        resourceType: "blob",
        resourceId: input.blobId,
      });
      return undefined;
    },
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          activeOnly(
            attachments,
            eq(attachments.workspaceId, workspaceId),
            eq(attachments.subjectType, input.subjectType),
            eq(attachments.subjectId, input.subjectId),
            eq(attachments.blobId, input.blobId),
          ),
        )
        .limit(1);
      if (existing) {
        // The same decision made twice.
        return {
          result: { id: existing.id, attached: false },
          activity: {
            kind: "attachment.added",
            subjectType: "document",
            subjectId: input.subjectId,
            payload: { duplicate: true },
          },
          audit: {
            action: "attachments.attach",
            targetType: input.subjectType,
            targetId: input.subjectId,
          },
        };
      }

      const [last] = await tx
        .select({ highest: sql<number | null>`max(${attachments.position})` })
        .from(attachments)
        .where(
          activeOnly(
            attachments,
            eq(attachments.workspaceId, workspaceId),
            eq(attachments.subjectType, input.subjectType),
            eq(attachments.subjectId, input.subjectId),
          ),
        );

      // openokr:allow-mutation: the calling Operation's own transaction.
      const [row] = await tx
        .insert(attachments)
        .values({
          workspaceId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          blobId: input.blobId,
          position: (last?.highest ?? 0) + 1,
        })
        .returning({ id: attachments.id });
      if (!row) {
        throw new Error("The attachment insert returned no row.");
      }

      return {
        result: { id: row.id, attached: true },
        activity: {
          kind: "attachment.added",
          subjectType: "document",
          subjectId: input.subjectId,
          payload: { duplicate: false },
        },
        audit: {
          action: "attachments.attach",
          targetType: input.subjectType,
          targetId: input.subjectId,
          payload: { blobId: input.blobId },
        },
      };
    },
  }),
});

export const detachFile = defineWriteAction({
  name: "attachments.detach",
  summary: "Takes a file off a subject. The file itself is untouched.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      const [row] = await tx
        .select({
          subjectType: attachments.subjectType,
          subjectId: attachments.subjectId,
        })
        .from(attachments)
        .where(
          activeOnly(
            attachments,
            eq(attachments.workspaceId, workspaceId),
            eq(attachments.id, input.id),
          ),
        )
        .limit(1);
      if (!row) {
        throw new OperationError("not_found", "No such attachment.");
      }
      await requireAttachmentSubject(
        tx,
        workspaceId,
        requireMemberId(actor.memberId),
        row.subjectType,
        row.subjectId,
        ACCESS_LEVELS.edit,
      );
      return row;
    },
    async execute({ tx, workspaceId, loaded }) {
      const now = new Date();
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(attachments)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          activeOnly(
            attachments,
            eq(attachments.workspaceId, workspaceId),
            eq(attachments.id, input.id),
          ),
        );
      return {
        result: { id: input.id },
        activity: {
          kind: "attachment.removed",
          subjectType: "document",
          subjectId: loaded.subjectId,
          payload: {},
        },
        audit: {
          action: "attachments.detach",
          targetType: loaded.subjectType,
          targetId: loaded.subjectId,
        },
      };
    },
  }),
});
