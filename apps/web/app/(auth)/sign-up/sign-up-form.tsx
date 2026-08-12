"use client";

import { Button } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

/** The registration form (screen S-35). Rendered only when registration is open. */
export function SignUpForm() {
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
      setError(
        failure.message ??
          "That did not work. Check your details and try again.",
      );
      return;
    }
    router.push("/");
  };

  return (
    <AuthCard
      title="Create your account"
      footer={
        <Link
          href="/sign-in"
          className="font-medium text-brand-text hover:underline"
        >
          Already have an account? Sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name" name="name" autoComplete="name" required />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <div className="flex flex-col gap-1">
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <p className="text-xs text-ink-3">
            At least 12 characters. A phrase you can remember beats a short
            password you cannot.
          </p>
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </Button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}
