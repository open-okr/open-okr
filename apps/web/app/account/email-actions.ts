"use server";

import { authLimiterStorage, changeOwnEmail } from "@openokr/core";
import { headers } from "next/headers";
import { getAuth, getPool } from "../../lib/auth";
import { getCache } from "../../lib/cache";
import { getTranslations } from "../../lib/translations";

/**
 * Change your sign-in email (screen S-51, docs/design/account-self-service.md
 * D14 to D17, plan 0.8.0 Y4).
 *
 * **The only way in.** `/change-email` answers 404 over HTTP, so this server
 * action is what reaches Better Auth's change, through `changeOwnEmail`,
 * which holds every refusal, the password check, the daily limits and the
 * answer's floor. This only puts the outcome in the person's language.
 *
 * Both limits are counted in the Postgres cache, so every replica shares
 * them, as the sign-in limiter's are.
 */
export interface EmailChangeResult {
  readonly ok: boolean;
  readonly message: string;
  /** The field the message is about, when it is about one. */
  readonly field?: "newEmail" | "password";
  /**
   * A held password check, in whole minutes, kept apart because its sentence
   * ends in a link to the reset page (account-lockout.md D12).
   */
  readonly heldMinutes?: number;
}

export async function changeEmail(
  _previous: EmailChangeResult | null,
  form: FormData,
): Promise<EmailChangeResult> {
  const { t } = await getTranslations();
  const outcome = await changeOwnEmail(getAuth(), getPool(), {
    headers: new Headers(await headers()),
    newEmail: String(form.get("newEmail") ?? ""),
    password: String(form.get("password") ?? ""),
    limits: authLimiterStorage(getCache()),
  });
  if (outcome.ok) {
    return {
      ok: true,
      message: t("account.email.accepted", {
        to: outcome.to,
        hours: outcome.hours,
        current: outcome.current,
      }),
    };
  }
  switch (outcome.reason) {
    case "no_mail":
      return { ok: false, message: t("account.email.noMail") };
    case "demo":
      return { ok: false, message: t("account.email.demo") };
    case "directory":
      return { ok: false, message: t("account.email.directory") };
    case "enforced":
      return {
        ok: false,
        message: t("account.email.enforced", {
          provider: outcome.provider,
          domain: outcome.domain,
        }),
      };
    case "invalid":
      return {
        ok: false,
        message: t("fields.email.invalid"),
        field: "newEmail",
      };
    case "same":
      return { ok: false, message: t("account.email.same"), field: "newEmail" };
    case "company":
      return {
        ok: false,
        message: t("account.email.companyOnly"),
        field: "newEmail",
      };
    case "wrong_password":
      return {
        ok: false,
        message: t("account.security.securitySettings.passwordNotRight"),
        field: "password",
      };
    case "held":
      return {
        ok: false,
        message: "",
        heldMinutes: Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60)),
      };
    case "not_recent":
      return { ok: false, message: t("account.email.signInAgainFirst") };
    case "account_limit":
      return { ok: false, message: t("account.email.accountLimit") };
    case "address_limit":
      return { ok: false, message: t("account.email.addressLimit") };
    default:
      // Signed out meanwhile: reloading shows sign-in.
      return { ok: false, message: t("account.email.notChanged") };
  }
}
