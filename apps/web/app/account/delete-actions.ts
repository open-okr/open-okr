"use server";

import { requestOwnDeletion } from "@openokr/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, getPool } from "../../lib/auth";
import { getTranslations } from "../../lib/translations";

/**
 * Delete your own account (screen S-51, docs/design/account-deletion.md §3.1,
 * plan 0.8.0 Y7).
 *
 * **The only way in** (Y7-Q2): an account action, not a registry action, so
 * no token, command line or agent can reach it. `requestOwnDeletion` holds
 * every refusal, the password check and the one transaction that stores the
 * request and ends every session. This puts the outcome in the person's
 * language, clears the cookie the ended session left, and sends the browser
 * to sign-in with the date.
 */
export interface DeletionResult {
  readonly message: string;
  /** The field the message is about, when it is about one. */
  readonly field?: "password";
  /** A held password check, in whole minutes (account-lockout.md D12). */
  readonly heldMinutes?: number;
}

export async function requestDeletion(
  _previous: DeletionResult | null,
  form: FormData,
): Promise<DeletionResult> {
  const { t } = await getTranslations();
  const requestHeaders = new Headers(await headers());
  const outcome = await requestOwnDeletion(getAuth(), getPool(), {
    headers: requestHeaders,
    password: String(form.get("password") ?? ""),
  });
  if (outcome.ok) {
    // The session row is gone already; this clears the cookie it left. A
    // failure here changes nothing the request did.
    await getAuth()
      .api.signOut({ headers: requestHeaders })
      .catch(() => undefined);
    const on = outcome.runsAt.toISOString().slice(0, 10);
    redirect(`/sign-in?notice=deletion&on=${on}`);
  }
  switch (outcome.reason) {
    case "demo":
      return { message: t("account.delete.demo") };
    case "directory":
      return { message: t("account.delete.directory") };
    case "last_owner":
      return {
        message: t("account.delete.lastOwner", {
          workspace: outcome.workspaceName,
        }),
      };
    case "wrong_password":
      return {
        message: t("account.security.securitySettings.passwordNotRight"),
        field: "password",
      };
    case "held":
      return {
        message: "",
        heldMinutes: Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60)),
      };
    case "not_recent":
      return { message: t("account.delete.signInAgainFirst") };
    default:
      // Signed out meanwhile: reloading shows sign-in.
      return { message: t("account.delete.notDeleted") };
  }
}
