"use client";

import { Button, RefusedFields, TextInput, useTranslations } from "@openokr/ui";
import { type FormEvent, startTransition, useActionState } from "react";
import type { ProfileResult } from "../people/actions.ts";

/**
 * Your own name, on Your account (screen S-51, docs/design/
 * account-self-service.md D22, D23, plan 0.8.0 Y5).
 *
 * Saved through `people.updateOwnProfile`, which writes this workspace's
 * member row and the account's name together; another workspace keeps the
 * name it has. A refusal stands under the field and keeps what was typed,
 * submitted through a transition because React resets a form after its
 * action.
 */
export function NameForm({
  name,
  action,
}: {
  readonly name: string;
  readonly action: (
    previous: ProfileResult | null,
    form: FormData,
  ) => Promise<ProfileResult>;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);
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
      data-testid="own-name"
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-end gap-2">
        <RefusedFields fields={state?.fields}>
          <TextInput
            name="name"
            label={t("common.name")}
            defaultValue={name}
            maxLength={200}
            autoComplete="name"
            required
            className="min-w-56 flex-1"
            data-testid="account-name"
          />
        </RefusedFields>
        <Button type="submit" size="sm" pending={pending}>
          {t("common.save")}
        </Button>
      </div>
      {state && !state.ok && !state.fields ? (
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
