"use client";

import { guardPress, Spinner, TextInput, useTranslations } from "@openokr/ui";
import { type FormEvent, startTransition, useActionState } from "react";
import type { NewOwnWorkspaceState } from "./actions";

/** The form on S-50. A refusal keeps what was typed, and a success navigates away. */
export function NewOwnWorkspaceForm({
  action,
}: {
  readonly action: (formData: FormData) => Promise<NewOwnWorkspaceState>;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: NewOwnWorkspaceState | null, formData: FormData) =>
      action(formData),
    null,
  );
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
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-col gap-1.5">
        <TextInput
          label={t("workspaces.new.name")}
          id="own-workspace-name"
          maxLength={200}
          name="name"
          required
        />
      </div>
      <button
        className="inline-flex items-center gap-1.5 self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong"
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        onClick={guardPress(pending, undefined)}
        type="submit"
      >
        {pending ? <Spinner /> : null}
        <span>{t("workspaces.new.create")}</span>
      </button>
      {state?.error ? (
        <p
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
          role="alert"
        >
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
