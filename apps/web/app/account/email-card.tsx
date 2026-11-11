"use client";

import type { EmailCard as EmailCardState } from "@openokr/core";
import { Button, EmailInput, SecretInput, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { type FormEvent, startTransition, useActionState } from "react";
import { FormError } from "../(auth)/auth-card";
import type { EmailChangeResult } from "./email-actions";
import { SignInAgain } from "./security/password-card";

/**
 * Changing the sign-in email, on Your account (screen S-51, docs/design/
 * account-self-service.md D14 to D17, plan 0.8.0 Y4).
 *
 * **What the card offers is decided on the server**, from the account as it
 * is now: not offered where the instance cannot send mail, and refused with
 * the reason for a demonstration account, a directory-managed one and one
 * single sign-on claims, before any address is typed. Otherwise the new
 * address and, where the account has one, the current password. An account
 * with no password needs a sign-in in the last ten minutes instead, and is
 * offered its identity providers to sign in again with.
 *
 * The answer to an accepted request is the same sentence whether or not the
 * address has an account, so this form cannot be used to find one.
 */
export function EmailCard({
  card,
  action,
}: {
  readonly card: EmailCardState;
  readonly action: (
    previous: EmailChangeResult | null,
    form: FormData,
  ) => Promise<EmailChangeResult>;
}) {
  const { t } = useTranslations();
  switch (card.kind) {
    case "no_mail":
      return <Sentence>{t("account.email.noMail")}</Sentence>;
    case "demo":
      return <Sentence>{t("account.email.demo")}</Sentence>;
    case "directory":
      return <Sentence>{t("account.email.directory")}</Sentence>;
    case "enforced":
      return (
        <Sentence>
          {t("account.email.enforced", {
            provider: card.provider,
            domain: card.domain,
          })}
        </Sentence>
      );
    default:
      return !card.hasPassword && !card.recent ? (
        <div className="flex flex-col items-start gap-3">
          <SignInAgain
            providers={card.providers}
            intro={t("account.email.signInAgainFirst")}
            callbackURL="/account"
          />
        </div>
      ) : (
        <ChangeEmail hasPassword={card.hasPassword} action={action} />
      );
  }
}

function Sentence({ children }: { readonly children: string }) {
  return (
    <p className="max-w-prose text-xs text-ink-3" data-testid="email-card">
      {children}
    </p>
  );
}

/** The new address, and the current password where there is one (D16). */
function ChangeEmail({
  hasPassword,
  action,
}: {
  readonly hasPassword: boolean;
  readonly action: (
    previous: EmailChangeResult | null,
    form: FormData,
  ) => Promise<EmailChangeResult>;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);
  // A refusal keeps what was typed: React resets a form after its action.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  if (state?.ok) {
    return (
      <p
        role="status"
        aria-live="polite"
        data-testid="email-card"
        className="max-w-prose rounded-md bg-ok-bg px-2.5 py-1.5 text-xs font-medium text-ok"
      >
        {state.message}
      </p>
    );
  }
  return (
    <form
      action={formAction}
      onSubmit={submit}
      aria-busy={pending}
      data-testid="email-card"
      className="flex w-full max-w-md flex-col items-start gap-3"
    >
      <p className="max-w-prose text-xs text-ink-3">
        {t("account.email.intro")}
      </p>
      <EmailInput
        id="new-email"
        name="newEmail"
        label={t("account.email.newEmail")}
        autoComplete="off"
        required
        className="w-full"
        error={state?.field === "newEmail" ? state.message : null}
      />
      {hasPassword ? (
        <SecretInput
          id="email-change-password"
          name="password"
          label={t("account.security.password.current")}
          autoComplete="current-password"
          required
          className="w-full"
          error={state?.field === "password" ? state.message : null}
        />
      ) : null}
      <Button type="submit" size="sm" pending={pending}>
        {t("account.email.change")}
      </Button>
      <FormError>
        {state?.heldMinutes !== undefined ? (
          <>
            {state.heldMinutes === 1
              ? t("auth.signIn.heldForAMinute")
              : t("auth.signIn.heldForMinutes", {
                  minutes: state.heldMinutes,
                })}{" "}
            <Link href="/forgot-password" className="underline">
              {t("auth.signIn.resetYourPassword")}
            </Link>
          </>
        ) : state && !state.field ? (
          state.message
        ) : null}
      </FormError>
    </form>
  );
}
