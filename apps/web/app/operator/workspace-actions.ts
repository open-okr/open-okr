"use server";

import { createWorkspaceAsOperator } from "@openokr/core";
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
