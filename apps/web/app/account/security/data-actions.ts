"use server";

import { callAction, OperationError } from "@openokr/core";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * A copy of what this workspace holds about the signed-in member
 * (completeness review M-18). The document is built on the server and handed
 * back to the page, which saves it; nothing is written anywhere.
 */
export interface DataExportResult {
  readonly json?: string;
  readonly error?: string;
}

export async function exportMyData(): Promise<DataExportResult> {
  const { session, workspace } = await requireWorkspace();
  try {
    const data = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "people.exportMine",
      {},
    );
    return { json: JSON.stringify(data, null, 2) };
  } catch (error) {
    if (error instanceof OperationError) {
      const { t } = await getTranslations();
      return { error: t("account.security.data.failed") };
    }
    throw error;
  }
}
