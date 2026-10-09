"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { useInstanceName } from "../../../lib/instance-name-context";
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
  const { t } = useTranslations();
  const instanceName = useInstanceName();

  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);

    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const { data, error: signUpFailure } = await authClient.signUp.email({
      email,
      password,
      name: String(form.get("name")),
    });

    // An instance with mail configured before its first run requires a
    // verified address, and Better Auth then signs nobody in at sign-up. The
    // first account is created verified (BUG-028), so signing in straight
    // away is what gives finishing setup its session.
    const failure =
      signUpFailure ??
      (data && !data.token
        ? (await authClient.signIn.email({ email, password })).error
        : null);

    if (failure) {
      setPending(false);
      setError(
        failure.message ?? t("setup.account.setupAccountForm.thatDidNotWork"),
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
        t("setup.account.setupAccountForm.createdButFinishingFailed", {
          message: result.message,
        }),
      );
      return;
    }

    router.push("/");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {/*
        Pre-filled with the name the instance already resolves to, which is
        `OPENOKR_INSTANCE_NAME` when the deployment set one (M-33). It used to
        be the literal "OpenOKR", and whatever the field held was stored, so
        clicking through the wizard replaced the operator's variable for good.
        Left as it is, nothing is stored and the variable keeps deciding.
      */}
      <Field
        label={t("setup.account.setupAccountForm.whatShouldThisInstance")}
        name="instanceName"
        defaultValue={instanceName}
        maxLength={120}
        autoComplete="off"
      />

      <Field
        label={t("setup.account.setupAccountForm.yourName")}
        name="name"
        autoComplete="name"
        required
      />

      <Field
        label={t("people.detail.profileForm.email")}
        name="email"
        type="email"
        autoComplete="email"
        required
      />

      <div className="flex flex-col gap-1">
        <PasswordField
          label={t("setup.account.setupAccountForm.password")}
          name="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <p className="text-xs text-ink-3">
          {t("setup.account.setupAccountForm.atLeast12Characters")}
        </p>
      </div>

      {/*
        The wizard is specified to offer demo data. There is none to offer
        yet: demo data means objectives, key results and a cycle, and those
        arrive in Phase 3. A checkbox that seeded nothing would be worse than
        its absence, so the offer lands with the content. Recorded on P3-T01.
      */}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending
          ? t("setup.account.setupAccountForm.settingUp")
          : t("setup.account.finishSetup")}
      </Button>

      <FormError>{error}</FormError>
    </form>
  );
}
