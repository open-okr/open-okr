"use server";

import {
  adoptWorkspacesAsOperator,
  createWorkspaceAsOperator,
  OperationError,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../lib/operator";
import { getPool } from "../../lib/pool";
import { refusedState } from "../../lib/refusal";
import { getTranslations } from "../../lib/translations";

/**
 * An operator creates a workspace on S-45 (docs/design/hosting-profiles.md §3).
 *
 * The grant is checked here and again at the domain door, as the other console
 * forms do. A refusal comes back as a sentence, so a mistyped address is corrected
 * on the form rather than read off an error page.
 */
export interface NewWorkspaceState {
  readonly error?: string;
  /** A refused field's message, shown under it (guided-inputs §4.2). */
  readonly fields?: Readonly<Record<string, string>>;
  readonly done?: string;
}

export async function createWorkspace(
  formData: FormData,
): Promise<NewWorkspaceState> {
  const operator = await requireOperator();
  const { t } = await getTranslations();
  const ownerEmail = String(formData.get("ownerEmail") ?? "");
  try {
    const created = await createWorkspaceAsOperator(getPool(), {
      operatorUserId: operator.userId,
      name: String(formData.get("name") ?? ""),
      ownerEmail,
    });
    revalidatePath("/operator");
    return {
      done: created.ownerHadAccount
        ? t("operator.newWorkspace.createdOwner", { email: ownerEmail })
        : t("operator.newWorkspace.createdInvited", { email: ownerEmail }),
    };
  } catch (error) {
    const refused = refusedState(error, t, ["name", "ownerEmail"]);
    if (refused === null) {
      throw error;
    }
    return refused;
  }
}

/**
 * Adopt now, on S-45 (Q-9, plan 0.8.1): the workspaces made before this
 * instance became a cloud, adopted on the operator's word rather than at the
 * next hourly run. The same adopt as `pnpm cloud:adopt`; the grant is checked
 * here and again at the domain door, which also writes the instance audit row.
 */
export interface AdoptState {
  readonly error?: string;
  readonly done?: string;
}

export async function adoptWaitingWorkspaces(): Promise<AdoptState> {
  const operator = await requireOperator();
  const { t } = await getTranslations();
  try {
    const adopted = await adoptWorkspacesAsOperator(getPool(), {
      operatorUserId: operator.userId,
    });
    revalidatePath("/operator");
    return {
      done:
        adopted === 0
          ? t("operator.workspaces.adoptedNone")
          : adopted === 1
            ? t("operator.workspaces.adoptedOne")
            : t("operator.workspaces.adoptedOther", { count: adopted }),
    };
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
}
