/**
 * The audit trail as something an administrator can use (P8-T10).
 *
 * The trail has been written since P1-T07 and hash-chained since P7-T02a, and
 * until now the only way to read either was a command line on the server.
 * That is the wrong place for it: the person who has to answer an auditor is
 * a workspace administrator in a browser, not whoever holds a shell.
 *
 * Three actions. The third, `audit.list`, is the trail read a page at a time
 * (completeness review L-19): the first two could check it and take it away,
 * and nothing could simply show it. It is a read like the verification, for
 * the same reason, and it hands over less than the export does.
 *
 * The first two are deliberately of different kinds.
 *
 * **The export is a write**, because taking a copy of who did what is an act
 * worth recording. It writes its own audit row, which means the trail records
 * that it was exported, by whom, and with what filter. An auditor reading the
 * file will find the export itself at the end of it.
 *
 * **The verification is a read**, and that is not laziness. `runOperation`
 * refuses every write on a workspace that is not active, and a frozen or
 * suspended workspace is exactly when somebody needs to ask whether the trail
 * is intact. A verification that could not run on a frozen workspace would be
 * missing at the only moment it matters.
 *
 * All three are `full`. The trail names every actor and every change, and the
 * payloads carry the detail; that is an administrator's to read, and the same
 * argument `workspace.exportArchive` settled for the archive.
 */
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { listAuditRows } from "../audit/browse.ts";
import {
  auditCsvFile,
  auditExportFilename,
  exportAuditRows,
} from "../audit/export.ts";
import { verifyWorkspaceChain } from "../audit/verify.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/**
 * How many rows one export carries.
 *
 * A ceiling rather than a page, and a generous one: an auditor's question is
 * usually a quarter of one workspace, and a file that stopped at a hundred
 * rows would send them back to the shell this action exists to replace. The
 * answer says when it truncated, so a larger question narrows its filter
 * rather than silently losing its tail.
 */
export const AUDIT_EXPORT_CEILING = 10_000;

const auditFilter = {
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  action: z.string().trim().min(1).max(120).optional(),
  actorMemberId: z.uuid().optional(),
  targetType: z.string().trim().min(1).max(60).optional(),
  targetId: z.uuid().optional(),
};

