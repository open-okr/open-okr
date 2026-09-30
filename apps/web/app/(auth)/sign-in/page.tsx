"use client";

import { Button, useTranslations } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { useInstanceName } from "../../../lib/instance-name-context";
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
  // The instance this is, not the software it runs (M-33).
  const instanceName = useInstanceName();

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
  //
  // **Asked again once an address is typed** (completeness review H-03). On
  // the managed cloud the instance lists nothing to a visitor who has said
  // nothing, because every customer shares this page; given an address it
  // answers with the provider for that domain. A self-hosted instance lists
  // its own providers either way.
  const loadProviders = (email?: string) => {
    const query = email ? `?email=${encodeURIComponent(email)}` : "";
    fetch(`/api/sso-providers${query}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.providers)) {
          setSsoProviders(data.providers);
        }
      })
      .catch(() => {
        // SSO buttons simply do not appear if the fetch fails.
      });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: the first load only; a typed address reloads through the field's blur.
  useEffect(() => {
    loadProviders();
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
          ? t("auth.signIn.tooManyAttempts")
          : t("auth.signIn.thoseDetailsDidNotMatch"),
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
      setError(t("auth.signIn.thatCodeWasNotRight"));
      return;
    }
    router.push("/");
  };

  const signInWithPasskey = async () => {
    setError("");
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError(t("auth.signIn.thatPasskeyDidNotWork"));
      return;
    }
    router.push("/");
  };

  if (challenge) {
    return (
      <AuthCard
        title={t("auth.signIn.enterYourCode")}
        description={t("auth.signIn.openYourAuthenticatorApp")}
      >
        <form onSubmit={verify} className="flex flex-col gap-3">
          <Field
            label={t("auth.signIn.sixDigitCode")}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? t("auth.signIn.checking") : t("auth.signIn.verify")}
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
      title={t("auth.signIn.heading", { instanceName })}
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
          label={t("people.detail.profileForm.email")}
          name="email"
          type="email"
          autoComplete="username webauthn"
          required
          onBlur={(event) => {
            const address = event.currentTarget.value.trim();
            if (address.includes("@")) {
              loadProviders(address);
            }
          }}
        />
        <Field
          label={t("auth.signIn.password")}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("auth.signIn.signingIn") : t("setup.account.signIn")}
        </Button>
      </form>

      <Button type="button" variant="default" onClick={signInWithPasskey}>
        {t("auth.signIn.signInWithA")}
      </Button>

      {ssoProviders.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
          <p className="text-center text-xs text-ink-3">
            {t("auth.signIn.orSignInWith")}
          </p>
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
                    t("auth.signIn.providerCouldNotBeReached", {
                      provider: provider.displayName,
                    }),
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
            {t("auth.signIn.thisIsADemonstrationInstance")}
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
              {t("auth.signIn.thePasswordIsForAllOfThem", {
                password: demoPassword,
              })}
            </p>
          ) : null}
        </div>
      )}

      <FormError>{error}</FormError>
    </AuthCard>
  );
}
