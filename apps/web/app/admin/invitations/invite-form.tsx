"use client";

import { useTranslations } from "@openokr/ui";
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
  children,
}: {
  readonly action: (formData: FormData) => Promise<InviteResult>;
  readonly submitLabel: string;
  readonly children: React.ReactNode;
}) {
  const { t } = useTranslations();

  const [state, formAction, pending] = useActionState(
    async (_previous: InviteResult | null, formData: FormData) =>
      action(formData),
    null,
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      aria-busy={pending}
    >
      {children}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-60"
      >
        {pending ? "Working…" : submitLabel}
      </button>

      {state?.link ? (
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
              {t("admin.invitations.inviteForm.only")} {state.link.email}{" "}
              {t("admin.invitations.inviteForm.mayUseItOnce")}
            </span>
          ) : (
            <span>{t("admin.invitations.inviteForm.anyoneHoldingItMay")}</span>
          )}
        </div>
      ) : state?.error ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
