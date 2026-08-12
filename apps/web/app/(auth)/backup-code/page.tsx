"use client";

import { Button } from "@openokr/ui";
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
      setError("That backup code was not recognised, or it has been used.");
      return;
    }
    router.push("/");
  };

  return (
    <AuthCard
      title="Use a backup code"
      description="Each code works once. Generate a fresh set afterwards."
      footer={
        <Link
          href="/sign-in"
          className="font-medium text-brand-600 hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field
          label="Backup code"
          name="code"
          autoComplete="one-time-code"
          required
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Checking…" : "Verify"}
        </Button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}