export const exportAudit = defineWriteAction({
  name: "audit.export",
  summary:
    "Exports the audit trail as a CSV file, narrowed by date, action, actor or target. Audited.",
  input: z.object({
    ...auditFilter,
    limit: z
      .number()
      .int()
      .positive()
      .max(AUDIT_EXPORT_CEILING)
      .default(AUDIT_EXPORT_CEILING),
  }),
  output: z.object({
    filename: z.string(),
    csv: z.string(),
    rowCount: z.number().int(),
    /** True when the filter matched more rows than the ceiling allowed. */
    truncated: z.boolean(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    requires: ACCESS_LEVELS.full,
    async execute({ workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError(
          "forbidden",
          "An audit export belongs to the member who asked for it.",
        );
      }
      if (input.from && input.to && input.from > input.to) {
        throw new OperationError(
          "forbidden",
          "The end of the range is before its start.",
        );
      }

      // **On the pool rather than on the Operation's transaction**, because
      // the rows being read are the ones this very Operation is about to
      // append to. Reading them inside the writing transaction would be
      // reading a trail mid-write; reading them beside it takes the trail as
      // it stood when the export was asked for, which is what a file dated by
      // its filename should hold. Both go through the tenant floor.
      const taken = await exportAuditRows(context.pool, workspaceId, {
        ...(input.from ? { from: new Date(input.from) } : {}),
        ...(input.to ? { to: new Date(input.to) } : {}),
        ...(input.action ? { action: input.action } : {}),
        ...(input.actorMemberId ? { actorMemberId: input.actorMemberId } : {}),
        ...(input.targetType ? { targetType: input.targetType } : {}),
        ...(input.targetId ? { targetId: input.targetId } : {}),
        limit: input.limit,
      });

      const filename = auditExportFilename(new Date());

      return {
        result: {
          filename,
          csv: auditCsvFile(taken.rows),
          rowCount: taken.rows.length,
          truncated: taken.truncated,
        },
        activity: {
          kind: "export.taken",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { list: "audit", rowCount: taken.rows.length },
        },
        audit: {
          action: "audit.export",
          targetType: "workspace",
          targetId: workspaceId,
          // The filter is on the row, because "who exported the trail" is
          // half the question and "what did they take" is the other half.
          payload: {
            rowCount: taken.rows.length,
            truncated: taken.truncated,
            ...(input.from ? { from: input.from } : {}),
            ...(input.to ? { to: input.to } : {}),
            ...(input.action ? { action: input.action } : {}),
            ...(input.actorMemberId
              ? { actorMemberId: input.actorMemberId }
              : {}),
            ...(input.targetType ? { targetType: input.targetType } : {}),
            ...(input.targetId ? { targetId: input.targetId } : {}),
          },
        },
      };
    },
  }),
});

/**
 * How many rows one page of the screen shows, and the most a caller may ask
 * for.
 *
 * Fifty is a screenful an administrator can scan. The ceiling is a page, not
 * a file: somebody who wants thousands of rows wants the export, which says
 * when it stopped and records that it was taken.
 */
const AUDIT_PAGE_SIZE = 50;
const AUDIT_PAGE_CEILING = 200;

const auditListRow = z.object({
  id: z.uuid(),
  /** The row's position in the chain. Null while it waits for one. */
  seq: z.number().int().nullable(),
  at: z.string(),
  actorKind: z.enum(["human", "agent", "system", "operator"]),
  actorMemberId: z.uuid().nullable(),
  actorOperatorUserId: z.string().nullable(),
  /** Where the write came from, when it was not the browser. */
  channel: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.uuid().nullable(),
  /** True once the chainer has given the row its position and hash. */
  chained: z.boolean(),
});

export const listAudit = defineReadAction({
  name: "audit.list",
  summary:
    "The audit trail a page at a time, newest first, narrowed by date, action, actor or target. Payloads stay out; the export carries them.",
  input: z.object({
    ...auditFilter,
    /**
     * The last row of the page before. Absent means the newest page.
     *
     * Optional rather than defaulted, like `limit` below: a `default` on a
     * read action's input makes the field required in the inferred handler
     * type, so the screen would have to pass it on the first page.
     */
    cursor: z
      .object({ at: z.iso.datetime({ offset: true }), id: z.uuid() })
      .optional(),
    limit: z.number().int().min(1).max(AUDIT_PAGE_CEILING).optional(),
  }),
  output: z.object({
    rows: z.array(auditListRow),
    /** True when older rows match the same filter. */
    more: z.boolean(),
  }),
  access: ACCESS_LEVELS.full,
  page: { cursorFrom: ["at", "id"], itemsAt: "rows" },
  async handler({ pool, workspaceId }, input) {
    // Compared as instants rather than as strings, because an offset is
    // allowed and "10:00+08:00" is earlier than "09:00Z".
    if (
      input.from &&
      input.to &&
      new Date(input.from).getTime() > new Date(input.to).getTime()
    ) {
      // The export's own refusal, word for word, so the screen says one thing
      // whichever of the two buttons was pressed.
      throw new OperationError(
        "forbidden",
        "The end of the range is before its start.",
      );
    }

    const page = await listAuditRows(
      pool,
      workspaceId,
      {
        ...(input.from ? { from: new Date(input.from) } : {}),
        ...(input.to ? { to: new Date(input.to) } : {}),
        ...(input.action ? { action: input.action } : {}),
        ...(input.actorMemberId ? { actorMemberId: input.actorMemberId } : {}),
        ...(input.targetType ? { targetType: input.targetType } : {}),
        ...(input.targetId ? { targetId: input.targetId } : {}),
      },
      {
        ...(input.cursor
          ? {
              cursor: { at: new Date(input.cursor.at), id: input.cursor.id },
            }
          : {}),
        limit: input.limit ?? AUDIT_PAGE_SIZE,
      },
    );

    return {
      rows: page.rows.map((row) => ({
        id: row.id,
        seq: row.seq,
        at: row.at.toISOString(),
        actorKind: row.actorKind,
        actorMemberId: row.actorMemberId,
        actorOperatorUserId: row.actorOperatorUserId,
        channel: row.channel,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        chained: row.seq !== null,
      })),
      more: page.more,
    };
  },
});

export const verifyAudit = defineReadAction({
  name: "audit.verify",
  summary:
    "Checks the workspace's audit chain and says where it breaks, if it does.",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    /** Rows whose hashes and links were checked. */
    checked: z.number().int(),
    /** Rows recorded and not yet given a position. Never counted as checked. */
    pending: z.number().int(),
    /** The first position that did not add up. */
    brokenAtSeq: z.number().int().nullable(),
    reason: z.string().nullable(),
  }),
  access: ACCESS_LEVELS.full,
  async handler({ pool, workspaceId }) {
    const verdict = await verifyWorkspaceChain(pool, workspaceId);
    return {
      ok: verdict.ok,
      checked: verdict.checked,
      pending: verdict.pending,
      brokenAtSeq: verdict.brokenAtSeq ?? null,
      reason: verdict.reason ?? null,
    };
  },
});
