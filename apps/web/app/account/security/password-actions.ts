"use server";

import { setOwnPassword } from "@openokr/core";
import { headers } from "next/headers";
import { getAuth, getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";

/**
 * Set a password, for an account that has none (docs/design/
 * account-self-service.md D12, plan 0.8.0 Y3).
 *
 * A server action because Better Auth's `setPassword` is server only: no
 * browser can call it, so only this code gives an account its first
 * password while signed in. The refusals, the recent sign-in and the record
 * are all `setOwnPassword`'s; this only puts them in the person's language.
 *
 * Changing a password that exists is not here. The card calls Better Auth's
 * `/change-password` from the browser, which is guarded in `createAuth`.
 */
export interface SetPasswordResult {
  readonly ok: boolean;
  readonly message: string;
  /** The field the message is about, when it is about one. */
  readonly field?: "newPassword" | "again";
}

export async function setPassword(
  _previous: SetPasswordResult | null,
  form: FormData,
): Promise<SetPasswordResult> {
  const { t } = await getTranslations();
  const newPassword = String(form.get("newPassword") ?? "");
  if (newPassword !== String(form.get("again") ?? "")) {
    return {
      ok: false,
      message: t("account.security.password.notTheSame"),
      field: "again",
    };
  }
  const outcome = await setOwnPassword(getAuth(), getPool(), {
    headers: new Headers(await headers()),
    newPassword,
  });
  if (outcome.ok) {
    const provider = outcome.providers[0]?.displayName;
    return {
      ok: true,
      message: provider
        ? t("account.security.password.setDone", { provider })
        : t("account.security.password.setDoneNoProvider"),
    };
  }
  switch (outcome.reason) {
    case "too_short":
      return {
        ok: false,
        message: t("account.security.password.tooShort"),
        field: "newPassword",
      };
    case "too_long":
      return {
        ok: false,
        message: t("account.security.password.tooLong"),
        field: "newPassword",
      };
    case "not_recent":
      return {
        ok: false,
        message: t("account.security.password.signInAgainFirst"),
      };
    case "demo":
      return { ok: false, message: t("account.security.password.demo") };
    case "enforced":
      return { ok: false, message: outcome.message ?? "" };
    default:
      // Signed out, or a password set meanwhile in another tab: reloading
      // shows the card for what the account is now.
      return { ok: false, message: t("account.security.password.notSet") };
  }
}
