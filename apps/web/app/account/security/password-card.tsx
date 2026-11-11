"use client";

import type { PasswordCard as PasswordCardState } from "@openokr/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  SecretInput,
  useTranslations,
} from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useState,
} from "react";
import { authClient } from "../../../lib/auth-client";
import { FormError } from "../../(auth)/auth-card";
import type { SetPasswordResult } from "./password-actions";

/**
 * The password half of Security (screen S-35, docs/design/
 * account-self-service.md D7 to D12, plan 0.8.0 Y3).
 *
 * **Changing a password calls Better Auth's own `/change-password`** from the
 * browser, as the one-time-code form beside it calls `/two-factor/enable`.
 * The screen and a direct call then meet one guard, in `createAuth`'s hooks:
 * a demonstration account and an account single sign-on claims are refused
 * there, a wrong current password counts toward the sign-in hold, and every
 * change is recorded and mailed. Nothing here is a second check to keep in
 * step.
 *
 * **An account with no password gets Set a password**, once its session is
 * under ten minutes old. Until then the card offers to sign in again with
 * the identity provider the account is linked to, which brings the person
 * back here with a fresh session.
 */

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

export function PasswordCard({
  card,
  setPassword,
}: {
  readonly card: PasswordCardState;
  readonly setPassword: (
    previous: SetPasswordResult | null,
    form: FormData,
  ) => Promise<SetPasswordResult>;
}) {
  const { t } = useTranslations();
  return (
    <Card data-testid="password-card">
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {card.kind === "set"
            ? t("account.security.password.setTitle")
            : t("account.security.password.title")}
        </h2>
      </CardHeader>
      <CardBody className="flex flex-col items-start gap-3">
        {card.kind === "demo" ? (
          <p className="max-w-prose text-sm text-ink-3">
            {t("account.security.password.demo")}
          </p>
        ) : card.kind === "enforced" ? (
          <p className="max-w-prose text-sm text-ink-3">{card.message}</p>
        ) : card.kind === "change" ? (
          <ChangePassword />
        ) : card.recent ? (
          <SetPassword setPassword={setPassword} />
        ) : (
          <SignInAgain providers={card.providers} />
        )}
      </CardBody>
    </Card>
  );
}

type Field = "current" | "next" | "again";

