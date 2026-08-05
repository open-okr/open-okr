"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <AuthCard
        title="That link has expired"
        description="Reset links last an hour and can be used once."
        footer={<Link href="/forgot-password">Ask for a new link</Link>}
      >
        <p />
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
      setError("That link has expired or was already used. Ask for a new one.");
      return;
    }
    router.push("/sign-in");
  };

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit}>
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Set password"}
        </button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary to keep the route static.
  return (
    <Suspense fallback={<AuthCard title="Loading…">{null}</AuthCard>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
