"use client";

import {
  Button,
  CopyButton,
  RefusedFields,
  SubmitButton,
  useTranslations,
} from "@openokr/ui";
import { type FormEvent, type ReactNode, useActionState } from "react";
import { NOTHING_YET, type WebhookResult } from "./form-state.ts";

type Action = (
  previous: WebhookResult | null,
  form: FormData,
) => Promise<WebhookResult>;

/**
 * A webhook form whose fields the server page draws (outbound-webhooks.md §3).
 *
 * Each kit field shows what was refused about it, and a refusal no field
 * claims, the events, is said under the form (guided-inputs §4.2). A create
 * and a rotation answer with the signing secret, which is shown here from the
 * action's own answer and nowhere else: the table holds it sealed, so there is
 * no second render that could show it again.
 */
export function WebhookForm({
  action,
  submitLabel,
  hidden,
  confirm,
  testId,
  children,
}: {
  readonly action: Action;
  readonly submitLabel: string;
  readonly hidden?: Readonly<Record<string, string>>;
  /** Asked before sending, for a write that cannot be taken back. */
  readonly confirm?: string;
  readonly testId?: string;
  readonly children?: ReactNode;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  const ask = (event: FormEvent<HTMLFormElement>) => {
    if (confirm && !window.confirm(confirm)) {
      event.preventDefault();
    }
  };
  return (
    <form
      action={formAction}
      onSubmit={ask}
      className="flex flex-col gap-3"
      aria-busy={pending}
      data-testid={testId}
    >
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <RefusedFields fields={state.fields}>{children}</RefusedFields>
      {children ? (
        <SubmitButton className="self-start">
          {pending ? t("admin.webhooks.working") : submitLabel}
        </SubmitButton>
      ) : (
        <Button
          type="submit"
          size="sm"
          className="self-start"
          disabled={pending}
        >
          {submitLabel}
        </Button>
      )}
      {state.secret ? (
        <div
          className="flex flex-col gap-1.5 rounded-md bg-brand-weak px-2.5 py-2 text-xs text-brand-text"
          data-testid="webhook-secret"
        >
          <span className="font-semibold">
            {t("admin.webhooks.secret.title")}
          </span>
          <code className="break-all font-mono text-sm font-bold">
            {state.secret}
          </code>
          <span>{t("admin.webhooks.secret.once")}</span>
          <CopyButton text={state.secret} size="sm">
            {t("admin.webhooks.secret.copy")}
          </CopyButton>
        </div>
      ) : null}
      {state.message ? (
        state.ok ? (
          <p role="status" className="text-xs text-ink-2">
            {state.message}
          </p>
        ) : (
          <p
            role="alert"
            className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
          >
            {state.message}
          </p>
        )
      ) : null}
    </form>
  );
}
