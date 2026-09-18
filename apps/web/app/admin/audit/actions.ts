"use server";

import {
  AUDIT_EXPORT_CEILING,
  callAction,
  OperationError,
} from "@openokr/core";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * The two audit actions, reached from the admin screen (P8-T10).
 *
 * Server actions rather than bespoke REST routes, so both go through the
 * action registry that declares what they need and records what they did. The
 * screen supplies a filter and gets back a verdict or a file; neither the
 * query nor the access level is decided here.
 */

async function actionContext() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

export interface ChainResult {
  readonly ok: boolean;
  readonly checked: number;
  readonly pending: number;
  readonly brokenAtSeq: number | null;
  readonly reason: string | null;
  /** Set when the check could not run at all, rather than ran and failed. */
  readonly error?: string;
}

/** Checks the chain and says where it breaks, if it does. */
export async function verifyChain(): Promise<ChainResult> {
  try {
    return await callAction(await actionContext(), "audit.verify", {});
  } catch (error) {
    return {
      ok: false,
      checked: 0,
      pending: 0,
      brokenAtSeq: null,
      reason: null,
      error:
        error instanceof OperationError
          ? error.message
          : "The chain could not be checked.",
    };
  }
}

export interface AuditExportRequest {
  readonly from?: string;
  readonly to?: string;
  readonly action?: string;
  readonly targetType?: string;
}

export interface AuditExportResult {
  readonly filename?: string;
  readonly csv?: string;
  readonly rowCount?: number;
  readonly truncated?: boolean;
  readonly error?: string;
}

/**
 * Takes the trail out as a file.
 *
 * A date arrives from the form as `YYYY-MM-DD` and the action wants an
 * instant, so the start of the day and the end of it are filled in here. The
 * end is inclusive: somebody asking for "to the 31st" means the whole of the
 * 31st, and a range that quietly stopped at midnight would drop a day's rows
 * without saying so.
 */
export async function exportAudit(
  request: AuditExportRequest,
): Promise<AuditExportResult> {
  try {
    const result = await callAction(await actionContext(), "audit.export", {
      limit: AUDIT_EXPORT_CEILING,
      ...(request.from ? { from: `${request.from}T00:00:00.000Z` } : {}),
      ...(request.to ? { to: `${request.to}T23:59:59.999Z` } : {}),
      ...(request.action ? { action: request.action } : {}),
      ...(request.targetType ? { targetType: request.targetType } : {}),
    });
    return {
      filename: result.filename,
      csv: result.csv,
      rowCount: result.rowCount,
      truncated: result.truncated,
    };
  } catch (error) {
    return {
      error:
        error instanceof OperationError
          ? error.message
          : "The export could not be built.",
    };
  }
}
