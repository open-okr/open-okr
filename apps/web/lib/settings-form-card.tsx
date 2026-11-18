"use client";

import { Card, CardBody, SettingsSaveBar, useFormDirty } from "@openokr/ui";
import { type FormEvent, type ReactNode, useRef, useTransition } from "react";

/**
 * A settings card whose save is a server action that returns nothing, with
 * the shared save bar as its last child (docs/design/settings-page-layout.md
 * §A, §C).
 *
 * The cards on Admin, General that are server components (instance name,
 * registration, email confirmation, update check) pass their fields in as
 * children and their own action in as `action`. This client shell adds what a
 * server component cannot: the unsaved status, Discard through a form reset,
 * and the sending state. It only holds native fields, so `useFormDirty` sees
 * every edit through the form's own events.
 *
 * Those actions return nothing and refuse quietly, so the bar has no "Saved."
 * line to show. After a send the typed values are the new baseline and the
 * bar goes back to idle.
 */
export function SettingsFormCard({
  formId,
  testId,
  header,
  unsavedLabel,
  action,
  children,
}: {
  readonly formId: string;
  readonly testId: string;
  /** The card's `CardHeader`, drawn on the server. */
  readonly header: ReactNode;
  /** What the bar names while the card holds an edit. */
  readonly unsavedLabel: string;
  readonly action: (formData: FormData) => Promise<void>;
  /** The fields, as direct children of a 12-column grid. */
  readonly children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const { dirty, markSaved } = useFormDirty(form);
  const [pending, send] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    send(async () => {
      await action(data);
      markSaved();
    });
  };

  return (
    <Card data-testid={testId}>
      {header}
      <CardBody>
        <form
          ref={form}
          id={formId}
          onSubmit={submit}
          // The browser puts the defaults back after this event, so the
          // baseline is read once that has happened.
          onReset={() => setTimeout(markSaved, 0)}
          aria-busy={pending}
          className="grid grid-cols-12 gap-x-6 gap-y-4 [&>ul]:col-span-12"
        >
          {children}
        </form>
      </CardBody>
      <SettingsSaveBar
        mode="footer"
        formId={formId}
        unsaved={dirty ? [unsavedLabel] : []}
        saved={null}
        error={null}
        pending={pending}
      />
    </Card>
  );
}
