"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  RefusedFields,
  SettingsSaveBar,
} from "@openokr/ui";
import { type ReactNode, useActionState, useEffect, useState } from "react";
import { type FormResult, NOTHING_YET } from "./form-state.ts";

/**
 * A card that lists records and hides its add form behind a button in the
 * header (docs/design/settings-page-layout.md). The form has the card's footer
 * save bar; its Discard clears the fields and closes the form. Removing a
 * record stays an instant action in the list, as it was.
 */
export function AddCard({
  title,
  intro,
  addLabel,
  submitLabel,
  action,
  list,
  children,
  "data-testid": testId,
}: {
  readonly title: string;
  readonly intro: string;
  /** The header button's label, such as "Add a model". */
  readonly addLabel: string;
  /** The footer button's label, such as "Add". */
  readonly submitLabel: string;
  readonly action: (
    previous: FormResult,
    form: FormData,
  ) => Promise<FormResult>;
  /** The records, or the sentence that says there are none. */
  readonly list: ReactNode;
  /** The form's fields. */
  readonly children: ReactNode;
  readonly "data-testid"?: string;
}) {
  const formId = `${testId ?? "ai-add"}-form`;
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);

  // An accepted add closes the form and leaves its message in the card.
  useEffect(() => {
    if (state !== NOTHING_YET && state.ok) {
      setOpen(false);
      setDirty(false);
    }
  }, [state]);

  return (
    <Card data-testid={testId}>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">{title}</h2>
          <p className="text-xs text-ink-3">{intro}</p>
        </div>
        <Button
          type="button"
          size="sm"
          aria-expanded={open}
          aria-controls={formId}
          onClick={() => setOpen((value) => !value)}
        >
          {addLabel}
        </Button>
      </CardHeader>
      <CardBody className="flex flex-col gap-2.5">
        {list}
        {!open && state.ok && state.message ? (
          <p role="status" className="text-xs text-ok">
            {state.message}
          </p>
        ) : null}
      </CardBody>
      {open ? (
        <>
          <form
            id={formId}
            action={formAction}
            onInput={() => setDirty(true)}
            onChange={() => setDirty(true)}
            onReset={() => {
              setDirty(false);
              setOpen(false);
            }}
            aria-busy={pending}
            className="flex flex-col gap-3 border-t border-line p-3.5"
          >
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-3">
              {addLabel}
            </h3>
            <RefusedFields fields={state.fields}>{children}</RefusedFields>
          </form>
          <SettingsSaveBar
            mode="footer"
            formId={formId}
            unsaved={dirty ? [addLabel] : []}
            saved={null}
            error={state.ok ? null : state.message || null}
            pending={pending}
            saveLabel={submitLabel}
          />
        </>
      ) : null}
    </Card>
  );
}
