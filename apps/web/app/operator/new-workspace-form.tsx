"use client";

import {
  EmailInput,
  guardPress,
  Spinner,
  TextInput,
  useTranslations,
} from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
} from "react";
import type { NewWorkspaceState } from "./workspace-actions";

/**
 * Creating a workspace from S-45 (docs/design/hosting-profiles.md §3).
 *
 * The operator names who will own it and never becomes a member themselves.
 * Submitted through a transition for the reason the plan form gives: React resets
 * a form after its action, and a refusal should not clear what was typed.
 */
export function NewWorkspaceForm({
  action,
}: {
  readonly action: (formData: FormData) => Promise<NewWorkspaceState>;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: NewWorkspaceState | null, formData: FormData) =>
      action(formData),
    null,
  );
  const form = useRef<HTMLFormElement>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  useEffect(() => {
    if (state?.done) {
      form.current?.reset();
    }
  }, [state]);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-ink text-sm">
        {t("operator.newWorkspace.title")}
      </h2>
      <form
        action={formAction}
        onSubmit={submit}
        ref={form}
        aria-busy={pending}
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <p className="text-ink-2 text-sm">{t("operator.newWorkspace.intro")}</p>
        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <TextInput
              label={t("operator.newWorkspace.name")}
              id="new-workspace-name"
              maxLength={200}
              name="name"
              error={state?.fields?.name}
              required
            />
          </div>
          <div className="flex min-w-64 flex-1 flex-col gap-1.5">
            <EmailInput
              label={t("operator.newWorkspace.owner")}
              id="new-workspace-owner"
              name="ownerEmail"
              error={state?.fields?.ownerEmail}
              required
            />
          </div>
        </div>
        <button
          className="inline-flex items-center gap-1.5 self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong"
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          onClick={guardPress(pending, undefined)}
          type="submit"
        >
          {pending ? <Spinner /> : null}
          <span>{t("operator.newWorkspace.create")}</span>
        </button>
        {state?.error ? (
          <p
            className="rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
            role="alert"
          >
            {state.error}
          </p>
        ) : state?.done ? (
          <p className="text-ok text-sm" role="status">
            {state.done}
          </p>
        ) : null}
      </form>
    </section>
  );
}