/** Current, new, new again, and whether to sign the other devices out (D7, D10). */
function ChangePassword() {
  const { t } = useTranslations();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A held attempt, in whole minutes, kept apart because its sentence ends in
  // a link to the reset page (account-lockout.md D12).
  const [heldMinutes, setHeldMinutes] = useState<number | null>(null);
  const [done, setDone] = useState<"signedOut" | "staySignedIn" | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    setFailure(null);
    setHeldMinutes(null);
    setDone(null);
    if (next.length < MIN_LENGTH) {
      setErrors({ next: t("account.security.password.tooShort") });
      return;
    }
    if (next.length > MAX_LENGTH) {
      setErrors({ next: t("account.security.password.tooLong") });
      return;
    }
    if (next !== again) {
      setErrors({ again: t("account.security.password.notTheSame") });
      return;
    }

    setPending(true);
    let answer: Awaited<ReturnType<typeof authClient.changePassword>>;
    try {
      answer = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: signOutOthers,
      });
    } finally {
      setPending(false);
    }

    const refused = answer.error;
    if (refused) {
      if (refused.status === 429 && refused.code === "SIGN_IN_HELD") {
        const seconds = Number(
          (refused as { retryAfterSeconds?: unknown }).retryAfterSeconds,
        );
        setHeldMinutes(
          Math.max(
            1,
            Math.ceil((Number.isFinite(seconds) ? seconds : 60) / 60),
          ),
        );
      } else if (refused.status === 429) {
        setFailure(t("auth.signIn.tooManyAttempts"));
      } else if (refused.code === "INVALID_PASSWORD") {
        setErrors({
          current: t("account.security.securitySettings.passwordNotRight"),
        });
      } else if (refused.code === "PASSWORD_TOO_SHORT") {
        setErrors({ next: t("account.security.password.tooShort") });
      } else if (refused.code === "PASSWORD_TOO_LONG") {
        setErrors({ next: t("account.security.password.tooLong") });
      } else {
        setFailure(t("account.security.password.notChanged"));
      }
      return;
    }

    setCurrent("");
    setNext("");
    setAgain("");
    setDone(signOutOthers ? "signedOut" : "staySignedIn");
    // The device list below is the server's; it has fewer rows now.
    router.refresh();
  };

  return (
    <form
      onSubmit={submit}
      aria-busy={pending}
      className="flex w-full max-w-md flex-col items-start gap-3"
    >
      <SecretInput
        id="current-password"
        label={t("account.security.password.current")}
        autoComplete="current-password"
        required
        className="w-full"
        value={current}
        error={errors.current ?? null}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <SecretInput
        id="new-password"
        label={t("account.security.password.new")}
        description={t("account.security.password.atLeast")}
        autoComplete="new-password"
        required
        className="w-full"
        value={next}
        error={errors.next ?? null}
        onChange={(event) => setNext(event.target.value)}
      />
      <SecretInput
        id="new-password-again"
        label={t("account.security.password.again")}
        autoComplete="new-password"
        required
        className="w-full"
        value={again}
        error={errors.again ?? null}
        onChange={(event) => setAgain(event.target.value)}
      />
      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input
          type="checkbox"
          name="signOutOthers"
          checked={signOutOthers}
          onChange={(event) => setSignOutOthers(event.target.checked)}
          className="mt-0.5 size-4"
        />
        <span className="flex flex-col">
          <span>{t("account.security.password.signOutOthers")}</span>
          <span className="text-xs text-ink-3">
            {t("account.security.password.signOutOthersHelp")}
          </span>
        </span>
      </label>
      <Button type="submit" variant="primary" size="sm" pending={pending}>
        {t("account.security.password.change")}
      </Button>
      <FormError>
        {heldMinutes !== null ? (
          <>
            {heldMinutes === 1
              ? t("auth.signIn.heldForAMinute")
              : t("auth.signIn.heldForMinutes", { minutes: heldMinutes })}{" "}
            <Link href="/forgot-password" className="underline">
              {t("auth.signIn.resetYourPassword")}
            </Link>
          </>
        ) : (
          failure
        )}
      </FormError>
      <div role="status" aria-live="polite" className="contents">
        {done === null ? null : (
          <div className="flex flex-col gap-1.5 rounded-md bg-ok-bg px-2.5 py-1.5 text-xs font-medium text-ok">
            <p>
              {done === "signedOut"
                ? t("account.security.password.changedSignedOut")
                : t("account.security.password.changedStaySignedIn")}
            </p>
            {done === "signedOut" ? (
              <p className="flex gap-3">
                <Link href="/account/api-tokens" className="underline">
                  {t("account.security.password.apiTokens")}
                </Link>
                <Link href="/account/connections" className="underline">
                  {t("account.security.password.connectedApps")}
                </Link>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </form>
  );
}

/** Two fields and a Save, for an account with no password (D12). */
function SetPassword({
  setPassword,
}: {
  readonly setPassword: (
    previous: SetPasswordResult | null,
    form: FormData,
  ) => Promise<SetPasswordResult>;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(setPassword, null);
  // A refusal keeps what was typed: React resets a form after its action.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  if (state?.ok) {
    return (
      <p
        role="status"
        className="rounded-md bg-ok-bg px-2.5 py-1.5 text-xs font-medium text-ok"
      >
        {state.message}
      </p>
    );
  }
  return (
    <form
      action={formAction}
      onSubmit={submit}
      aria-busy={pending}
      className="flex w-full max-w-md flex-col items-start gap-3"
    >
      <p className="max-w-prose text-sm text-ink-3">
        {t("account.security.password.setIntro")}
      </p>
      <SecretInput
        id="set-password"
        name="newPassword"
        label={t("account.security.password.new")}
        description={t("account.security.password.atLeast")}
        autoComplete="new-password"
        required
        className="w-full"
        error={state?.field === "newPassword" ? state.message : null}
      />
      <SecretInput
        id="set-password-again"
        name="again"
        label={t("account.security.password.again")}
        autoComplete="new-password"
        required
        className="w-full"
        error={state?.field === "again" ? state.message : null}
      />
      <Button type="submit" variant="primary" size="sm" pending={pending}>
        {t("common.save")}
      </Button>
      <FormError>{state && !state.field ? state.message : null}</FormError>
    </form>
  );
}

/**
 * No recent sign-in yet: one button per identity provider the account is
 * linked to, each coming back to this card (D2).
 */
function SignInAgain({
  providers,
}: {
  readonly providers: Extract<PasswordCardState, { kind: "set" }>["providers"];
}) {
  const { t } = useTranslations();
  const [acting, setActing] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const again = async (provider: (typeof providers)[number]) => {
    setFailure(null);
    setActing(provider.id);
    let result: Awaited<
      ReturnType<typeof authClient.signIn.sso | typeof authClient.signIn.social>
    >;
    try {
      result =
        provider.kind === "saml"
          ? await authClient.signIn.sso({
              providerId: provider.id,
              callbackURL: "/account/security",
            })
          : await authClient.signIn.social({
              provider: provider.id as "github",
              callbackURL: "/account/security",
            });
    } finally {
      setActing(null);
    }
    if (result?.error) {
      setFailure(
        t("auth.signIn.providerCouldNotBeReached", {
          provider: provider.displayName,
        }),
      );
    }
  };

  return (
    <>
      <p className="max-w-prose text-sm text-ink-3">
        {t("account.security.password.signInAgainFirst")}
      </p>
      {providers.map((provider) => (
        <Button
          key={provider.id}
          type="button"
          size="sm"
          disabled={acting !== null}
          pending={acting === provider.id}
          onClick={() => again(provider)}
        >
          {t("account.security.password.signInAgainWith", {
            provider: provider.displayName,
          })}
        </Button>
      ))}
      <FormError>{failure}</FormError>
    </>
  );
}
