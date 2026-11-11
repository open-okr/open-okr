"use client";

import type { DeletionCard as DeletionCardState } from "@openokr/core";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  SecretInput,
  useTranslations,
} from "@openokr/ui";
import Link from "next/link";
import { type FormEvent, startTransition, useActionState } from "react";
import { FormError } from "../(auth)/auth-card";
import type { DeletionResult } from "./delete-actions";
import { SignInAgain } from "./security/password-card";

/**
 * Delete your account, at the foot of Your account (screen S-51, docs/design/
 * account-deletion.md §3.1, plan 0.8.0 Y7).
 *
 * **It says what happens before anybody presses anything**: the fourteen
 * days, that every device is signed out, that signing in again keeps the
 * account, and that what they wrote stays under a placeholder name. The data
 * export is offered first.
 *
 * **What the card offers is decided on the server**, from the account as it
 * is now: a demonstration account, a directory-managed one and the last
 * owner of a workspace see why not and no form. Otherwise the password, or,
 * for an account with none, a sign-in in the last ten minutes.
 */
export function DeleteAccountCard({
  card,
  days,
  currentWorkspaceId,
  cloud,
  action,
}: {
  readonly card: DeletionCardState;
  readonly days: number;
  /** The workspace this page is open in, which the handover links act on. */
  readonly currentWorkspaceId: string;
  /** A managed cloud, where an owner may close a workspace (Y7-3). */
  readonly cloud: boolean;
  readonly action: (
    previous: DeletionResult | null,
    form: FormData,
  ) => Promise<DeletionResult>;
}) {
  const { t } = useTranslations();
  return (
    <Card data-testid="delete-account-card" className="border-bad/40">
      <CardHeader>
        <h2 className="text-sm font-bold text-bad">
          {t("account.delete.title")}
        </h2>
      </CardHeader>
      <CardBody className="flex flex-col items-start gap-3 text-sm">
        <p className="max-w-prose text-ink-2">
          {t("account.delete.explains", { days })}
        </p>
        <p className="max-w-prose text-xs text-ink-3">
          {t("account.delete.exportFirst")}{" "}
          <Link
            href="/account/security"
            className="font-semibold text-brand-text hover:underline"
          >
            {t("account.delete.exportLink")}
          </Link>
        </p>
        <Body
          card={card}
          currentWorkspaceId={currentWorkspaceId}
          cloud={cloud}
          action={action}
        />
      </CardBody>
    </Card>
  );
}

function Body({
  card,
  currentWorkspaceId,
  cloud,
  action,
}: {
  readonly card: DeletionCardState;
  readonly currentWorkspaceId: string;
  readonly cloud: boolean;
  readonly action: (
    previous: DeletionResult | null,
    form: FormData,
  ) => Promise<DeletionResult>;
}) {
  const { t } = useTranslations();
  switch (card.kind) {
    case "demo":
      return <Refusal>{t("account.delete.demo")}</Refusal>;
    case "directory":
      return <Refusal>{t("account.delete.directory")}</Refusal>;
    case "last_owner": {
      // The links act on the workspace this page is open in, so another
      // workspace is named with the way to reach it instead.
      const here = card.workspaceId === currentWorkspaceId;
      return (
        <div className="flex flex-col gap-1.5" data-testid="delete-refusal">
          <p className="max-w-prose text-xs text-ink-2">
            {t("account.delete.lastOwner", { workspace: card.workspaceName })}
          </p>
          {here ? (
            <p className="flex flex-wrap gap-3 text-xs font-semibold">
              <Link
                href="/admin/roles"
                className="text-brand-text hover:underline"
              >
                {t("account.delete.handOver")}
              </Link>
              {cloud ? (
                <Link
                  href="/admin/general"
                  className="text-brand-text hover:underline"
                >
                  {t("account.delete.closeIt")}
                </Link>
              ) : null}
            </p>
          ) : (
            <p className="max-w-prose text-xs text-ink-3">
              {t("account.delete.switchFirst", {
                workspace: card.workspaceName,
              })}
            </p>
          )}
        </div>
      );
    }
    default:
      return !card.hasPassword && !card.recent ? (
        <div className="flex flex-col items-start gap-3">
          <SignInAgain
            providers={card.providers}
            intro={t("account.delete.signInAgainFirst")}
            callbackURL="/account"
          />
        </div>
      ) : (
        <Confirm hasPassword={card.hasPassword} action={action} />
      );
  }
}

function Refusal({ children }: { readonly children: string }) {
  return (
    <p className="max-w-prose text-xs text-ink-2" data-testid="delete-refusal">
      {children}
    </p>
  );
}

/** The password, where there is one, and the button (design §3.1). */
function Confirm({
  hasPassword,
  action,
}: {
  readonly hasPassword: boolean;
  readonly action: (
    previous: DeletionResult | null,
    form: FormData,
  ) => Promise<DeletionResult>;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);
  // A refusal keeps what was typed: React resets a form after its action.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  return (
    <form
      action={formAction}
      onSubmit={submit}
      aria-busy={pending}
      data-testid="delete-account-form"
      className="flex w-full max-w-md flex-col items-start gap-3"
    >
      {hasPassword ? (
        <SecretInput
          id="delete-account-password"
          name="password"
          label={t("account.delete.password")}
          autoComplete="current-password"
          required
          className="w-full"
          error={state?.field === "password" ? state.message : null}
        />
      ) : null}
      <Button type="submit" size="sm" pending={pending}>
        {t("account.delete.confirm")}
      </Button>
      <FormError>
        {state?.heldMinutes !== undefined ? (
          <>
            {state.heldMinutes === 1
              ? t("auth.signIn.heldForAMinute")
              : t("auth.signIn.heldForMinutes", {
                  minutes: state.heldMinutes,
                })}{" "}
            <Link href="/forgot-password" className="underline">
              {t("auth.signIn.resetYourPassword")}
            </Link>
          </>
        ) : state && !state.field ? (
          state.message
        ) : null}
      </FormError>
    </form>
  );
}
