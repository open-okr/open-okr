"use client";

import { HEX_COLOUR_HTML_PATTERN } from "@openokr/formats";
import { Button, Card, CardBody, useTranslations } from "@openokr/ui";
import { type FormEvent, startTransition, useActionState } from "react";
import { submitBranding } from "./actions.ts";
import { NOTHING_SAVED } from "./branding-state.ts";

/**
 * The branding admin card (screen S-36, P2-T08). One field: the primary
 * colour. Empty means the product's own default theme, not an unanswered
 * question, so clearing the field is a valid save.
 *
 * **It really was a card, and it took until P8-G08 to look like one.** P2-T08
 * left this as `<p><label><br><input>` and two browser-default submit buttons,
 * which Tailwind's reset rendered as a line of grey placeholder text and two
 * lines of plain black text. It was rebuilt to the pattern
 * `general-settings-form.tsx` uses.
 *
 * **What it says is in force now is in force** (completeness review M-14). The
 * card said a saved colour was "in force across this workspace" while every
 * screen stayed indigo, because nothing read the setting. The root layout now
 * turns it into the brand tokens, so the sentence is true, and the card says
 * the two things it could otherwise hide: when the colour was too light to
 * carry white text and a darker shade was used, and when a stored colour is a
 * status hue and is not applied at all.
 *
 * **A client component since M-14**, because a refusal has to reach the
 * screen. Submitted through a transition, as the plan card is, so a refused
 * colour stays in the field under the sentence explaining why rather than
 * being reset out from under it.
 */

const INPUT_CLASS =
  "rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line";

const LABEL_CLASS =
  "flex w-full max-w-sm flex-col gap-1 text-xs font-semibold text-ink-2";

export interface BrandingStatus {
  /** The stored colour when it is a six-digit hex, otherwise null. */
  readonly stored: string | null;
  /** `--brand` as the layout applies it, or null when nothing is applied. */
  readonly fill: string | null;
  /** The chosen colour was too light for white text and was darkened. */
  readonly adjusted: boolean;
}

export function BrandingSettingsForm({ status }: { status: BrandingStatus }) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    submitBranding,
    NOTHING_SAVED,
  );

  // Carries the pressed button's `intent`, which a FormData built from the
  // form alone would leave out.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };

  const { stored, fill, adjusted } = status;
  const statusLine =
    stored === null
      ? t("admin.branding.brandingSettingsForm.emptyIsTheDefault")
      : fill === null
        ? t("admin.branding.brandingSettingsForm.notApplied", {
            colour: stored,
          })
        : adjusted
          ? t("admin.branding.brandingSettingsForm.adjusted", {
              colour: stored,
              fill,
            })
          : t("admin.branding.brandingSettingsForm.inForce", {
              colour: stored,
            });

  return (
    <Card>
      <CardBody>
        <form
          // Keyed on what is stored, so a save or a reset shows the new value
          // rather than the field's first one.
          key={stored ?? ""}
          action={formAction}
          onSubmit={submit}
          aria-busy={pending}
          className="flex flex-col gap-3"
        >
          <label htmlFor="primaryColor" className={LABEL_CLASS}>
            {t("admin.branding.brandingSettingsForm.primaryColourHex")}
            <span className="flex items-center gap-2">
              <input
                id="primaryColor"
                name="primaryColor"
                placeholder="#336699"
                defaultValue={stored ?? ""}
                pattern={HEX_COLOUR_HTML_PATTERN}
                title={t("admin.branding.brandingSettingsForm.sixHexDigits")}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={state.error === null ? undefined : true}
                aria-describedby="primaryColorStatus"
                className={`${INPUT_CLASS} flex-1 font-mono`}
              />
              {/*
               * The colour in force, drawn rather than described. A hex code
               * is not something a person can picture, and this card exists to
               * choose one. It is the fill the layout applies, which is not the
               * typed colour when that one was darkened. `aria-hidden` because
               * the sentence below says the same in text.
               */}
              <span
                aria-hidden
                data-testid="brand-swatch"
                className="size-7 flex-none rounded-control border border-line-2"
                style={fill === null ? undefined : { backgroundColor: fill }}
              />
            </span>
          </label>
          <p id="primaryColorStatus" className="max-w-sm text-xs text-ink-3">
            {statusLine}
          </p>
          {state.error === null ? null : (
            <p role="alert" className="max-w-sm text-xs font-medium text-bad">
              {state.error}
            </p>
          )}
          {state.saved === null ? null : (
            <p role="status" className="max-w-sm text-xs text-ink-2">
              {state.saved}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3">
            <Button
              type="submit"
              name="intent"
              value="save"
              variant="primary"
              size="sm"
              disabled={pending}
            >
              {t("common.save")}
            </Button>
            <Button
              type="submit"
              name="intent"
              value="reset"
              variant="ghost"
              size="sm"
              disabled={pending}
            >
              {t("common.resetToDefaults")}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
