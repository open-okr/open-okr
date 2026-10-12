"use client";

import {
  Button,
  Card,
  CardBody,
  SelectInput,
  TimezoneSelect,
  TokenInput,
  useTranslations,
} from "@openokr/ui";
import { type FormEvent, startTransition, useActionState } from "react";
import { submitGeneral } from "./actions.ts";
import { NOTHING_SAVED } from "./general-state.ts";

/**
 * The general admin card (screen S-36, P2-T08): timezone, language and
 * trusted email domains, one save for the whole card.
 *
 * **A refusal is said on the card.** It used to fail quietly, and a mistyped
 * timezone or domain sent the administrator to the error page instead. The
 * save now hands back why, in words, beside the button that was pressed.
 *
 * **It really was a card, and it took until now to look like one.** P2-T08
 * left this as three `<p><label><br><input>` groups and two browser-default
 * submit buttons, and Tailwind's reset strips an input's border, so the three
 * settings rendered as bare text with no visible field to type in. The state
 * card directly below it has been drawn properly since P6-G25, which is what
 * made the difference obvious.
 *
 * **One form, two buttons.** Save and Reset carry their own `intent` to one
 * action, because a form cannot nest inside another and the two controls
 * belong on one row.
 */

export function GeneralSettingsForm({
  settings,
  zones,
}: {
  settings: Record<string, unknown>;
  /** The server's own list, so the card offers only what it will accept. */
  zones: readonly string[];
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    submitGeneral,
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

  const trustedEmailDomains = Array.isArray(settings.trustedEmailDomains)
    ? (settings.trustedEmailDomains as string[])
    : [];

  return (
    <Card>
      <CardBody>
        <form
          // Keyed on what is stored, so a save or a reset shows the new
          // values, while a refused save keeps what was typed to be corrected.
          key={JSON.stringify([
            settings.timezone,
            settings.language,
            settings.trustedEmailDomains,
            settings.requireSecondFactor,
          ])}
          action={formAction}
          onSubmit={submit}
          aria-busy={pending}
          className="flex flex-col gap-3"
        >
          <div className="w-full max-w-sm">
            <TimezoneSelect
              label={t("common.timezone")}
              name="timezone"
              zones={zones}
              defaultValue={
                typeof settings.timezone === "string" ? settings.timezone : null
              }
            />
          </div>
          {/* A picker of the catalogues that exist, not a text box that
           * expected somebody to know to type "ms" (completeness review
           * M-15). A value stored before this that is neither stays
           * listed, so saving the card never changes it by accident. */}
          <SelectInput
            id="language"
            label={t("admin.general.generalSettingsForm.language")}
            name="language"
            defaultValue={String(settings.language ?? "en")}
            className="max-w-sm"
          >
            <option value="en">{t("appearance.english")}</option>
            <option value="ms">{t("appearance.bahasaMelayu")}</option>
            {settings.language &&
            settings.language !== "en" &&
            settings.language !== "ms" ? (
              <option value={String(settings.language)}>
                {String(settings.language)}
              </option>
            ) : null}
          </SelectInput>
          {/* Each domain a chip, checked by the rule the server applies
              (guided-inputs §4.11). The hint says what the setting does and
              the one condition it needs (completeness review M-34): it saved
              and did nothing for as long as nothing offered it, and an
              instance with no mail confirms no address, so it still admits
              nobody there. */}
          <TokenInput
            id="trustedEmailDomains"
            label={t(
              "admin.general.generalSettingsForm.trustedEmailDomainsComma",
            )}
            name="trustedEmailDomains"
            rule="domain"
            defaultValue={trustedEmailDomains}
            description={t(
              "admin.general.generalSettingsForm.trustedEmailDomainsHint",
            )}
            className="max-w-sm"
          />
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <label
              htmlFor="requireSecondFactor"
              className="flex items-center gap-2 text-sm text-ink-2"
            >
              <input
                type="checkbox"
                id="requireSecondFactor"
                name="requireSecondFactor"
                defaultChecked={settings.requireSecondFactor === true}
                className="rounded"
              />
              {t("admin.general.generalSettingsForm.requireSecondFactor")}
            </label>
            <p className="text-xs text-ink-3">
              {t("admin.general.generalSettingsForm.requireSecondFactorHint")}
            </p>
          </div>
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
