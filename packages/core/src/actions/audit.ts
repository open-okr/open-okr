/**
 * The audit trail as something an administrator can use (P8-T10).
 *
 * The trail has been written since P1-T07 and hash-chained since P7-T02a, and
 * until now the only way to read either was a command line on the server.
 * That is the wrong place for it: the person who has to answer an auditor is
 * a workspace administrator in a browser, not whoever holds a shell.
 *
 * Two actions, and they are deliberately of different kinds.
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
 * Both are `full`. The trail names every actor and every change, and the
 * payloads carry the detail; that is an administrator's to read, and the same
 * argument `workspace.exportArchive` settled for the archive.
 */
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
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
