"use server";

import {
  AUDIT_EXPORT_CEILING,
  callAction,
  OperationError,
} from "@openokr/core";
import { localDayBounds } from "@openokr/formats";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * The three audit actions, reached from the admin screen (P8-T10, and
 * completeness review L-19 for the list).
 *
 * Server actions rather than bespoke REST routes, so all three go through the
 * action registry that declares what they need and records what they did. The
 * screen supplies a filter and gets back a verdict, a page of rows or a file;
 * neither the query nor the access level is decided here.
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
  const { t } = await getTranslations();
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
          : t("admin.audit.actions.chainCouldNotBeChecked"),
    };
  }
}

/**
 * One filter, for the list and the file alike.
 *
 * The screen has one form and two buttons, so what somebody browsed is what
 * they take away. Dates arrive as `YYYY-MM-DD` from the form.
 */
export interface AuditFilterRequest {
  readonly from?: string;
  readonly to?: string;
  readonly action?: string;
  readonly actorMemberId?: string;
  readonly targetType?: string;
}

/**
 * The filter as the actions take it.
 *
 * A date arrives from the form as `YYYY-MM-DD` and the actions want an
 * instant, so the start of the day and the end of it are filled in here, in
 * the workspace's timezone: the day the screen lists the rows under. The end
 * is inclusive: somebody asking for "to the 31st" means the whole of the 31st,
 * and a range that quietly stopped at midnight would drop a day's rows
 * without saying so.
 */
async function filterInput(
  context: Awaited<ReturnType<typeof actionContext>>,
  request: AuditFilterRequest,
) {
  const timeZone =
    request.from || request.to
      ? String(
          (await callAction(context, "settings.readForMember", {})).settings
            .timezone ?? "UTC",
        )
      : "UTC";
  return {
    ...(request.from
      ? { from: localDayBounds(request.from, timeZone).start.toISOString() }
      : {}),
    ...(request.to
      ? { to: localDayBounds(request.to, timeZone).end.toISOString() }
      : {}),
    ...(request.action ? { action: request.action } : {}),
    ...(request.actorMemberId ? { actorMemberId: request.actorMemberId } : {}),
    ...(request.targetType ? { targetType: request.targetType } : {}),
  };
}

/** One row of the trail as the screen draws it. Never the payload. */
export interface AuditRow {
  readonly id: string;
  readonly seq: number | null;
  readonly at: string;
  readonly actorKind: "human" | "agent" | "system" | "operator";
  readonly actorMemberId: string | null;
  readonly actorOperatorUserId: string | null;
  readonly channel: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly chained: boolean;
}

export interface AuditPageResult {
  readonly rows?: readonly AuditRow[];
  readonly more?: boolean;
  /**
   * The read was refused. Kept apart from `error` because the screen says a
   * different thing: nothing went wrong, this person may not look.
   */
  readonly denied?: boolean;
  readonly error?: string;
}

/**
 * One page of the trail, newest first.
 *
 * `cursor` is the last row the screen already holds, and absent means the
 * newest page.
 */
export async function browseAudit(
  request: AuditFilterRequest & {
    readonly cursor?: { readonly at: string; readonly id: string };
  },
): Promise<AuditPageResult> {
  const { t } = await getTranslations();
  // Outside the `try`, because a visitor with no session is sent to sign in
  // by a thrown redirect, and catching it here would turn that into an error
  // message on a page they cannot see.
  const context = await actionContext();
  try {
    const page = await callAction(context, "audit.list", {
      ...(await filterInput(context, request)),
      ...(request.cursor ? { cursor: request.cursor } : {}),
    });
    return { rows: page.rows, more: page.more };
  } catch (error) {
    // A read refuses the way the access getter does, with not-found, so a
    // member below `full` and a stranger read the same answer (P6-G31).
    if (error instanceof OperationError && error.code === "not_found") {
      return { denied: true };
    }
    return {
      error:
        error instanceof OperationError
          ? error.message
          : t("admin.audit.actions.trailCouldNotBeRead"),
    };
  }
}

export interface AuditExportResult {
  readonly filename?: string;
  readonly csv?: string;
  readonly rowCount?: number;
  readonly truncated?: boolean;
  readonly error?: string;
}

/** Takes the trail out as a file, narrowed by the same filter as the list. */
export async function exportAudit(
  request: AuditFilterRequest,
): Promise<AuditExportResult> {
  const { t } = await getTranslations();
  try {
    const context = await actionContext();
    const result = await callAction(context, "audit.export", {
      limit: AUDIT_EXPORT_CEILING,
      ...(await filterInput(context, request)),
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
          : t("admin.audit.actions.exportCouldNotBeBuilt"),
    };
  }
}
