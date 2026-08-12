"use client";

import { Button } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { Field, FormError } from "../../(auth)/auth-card.tsx";
import { PasswordField } from "../../(auth)/password-field.tsx";
import { finishSetup } from "./actions";

/**
 * The wizard's account form (P1-T09).
 *
 * Two steps, in this order:
 *
 *   1. create the account through Better Auth, exactly as sign-up does
 *   2. record that setup is finished, and close registration
 *
 * If the second fails, the account still exists and the wizard is still open,
 * so a refresh recovers. The reverse order would close registration around an
 * instance with nobody in it, and there would be no way back in.
 */
export function SetupAccountForm() {
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

    if (failure) {
      setPending(false);
      setError(
        failure.message ??
          "That did not work. Check your details and try again.",
      );
      return;
    }

    const result = await finishSetup({
      instanceName: String(form.get("instanceName") ?? ""),
    });

    setPending(false);

    if (!result.ok) {
      // The account exists, so say so rather than inviting them to create it
      // again and hit "email already registered".
      setError(
        `Your account was created, but finishing setup failed: ${result.message} You can sign in and finish from admin.`,
      );
      return;
    }

    router.push("/");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label="What should this instance be called?"
        name="instanceName"
        defaultValue="OpenOKR"
        autoComplete="off"
      />

      <Field label="Your name" name="name" autoComplete="name" required />

      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />

      <div className="flex flex-col gap-1">
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <p className="text-xs text-ink-3">
          At least 12 characters. A phrase you can remember beats a short
          password you cannot.
        </p>
      </div>

      {/*
        The wizard is specified to offer demo data. There is none to offer
        yet: demo data means objectives, key results and a cycle, and those
        arrive in Phase 3. A checkbox that seeded nothing would be worse than
        its absence, so the offer lands with the content. Recorded on P3-T01.
      */}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Setting up…" : "Finish setup"}
      </Button>

      <FormError>{error}</FormError>
    </form>
  );
}
