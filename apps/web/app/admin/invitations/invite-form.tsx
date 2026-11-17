"use client";

import { RefusedFields, SubmitButton, useTranslations } from "@openokr/ui";
import { useActionState } from "react";
import type { InviteResult } from "./actions";

/**
 * A form that can hand back an invitation link (P6-G06).
 *
 * The link is rendered from the action's own answer and nowhere else. There is
 * no state to lose it from and no second render that could show it again,
 * because the table holds only the token's digest. This is the same shape the
 * API-token form takes at P5-T07a, and for the same reason.
 *
 * **The address, since P6-G06b.** This handed out a bare token until then,
 * because `/join` did not exist: resolving a token to its workspace is a
 * cross-tenant read and `invite_links` carried row-level security keyed on
 * `workspace_id` alone. Migration 0075 gave it the second-key policy
 * `api_tokens` has, so the route exists and the thing to send somebody is a
 * link. The token is still shown beneath it, for the command line and for
 * anybody pasting into a chat that mangles URLs.
 */
export function InviteForm({
  action,
  submitLabel,
  bodyClassName,
  children,
}: {
  readonly action: (formData: FormData) => Promise<InviteResult>;
  readonly submitLabel: string;
  /** The grid the fields sit on, inside the card body. */
  readonly bodyClassName?: string;
  readonly children: React.ReactNode;
}) {
  const { t } = useTranslations();

  const [state, formAction, pending] = useActionState(
    async (_previous: InviteResult | null, formData: FormData) =>
      action(formData),
    null,
  );

  const result = state?.link ? (
    <div className="flex flex-col gap-1.5 rounded-md bg-brand-weak px-2.5 py-2 text-xs text-brand-text">
      <span className="font-semibold">
        {t("admin.invitations.inviteForm.copyThisNowIt")}
      </span>
      <code
        data-testid="invite-link"
        className="break-all font-mono text-sm font-bold"
      >
        {state.link.url}
      </code>
      <span className="text-xs">
        {t("admin.invitations.inviteForm.theTokenOnIts")}{" "}
        <code data-testid="invite-token" className="break-all font-mono">
          {state.link.token}
        </code>
      </span>
      {state.link.email ? (
        <span>
          {t("admin.invitations.inviteForm.onlyMayUseItOnce", {
            email: state.link.email,
          })}
        </span>
      ) : (
        <span>{t("admin.invitations.inviteForm.anyoneHoldingItMay")}</span>
      )}
    </div>
  ) : null;

  return (
    <form action={formAction} aria-busy={pending}>
      <div className="p-3.5">
        {/* Each field shows what was refused about it (U1b). */}
        <RefusedFields fields={state?.fields}>
          <div className={bodyClassName}>
            {children}
            {result ? <div className="col-span-12">{result}</div> : null}
          </div>
        </RefusedFields>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-line border-t px-3.5 py-2.5">
        <div className="mr-auto min-w-0">
          {!state?.link && state?.error ? (
            <p
              role="alert"
              className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
            >
              {state.error}
            </p>
          ) : null}
        </div>
        <SubmitButton variant="primary" size="sm">
          {pending ? t("admin.invitations.inviteForm.working") : submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
