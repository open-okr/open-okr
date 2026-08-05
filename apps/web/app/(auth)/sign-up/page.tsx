"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

/** Registration (screen S-35). */
export default function SignUpPage() {
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
      footer={<Link href="/sign-in">Already have an account? Sign in</Link>}
    >
      <form onSubmit={submit}>
        <Field label="Name" name="name" autoComplete="name" required />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <p style={{ fontSize: "0.875rem", color: "#52525b" }}>
          At least 12 characters. A phrase you can remember beats a short
          password you cannot.
        </p>
        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </form>
      <FormError>{error}</FormError>
    </AuthCard>
  );
}
