"use client";

import { Button, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { AuthCard, Field, FormError } from "../auth-card";

interface SSOProvider {
  id: string;
  displayName: string;
  /**
   * Which protocol, because the two start differently (P8-T07c-b).
   *
   * Absent on an instance that has not been upgraded, and `oidc` is the
   * right reading of that: every provider configured before the column
   * existed is one.
   */
  kind?: "oidc" | "saml";
}

/** One of the people a visitor may be on a demo instance (P8-T13c). */
interface DemoPersona {
  name: string;
  email: string;
  title: string;
}

/**
 * Sign in (screen S-35): password, passkey, SSO where configured, and the
 * one-time code challenge when a second factor is enrolled.
 */
export default function SignInPage() {
  const { t } = useTranslations();

  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [code, setCode] = useState("");
  const [ssoProviders, setSsoProviders] = useState<SSOProvider[]>([]);
  const [personas, setPersonas] = useState<DemoPersona[]>([]);
  const [demoPassword, setDemoPassword] = useState<string | null>(null);

  // Load SSO providers for buttons. Non-blocking: the password form renders
  // immediately and the buttons appear when the fetch completes.
  useEffect(() => {
    fetch("/api/sso-providers")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.providers)) {
          setSsoProviders(data.providers);
        }
      })
      .catch(() => {
        // SSO buttons simply do not appear if the fetch fails.
      });
  }, []);

  /**
   * Who a visitor may sign in as, on a demo instance (P8-T13c).
   *
   * Empty on every other kind of instance, and the panel then does not render
   * at all. Non-blocking, like the provider list above: the password form is
   * what this page is for and it must not wait on anything.
   */
  useEffect(() => {
    fetch("/api/demo-personas")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.personas) && data.personas.length > 0) {
          setPersonas(data.personas);
          setDemoPassword(
            typeof data.password === "string" ? data.password : null,
          );
        }
      })
      .catch(() => {
        // Not a demo, or the instance could not say. Either way, no panel.
      });
  }, []);

  /**
   * Fills the form rather than signing in, so the visitor sees what it did.
   *
   * Not named `usePersona`: the hook rule reads a `use` prefix as a hook and
   * refuses it inside a callback, which is right about the convention and
   * wrong about this function.
   */
  const fillForPersona = (email: string) => {
    const form = document.querySelector("form");
    const address = form?.querySelector<HTMLInputElement>(
      'input[name="email"]',
    );
    const secret = form?.querySelector<HTMLInputElement>(
      'input[name="password"]',
    );
    if (address) {
      address.value = email;
    }
    if (secret && demoPassword) {
      secret.value = demoPassword;
    }
    secret?.focus();
  };

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
        title={t("auth.signIn.enterYourCode")}
        description="Open your authenticator app and enter the six-digit code."
      >
        <form onSubmit={verify} className="flex flex-col gap-3">
          <Field
            label="Six-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Checking…" : "Verify"}
          </Button>
        </form>
        <FormError>{error}</FormError>
        <p className="text-sm text-ink-3">
          {t("auth.signIn.lostYourPhoneUse")}{" "}
          <Link
            href="/backup-code"
            className="font-medium text-brand-text hover:underline"
          >
            {t("auth.signIn.backupCodePage")}
          </Link>
          .
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.signIn.signInToOpenokr")}
      footer={
        <>
          <Link
            href="/forgot-password"
            className="font-medium text-brand-text hover:underline"
          >
            {t("auth.signIn.forgotYourPassword")}
          </Link>
          {" · "}
          <Link
            href="/sign-up"
            className="font-medium text-brand-text hover:underline"
          >
            {t("common.createAnAccount")}
          </Link>
        </>
      }
    >
      <form onSubmit={signIn} className="flex flex-col gap-3">
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
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <Button type="button" variant="default" onClick={signInWithPasskey}>
        {t("auth.signIn.signInWithA")}
      </Button>

      {ssoProviders.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
          <p className="text-center text-xs text-ink-3">or sign in with</p>
          {ssoProviders.map((provider) => (
            <Button
              key={provider.id}
              type="button"
              variant="default"
              onClick={async () => {
                setError("");
                // **Two protocols, two calls** (P8-T07c-b). SAML starts at
                // `signIn.sso`, and sending it to `signIn.social` reached a
                // provider `genericOAuth` had never been given, which failed
                // with nothing a person could act on.
                const result =
                  provider.kind === "saml"
                    ? await authClient.signIn.sso({
                        providerId: provider.id,
                        callbackURL: "/",
                      })
                    : await authClient.signIn.social({
                        provider: provider.id as "github",
                        callbackURL: "/",
                      });
                if (result?.error) {
                  setError(
                    `${provider.displayName} could not be reached. Try again, ` +
                      "or ask an administrator to check the configuration.",
                  );
                }
              }}
            >
              {provider.displayName}
            </Button>
          ))}
        </div>
      )}

      {personas.length > 0 && (
        <div
          className="flex flex-col gap-2 border-t border-ink/10 pt-3"
          data-testid="demo-personas"
        >
          <p className="text-xs text-ink-3">
            This is a demonstration instance. Sign in as anybody here; the
            workspace is rebuilt on a schedule and nothing in it is real.
          </p>
          <div className="flex flex-col gap-1">
            {personas.map((persona) => (
              <button
                key={persona.email}
                type="button"
                data-testid={`persona-${persona.email}`}
                onClick={() => fillForPersona(persona.email)}
                className="flex flex-col gap-0.5 rounded-md border border-line px-2.5 py-1.5 text-left hover:border-ink-4"
              >
                <span className="text-xs font-semibold text-ink">
                  {persona.name}
                </span>
                <span className="text-xs text-ink-3">
                  {persona.title} · {persona.email}
                </span>
              </button>
            ))}
          </div>
          {demoPassword ? (
            <p className="text-xs text-ink-3">
              The password is{" "}
              <code className="font-mono text-ink-2">{demoPassword}</code> for
              all of them.
            </p>
          ) : null}
        </div>
      )}

      <FormError>{error}</FormError>
    </AuthCard>
  );
}
