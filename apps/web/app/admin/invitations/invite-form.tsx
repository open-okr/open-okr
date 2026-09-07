"use client";

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
 * **The token, not a URL, until P6-G06b.** The address an invitee follows is
 * `/join`, and that route does not exist yet: resolving a token to its
 * workspace is a cross-tenant read, and `invite_links` carries row-level
 * security keyed on `workspace_id`, so it needs the second-key policy
 * `api_tokens` already has and a migration to add it. Handing out a URL that
 * answers 404 would be worse than handing out nothing, so this shows the token
 * and says where it will be usable.
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
            Copy this now. It is not shown again.
          </span>
          <code
            data-testid="invite-token"
            className="break-all font-mono text-sm font-bold"
          >
            {state.link.token}
          </code>
          {state.link.email ? (
            <span>Only {state.link.email} may use it, once.</span>
          ) : (
            <span>Anyone holding it may join, within the limits you set.</span>
          )}
          <span>
            The address to send somebody arrives at P6-G06b, with the join
            screen. Until then this token is redeemable through the command line
            and the REST surface.
          </span>
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
