"use client";

import { Button, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

/**
 * Forgot password (screen S-35).
 *
 * The confirmation is the same whether or not the address is registered:
 * a different answer would let anyone test which addresses have accounts.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslations();

  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);

    const { error: failure } = await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/reset-password",
    });
    setPending(false);

    if (failure && failure.status === 429) {
      setError(t("auth.forgotPassword.tooManyRequests"));
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AuthCard
        title={t("auth.forgotPassword.checkYourEmail")}
        description={t("auth.forgotPassword.ifThatAddressHasAnAccount")}
      >
        <Link
          href="/sign-in"
          className="font-medium text-brand-text hover:underline"
        >
          {t("common.backToSignIn")}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.forgotPassword.resetYourPassword")}
      description={t("auth.forgotPassword.weWillEmailYouALink")}
      footer={
        <Link
          href="/sign-in"
          className="font-medium text-brand-text hover:underline"
        >
          {t("common.backToSignIn")}
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("people.detail.profileForm.email")}
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t("auth.forgotPassword.sending")
            : t("auth.forgotPassword.sendResetLink")}
        </Button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}
