"use client";

import type { LegalLinks } from "@openokr/core";
import { Button, EmailInput, SecretInput, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";
import { ResendLink } from "../resend-link";

/**
 * The registration form (screen S-35). Rendered only when registration is
 * open, or open to company addresses, which `companyOnly` says under the
 * email field (docs/design/registration-policy.md §4). The server refuses a
 * free mail address either way; the line saves somebody a wasted try.
 */
export function SignUpForm({
  companyOnly = false,
  legal,
  linkHours = 1,
}: {
  readonly companyOnly?: boolean;
  /**
   * The provider's legal pages, when it has any. A self-hosted instance
   * usually has none, and then the form says nothing rather than pointing at a
   * page that does not exist.
   */
  readonly legal: LegalLinks;
  /** How long the confirmation link works, for the check-your-email card. */
  readonly linkHours?: number;
}) {
  const { t } = useTranslations();

  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // The address the link went to, once the account exists and is waiting for
  // it. Held in the page's own state, never in the address bar.
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));

    const { data, error: failure } = await authClient.signUp.email({
      email,
      password: String(form.get("password")),
      name: String(form.get("name")),
      // Where the link in the mail lands once it is opened (plan 0.8.0 S2).
      // Without it Better Auth returned to the home page, which sent a person
      // with no session to sign in with no word that anything had worked.
      callbackURL: "/email-confirmed",
    });
    setPending(false);

    if (failure) {
      setError(failure.message ?? t("auth.signUp.signUpForm.thatDidNotWork"));
      return;
    }
    // **No session means the address must be confirmed first** (plan 0.8.0
    // S1). The form went to the home page whatever happened, which bounced a
    // new person to sign in with nothing said about the mail they had been
    // sent. Where the instance cannot send mail there is a session, and they
    // go on to onboarding as before.
    if (data && !data.token) {
      setSentTo(email);
      return;
    }
    router.push("/");
  };

  if (sentTo !== null) {
    return (
      <AuthCard
        title={t("auth.signUp.checkEmail.title")}
        footer={
          <Link
            href="/sign-in"
            className="font-medium text-brand-text hover:underline"
          >
            {t("common.backToSignIn")}
          </Link>
        }
      >
        <div
          className="flex flex-col gap-2.5 text-sm text-ink-2"
          data-testid="check-email"
        >
          <p>
            {t("auth.signUp.checkEmail.created")}{" "}
            <strong className="font-semibold text-ink">{sentTo}</strong>
          </p>
          <p>{t("auth.signUp.checkEmail.open")}</p>
          <p>
            {linkHours === 1
              ? t("auth.signUp.checkEmail.lastsOneHour")
              : t("auth.signUp.checkEmail.lastsHours", { hours: linkHours })}
          </p>
          <p className="text-ink-3">{t("auth.signUp.checkEmail.spam")}</p>
          {/* For a mail that never came (plan 0.8.0 S3). The same answer
              whether or not the address has an account. */}
          <ResendLink email={sentTo} hours={linkHours} wording="neutral" />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.signUp.signUpForm.createYourAccount")}
      footer={
        <Link
          href="/sign-in"
          className="font-medium text-brand-text hover:underline"
        >
          {t("auth.signUp.signUpForm.alreadyHaveAnAccount")}
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("common.name")}
          name="name"
          autoComplete="name"
          required
        />
        <EmailInput
          label={t("people.detail.profileForm.email")}
          name="email"
          required
        />
        {companyOnly ? (
          <p className="-mt-1.5 text-xs text-ink-3" data-testid="company-only">
            {t("auth.signUp.signUpForm.useCompanyEmail")}
          </p>
        ) : null}
        <SecretInput
          label={t("auth.signUp.signUpForm.password")}
          name="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          description={t("auth.signUp.signUpForm.atLeast12Characters")}
        />
        <Button type="submit" variant="primary" pending={pending}>
          {pending
            ? t("auth.signUp.signUpForm.creating")
            : t("auth.signUp.signUpForm.createAccount")}
        </Button>
      </form>
      {legal.termsUrl || legal.privacyUrl ? (
        <p className="mt-3 flex flex-wrap gap-x-2 text-ink-3 text-xs">
          <span>{t("auth.signUp.signUpForm.agreement")}</span>
          {legal.termsUrl ? (
            <a
              className="text-brand-text hover:underline"
              href={legal.termsUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t("auth.signUp.signUpForm.terms")}
            </a>
          ) : null}
          {legal.privacyUrl ? (
            <a
              className="text-brand-text hover:underline"
              href={legal.privacyUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t("auth.signUp.signUpForm.privacy")}
            </a>
          ) : null}
        </p>
      ) : null}
      <FormError>{error}</FormError>
    </AuthCard>
  );
}
