"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

/**
 * Sign in (screen S-35): password, passkey, and the one-time code challenge
 * when a second factor is enrolled.
 */
export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [code, setCode] = useState("");

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);

    const { data, error: failure } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);

    if (failure) {
      // Deliberately the same message whether the address is unknown or the
      // password is wrong: saying which would confirm who has an account.
      setError(
        failure.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Those details did not match. Check them and try again.",
      );
      return;
    }

    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setChallenge(true);
      return;
    }
    router.push("/");
  };

  const verify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    const { error: failure } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);

    if (failure) {
      setError("That code was not right. Codes change every 30 seconds.");
      return;
    }
    router.push("/");
  };

  const signInWithPasskey = async () => {
    setError("");
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError("That passkey did not work. Try your password instead.");
      return;
    }
    router.push("/");
  };

  if (challenge) {
    return (
      <AuthCard
        title="Enter your code"
        description="Open your authenticator app and enter the six-digit code."
      >
        <form onSubmit={verify}>
          <Field
            label="Six-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Verify"}
          </button>
        </form>
        <FormError>{error}</FormError>
        <p style={{ marginTop: "1rem", fontSize: "0.875rem" }}>
          Lost your phone? Use a backup code on the{" "}
          <Link href="/backup-code">backup code page</Link>.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in to OpenOKR"
      footer={
        <>
          <Link href="/forgot-password">Forgot your password?</Link>
          {" · "}
          <Link href="/sign-up">Create an account</Link>
        </>
      }
    >
      <form onSubmit={signIn}>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="username webauthn"
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p style={{ marginTop: "1rem" }}>
        <button type="button" onClick={signInWithPasskey}>
          Sign in with a passkey
        </button>
      </p>

      <FormError>{error}</FormError>
    </AuthCard>
  );
}
