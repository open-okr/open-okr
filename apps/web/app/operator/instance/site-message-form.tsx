"use client";

import { DateTimeInput, useTranslations } from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
} from "react";
import type { SiteMessageState } from "./site-message-actions";

/**
 * Writing a site message, on S-47 (P8-T03c).
 *
 * **The window is two required fields rather than an optional end date**, and
 * the form says why in one line rather than leaving somebody to discover the
 * refusal. A message with no end is a banner everybody learns to ignore, and
 * the next one is ignored with it.
 *
 * A refusal is said under the button and what was typed stays to be
 * corrected (guided-inputs §5, F5), submitted through a transition as the plan
 * form is. The form clears itself only once the message is saved.
 */
export function SiteMessageForm({
  action,
  workspaces,
}: {
  readonly action: (formData: FormData) => Promise<SiteMessageState>;
  readonly workspaces: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (_previous: SiteMessageState | null, formData: FormData) =>
      action(formData),
    null,
  );
  // `action` stays on the form, so it still works before the page hydrates.
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
    <form
      action={formAction}
      onSubmit={submit}
      ref={form}
      aria-busy={pending}
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-col gap-1.5">
        <label className="font-medium text-ink text-sm" htmlFor="body">
          {t("operator.siteMessage.message")}
        </label>
        <textarea
          className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
          id="body"
          maxLength={1000}
          name="body"
          placeholder={t("operator.siteMessage.placeholder")}
          required
          rows={3}
        />
        <p className="text-ink-3 text-xs">
          {t("operator.siteMessage.plainText")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-ink text-sm" htmlFor="level">
            {t("operator.siteMessage.tone")}
          </label>
          <select
            className="rounded-md border border-line bg-bg px-3 py-2 text-ink text-sm"
            defaultValue="info"
            id="level"
            name="level"
          >
            <option value="info">
              {t("operator.siteMessage.toneInformation")}
            </option>
            <option value="warn">
              {t("operator.siteMessage.toneWarning")}
            </option>
            <option value="bad">
              {t("operator.siteMessage.toneIncident")}
            </option>
          </select>
        </div>
        <DateTimeInput
          label={t("operator.siteMessage.showsFrom")}
          id="startsAt"
          name="startsAt"
          zoneName="startsAtZone"
          required
        />
        <div className="flex flex-col gap-1.5">
          <DateTimeInput
            label={t("operator.siteMessage.stopsAt")}
            id="endsAt"
            name="endsAt"
            zoneName="endsAtZone"
            required
          />
          {/* Said once, here, rather than left for somebody to meet as a
           * refusal after typing everything else. */}
          <p className="text-ink-3 text-xs">
            {t("operator.siteMessage.endRequired")}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-ink text-sm">
          {t("operator.siteMessage.whoSeesIt")}
        </span>
        <p className="text-ink-3 text-xs">
          {t("operator.siteMessage.everybodyUnlessNamed")}
        </p>
        {workspaces.length > 0 ? (
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2">
            {workspaces.map((workspace) => (
              <label
                className="flex items-center gap-2 text-ink text-sm"
                htmlFor={`target-${workspace.id}`}
                key={workspace.id}
              >
                <input
                  id={`target-${workspace.id}`}
                  name="target"
                  type="checkbox"
                  value={workspace.id}
                />
                {workspace.name}
              </label>
            ))}
          </div>
        ) : null}
      </div>

      <label
        className="flex items-center gap-2 text-ink text-sm"
        htmlFor="dismissible"
      >
        <input
          defaultChecked
          id="dismissible"
          name="dismissible"
          type="checkbox"
        />
        {t("operator.siteMessage.canDismiss")}
      </label>

      <button
        className="self-start rounded-md bg-brand px-4 py-2 font-medium text-on-brand text-sm hover:bg-brand-strong disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {t("operator.siteMessage.submit")}
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
          {t("operator.siteMessage.done")}
        </p>
      ) : null}
    </form>
  );
}
