"use client";

import { Button, CodeInput, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard } from "../auth-card";

/**
 * The way back in when the authenticator is gone (screen S-35). Without
 * this, losing a phone means losing the account.
 */
export default function BackupCodePage() {
  const { t } = useTranslations();

  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");

  // Called by the field once its tenth character is in, and by Verify. The
  // codes are issued as `xxxxx-xxxxx` and compared as written, so the hyphen
  // the cells draw is put back before the code is sent.
  const verify = async (entered: string) => {
    setError("");
    setPending(true);
    const { error: failure } = await authClient.twoFactor.verifyBackupCode({
      code: `${entered.slice(0, 5)}-${entered.slice(5)}`,
    });
    setPending(false);

    if (failure) {
      setCode("");
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          verify(code);
        }}
        className="flex flex-col gap-3"
      >
        <CodeInput
          label={t("auth.backupCode.backupCode")}
          groups={[5, 5]}
          characters="letters-and-digits"
          autoFocus
          value={code}
          onChange={setCode}
          onComplete={verify}
          busy={pending}
          error={error || null}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={pending || code.length < 10}
        >
          {pending
            ? t("auth.backupCode.checking")
            : t("auth.backupCode.verify")}
        </Button>
      </form>
    </AuthCard>
  );
}
