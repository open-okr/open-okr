"use client";

import { useTranslations } from "@openokr/ui";
import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
} from "react";
import type { ProfileResult } from "../actions.ts";

/**
 * An administrator's edit of somebody else's name, title and manager (S-33).
 *
 * It used to throw its answer away, so a refused save and a saved one looked
 * the same: the form was simply there again (guided-inputs §5, F5). The
 * sentence is said under the button now, and a refusal keeps what was typed,
 * submitted through a transition because React resets a form after its
 * action.
 */
export function MemberFieldsForm({
  action,
  children,
}: {
  readonly action: (
    previous: ProfileResult | null,
    form: FormData,
  ) => Promise<ProfileResult>;
  /** The fields, drawn by the page from what is stored. */
  readonly children: ReactNode;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);
  // `action` stays on the form, so it still works before the page hydrates.
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
      data-testid="member-fields"
      className="flex flex-col gap-2"
    >
      {children}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand disabled:opacity-60"
      >
        {t("common.save")}
      </button>
      {state && !state.ok ? (
        <p role="alert" className="text-xs text-bad">
          {state.message}
        </p>
      ) : state?.ok ? (
        <p role="status" className="text-xs text-ok">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
