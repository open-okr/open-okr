"use server";

/**
 * The FlowyTeam card's presses (docs/design/flowyteam-connect.md §4.5, C5).
 *
 * Each one is a registry action and nothing more: the preview and the import
 * queue a background job and answer with its run, disconnecting closes the
 * connection, and inviting calls `invitations.createPersonalLink` once per
 * person the admin ticked. Nothing here sends an invitation the admin did not
 * choose (Q6, AC 9).
 *
 * A refusal comes back as its `reason` word and the sentence for it in the
 * reader's language, so the card can both say it and change state on it
 * (`revoked` offers Connect again).
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { flowyteamReasonKey } from "../../../lib/flowyteam-messages";
import { refusalFields } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";

export type FlowyteamAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly message: string };

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

function reasonOf(error: unknown): string {
  if (error instanceof OperationError) {
    const reason = error.details?.reason;
    return typeof reason === "string" ? reason : error.code;
  }
  return "error";
}

async function refused(
  error: unknown,
): Promise<{ ok: false; reason: string; message: string }> {
  const { t } = await getTranslations();
  return {
    ok: false,
    reason: reasonOf(error),
    message: t(flowyteamReasonKey(reasonOf(error))),
  };
}

export async function previewFlowyteamAction(): Promise<
  FlowyteamAnswer<{ runId: string }>
> {
  try {
    const answer = await callAction(
      await context(),
      "imports.flowyteamPreview",
      {},
    );
    revalidatePath("/admin/imports");
    return { ok: true, value: { runId: answer.runId } };
  } catch (error) {
    return refused(error);
  }
}

export async function runFlowyteamAction(
  acceptBroaderVisibility: boolean,
): Promise<FlowyteamAnswer<{ runId: string }>> {
  try {
    const answer = await callAction(await context(), "imports.flowyteamRun", {
      acceptBroaderVisibility: acceptBroaderVisibility === true,
    });
    revalidatePath("/admin/imports");
    return { ok: true, value: { runId: answer.runId } };
  } catch (error) {
    return refused(error);
  }
}

export async function disconnectFlowyteamAction(): Promise<
  FlowyteamAnswer<null>
> {
  try {
    await callAction(await context(), "imports.flowyteamDisconnect", {});
    revalidatePath("/admin/imports");
    return { ok: true, value: null };
  } catch (error) {
    return refused(error);
  }
}

export interface InviteOutcome {
  readonly sent: number;
  /** Each address that was refused, with the sentence why. */
  readonly failed: readonly { email: string; message: string }[];
}

/**
 * Invites the chosen people, one personal invitation each.
 *
 * The addresses are read again here from `imports.flowyteamPeople`, so the
 * browser names members and never an address of its choosing: a request can
 * only invite somebody the import brought across. One refusal (a full plan,
 * say) does not stop the rest, and the answer names each one.
 */
export async function inviteFlowyteamPeopleAction(
  memberIds: readonly string[],
): Promise<FlowyteamAnswer<InviteOutcome>> {
  const { t } = await getTranslations();
  try {
    const ctx = await context();
    const wanted = new Set(memberIds);
    const { people } = await callAction(ctx, "imports.flowyteamPeople", {});
    let sent = 0;
    const failed: { email: string; message: string }[] = [];
    for (const person of people) {
      if (!wanted.has(person.memberId) || person.invited) {
        continue;
      }
      try {
        await callAction(ctx, "invitations.createPersonalLink", {
          email: person.email,
        });
        sent += 1;
      } catch (error) {
        const fields = refusalFields(error, t);
        failed.push({
          email: person.email,
          message: fields?.message ?? t("admin.imports.flowyteam.reason.error"),
        });
      }
    }
    revalidatePath("/admin/imports");
    revalidatePath("/admin/invitations");
    return { ok: true, value: { sent, failed } };
  } catch (error) {
    return refused(error);
  }
}
