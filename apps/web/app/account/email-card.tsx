"use client";

import type { EmailCard as EmailCardState } from "@openokr/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmailInput,
  SecretInput,
  useTranslations,
} from "@openokr/ui";
import Link from "next/link";
import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
} from "react";
import { FormError } from "../(auth)/auth-card";
import type { EmailChangeResult } from "./email-actions";
import { SignInAgain } from "./security/password-card";

const FORM_ID = "email-change-form";

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
 * **The whole "How you sign in" card** (docs/design/settings-page-layout.md):
 * the address the account signs in as, the link to Security and the change
 * form. The Change email button is an action, not a setting, so it sits in a
 * footer row with no Discard. A refusal that replaces the form shows its
 * sentence and no footer.
 *
 * The answer to an accepted request is the same sentence whether or not the
 * address has an account, so this form cannot be used to find one.
 */
export function EmailCard({
  card,
  action,
  email,
  opened,
}: {
  readonly card: EmailCardState;
  readonly action: (
    previous: EmailChangeResult | null,
    form: FormData,
  ) => Promise<EmailChangeResult>;
  /** The address the account signs in as. */
  readonly email: string;
  /** What became of an opened change link, or null. */
  readonly opened: { readonly ok: boolean; readonly message: string } | null;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);
  // A refusal keeps what was typed: React resets a form after its action.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  let content: ReactNode;
  let showForm = false;
  switch (card.kind) {
    case "no_mail":
      content = <Sentence>{t("account.email.noMail")}</Sentence>;
      break;
    case "demo":
      content = <Sentence>{t("account.email.demo")}</Sentence>;
      break;
    case "directory":
      content = <Sentence>{t("account.email.directory")}</Sentence>;
      break;
    case "enforced":
      content = (
        <Sentence>
          {t("account.email.enforced", {
            provider: card.provider,
            domain: card.domain,
          })}
        </Sentence>
      );
      break;
    default:
      if (!card.hasPassword && !card.recent) {
        content = (
          <div className="col-span-12 flex flex-col items-start gap-3">
            <SignInAgain
              providers={card.providers}
              intro={t("account.email.signInAgainFirst")}
              callbackURL="/account"
            />
          </div>
        );
      } else if (state?.ok) {
        content = (
          <p
            role="status"
            aria-live="polite"
            data-testid="email-card"
            className="col-span-12 max-w-prose rounded-md bg-ok-bg px-2.5 py-1.5 text-xs font-medium text-ok"
          >
            {state.message}
          </p>
        );
      } else {
        showForm = true;
        content = (
          <form
            id={FORM_ID}
            action={formAction}
            onSubmit={submit}
            aria-busy={pending}
            data-testid="email-card"
            className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-4"
          >
            <EmailInput
              id="new-email"
              name="newEmail"
              label={t("account.email.newEmail")}
              autoComplete="off"
              required
              className="col-span-12 md:col-span-6"
              error={state?.field === "newEmail" ? state.message : null}
            />
            {card.hasPassword ? (
              <SecretInput
                id="email-change-password"
                name="password"
                label={t("account.security.password.current")}
                autoComplete="current-password"
                required
                className="col-span-12 md:col-span-6"
                error={state?.field === "password" ? state.message : null}
              />
            ) : null}
          </form>
        );
      }
  }

  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("account.profile.signIn")}
          </h2>
          <p className="text-xs text-ink-3">{t("account.email.intro")}</p>
        </div>
        <Link
          href="/account/security"
          className="text-xs font-semibold text-brand-text hover:underline"
        >
          {t("account.profile.passwordAndSessions")}
        </Link>
      </CardHeader>
      <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
        <div role="status" aria-live="polite" className="contents">
          {opened ? (
            <p
              data-testid="email-change-outcome"
              className={
                opened.ok
                  ? "col-span-12 max-w-prose rounded-md bg-ok-bg px-2.5 py-1.5 text-xs font-medium text-ok"
                  : "col-span-12 max-w-prose rounded-md bg-bad-bg px-2.5 py-1.5 text-xs font-medium text-bad"
              }
            >
              {opened.message}
            </p>
          ) : null}
        </div>
        <div className="col-span-12 flex flex-col gap-1">
          <span className="text-sm font-semibold text-ink-2">
            {t("account.profile.email")}
          </span>
          <div className="flex h-7.5 items-center rounded-control bg-raised px-2.5 text-sm text-ink-2">
            <span data-testid="account-email">{email}</span>
          </div>
        </div>
        {content}
      </CardBody>
      {showForm ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-line border-t px-3.5 py-2.5">
          <div className="min-w-0 text-sm">
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
          </div>
          <Button
            type="submit"
            form={FORM_ID}
            variant="primary"
            size="sm"
            pending={pending}
          >
            {t("account.email.change")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Sentence({ children }: { readonly children: string }) {
  return (
    <p
      className="col-span-12 max-w-prose text-xs text-ink-3"
      data-testid="email-card"
    >
      {children}
    </p>
  );
}
