"use client";

import {
  IdentifierInput,
  SecretInput,
  SettingsSaveBar,
  useTranslations,
} from "@openokr/ui";
import { useActionState, useEffect, useRef, useState } from "react";
import { connectProvider } from "./actions.ts";
import { NOTHING_YET } from "./form-state.ts";

/** One box of a provider's connect form, labelled as the provider labels it. */
export interface CredentialField {
  /** What the action reads, the same four names for every provider. */
  readonly name: string;
  readonly label: string;
  /** A secret is masked with a reveal; an id is shown, monospace. */
  readonly secret: boolean;
}

/**
 * The provider's credential boxes with a footer save bar (docs/design/
 * settings-page-layout.md). Returns the form body and the footer as siblings,
 * so the caller puts both directly inside the card.
 *
 * **Empty every time, never pre-filled.** The credential went in once and the
 * product cannot read it back, so neither can this form. Everything typed is
 * therefore unsaved, and the bar names the boxes that hold something.
 *
 * **The button says "Connect".** Pressing it stores the credential and
 * connects the provider in one step, which "Save changes" would understate.
 */
export function CredentialForm({
  provider,
  fields,
  hint,
}: {
  readonly provider: string;
  readonly fields: readonly CredentialField[];
  /** Where the provider shows what its fields ask for, already translated. */
  readonly hint: string;
}) {
  const { t } = useTranslations();
  const formId = `channel-credentials-${provider}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    connectProvider,
    NOTHING_YET,
  );
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);

  const read = () => {
    const element = formRef.current;
    if (!element) {
      return;
    }
    const data = new FormData(element);
    setUnsaved(
      fields
        .filter((field) => String(data.get(field.name) ?? "").trim() !== "")
        .map((field) => field.label),
    );
  };

  // The browser or React resets the boxes after an answer, and what was typed
  // is no longer there to be unsaved.
  useEffect(() => {
    if (state !== NOTHING_YET) {
      setUnsaved([]);
    }
  }, [state]);

  const span =
    fields.length >= 4
      ? "col-span-12 md:col-span-3"
      : fields.length === 3
        ? "col-span-12 md:col-span-4"
        : fields.length === 2
          ? "col-span-12 md:col-span-6"
          : "col-span-12";

  return (
    <>
      <form
        ref={formRef}
        id={formId}
        action={formAction}
        autoComplete="off"
        onInput={read}
        onChange={read}
        onReset={() => setUnsaved([])}
        aria-busy={pending}
        className="grid grid-cols-12 gap-x-6 gap-y-4 p-3.5"
      >
        <input type="hidden" name="provider" value={provider} />
        {fields.map((field) =>
          field.secret ? (
            <SecretInput
              key={field.name}
              className={span}
              label={field.label}
              name={field.name}
              // Provider keys, never the member's own password: stop the
              // browser and password managers offering saved logins.
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              data-form-type="other"
            />
          ) : (
            <IdentifierInput
              key={field.name}
              className={span}
              label={field.label}
              name={field.name}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore
              data-form-type="other"
            />
          ),
        )}
        <p className="col-span-12 text-xs text-ink-3">{hint}</p>
      </form>
      <SettingsSaveBar
        mode="footer"
        formId={formId}
        saveLabel={t("common.connect")}
        unsaved={unsaved}
        saved={state.ok && state.message ? state.message : null}
        error={state.ok ? null : state.message}
        pending={pending}
      />
    </>
  );
}
