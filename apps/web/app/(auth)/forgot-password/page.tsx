"use client";

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
      setError("Too many requests. Wait a minute and try again.");
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        description="If that address has an account, a reset link is on its way. The link expires in an hour."
      >
        <p>
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="We will email you a link to set a new one."
      footer={<Link href="/sign-in">Back to sign in</Link>}
    >
      <form onSubmit={submit}>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}
