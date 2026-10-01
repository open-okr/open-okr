"use client";

import { Button, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

function ResetPasswordForm() {
  const { t } = useTranslations();

  const router = useRouter();
  const token = useSearchParams().get("token");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <AuthCard
        title={t("auth.resetPassword.thatLinkHasExpired")}
        description={t("auth.resetPassword.resetLinksLastAnHour")}
        footer={
          <Link
            href="/forgot-password"
            className="font-medium text-brand-text hover:underline"
          >
            {t("auth.resetPassword.askForANew")}
          </Link>
        }
      >
        {null}
      </AuthCard>
    );
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);

    const { error: failure } = await authClient.resetPassword({
      newPassword: String(form.get("password")),
      token,
    });
    setPending(false);

    if (failure) {
      setError(t("auth.resetPassword.thatLinkHasExpiredOrUsed"));
      return;
    }
    router.push("/sign-in");
  };

  return (
    <AuthCard title={t("auth.resetPassword.chooseANewPassword")}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label={t("auth.resetPassword.newPassword")}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t("auth.resetPassword.saving")
            : t("auth.resetPassword.setPassword")}
        </Button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  const { t } = useTranslations();

  // useSearchParams needs a Suspense boundary to keep the route static.
  return (
    <Suspense
      fallback={
        <AuthCard title={t("auth.resetPassword.loading")}>{null}</AuthCard>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
