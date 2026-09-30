"use client";

import { Button, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

/**
 * The way back in when the authenticator is gone (screen S-35). Without
 * this, losing a phone means losing the account.
 */
export default function BackupCodePage() {
  const { t } = useTranslations();

  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);

    const { error: failure } = await authClient.twoFactor.verifyBackupCode({
      code: String(form.get("code")),
    });
    setPending(false);

    if (failure) {
      setError(t("auth.backupCode.notRecognised"));
      return;
    }
    router.push("/");
  };

  return (
    <AuthCard
      title={t("auth.backupCode.useABackupCode")}
      description={t("auth.backupCode.eachCodeWorksOnce")}
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
          label={t("auth.backupCode.backupCode")}
          name="code"
          autoComplete="one-time-code"
          required
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t("auth.backupCode.checking")
            : t("auth.backupCode.verify")}
        </Button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}
