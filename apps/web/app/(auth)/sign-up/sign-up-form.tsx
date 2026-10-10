"use client";

import { Button, EmailInput, SecretInput, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

/** The registration form (screen S-35). Rendered only when registration is open. */
export function SignUpForm() {
  const { t } = useTranslations();

  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);

    const { error: failure } = await authClient.signUp.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
      name: String(form.get("name")),
    });
    setPending(false);

    if (failure) {
      setError(failure.message ?? t("auth.signUp.signUpForm.thatDidNotWork"));
      return;
    }
    router.push("/");
  };

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
        <SecretInput
          label={t("auth.signUp.signUpForm.password")}
          name="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          description={t("auth.signUp.signUpForm.atLeast12Characters")}
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t("auth.signUp.signUpForm.creating")
            : t("auth.signUp.signUpForm.createAccount")}
        </Button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}
