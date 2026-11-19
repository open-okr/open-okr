"use client";

import { LOCALES } from "@openokr/formats";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  SelectInput,
  SettingsSaveBar,
  TimezoneSelect,
  TokenInput,
  useTranslations,
} from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useState,
} from "react";
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
 * action. Reset to defaults sits in the card header and Save changes in the
 * save bar under the body; both reach the form through `form=`
 * (docs/design/settings-page-layout.md). The page owns what is unsaved, so the
 * bar can name the parts, and Discard puts the card back to what is stored.
 */

const FORM_ID = "general-defaults-form";

interface Values {
  readonly timezone: string | null;
  readonly language: string;
  readonly domains: string;
  readonly secondFactor: boolean;
}

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

  // Which button sent the form, so only that one spins. `useFormStatus` cannot
  // say: this form handles `onSubmit` itself and `preventDefault`s it.
  const [acting, setActing] = useState<string | null>(null);

  // Carries the pressed button's `intent`, which a FormData built from the
  // form alone would leave out.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    setActing(submitter instanceof HTMLButtonElement ? submitter.value : null);
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  };

  const trustedEmailDomains = Array.isArray(settings.trustedEmailDomains)
    ? (settings.trustedEmailDomains as string[])
    : [];

  const stored: Values = {
    timezone: typeof settings.timezone === "string" ? settings.timezone : null,
    language: String(settings.language ?? "en"),
    domains: trustedEmailDomains.join(","),
    secondFactor: settings.requireSecondFactor === true,
  };
  const storedKey = JSON.stringify([
    settings.timezone,
    settings.language,
    settings.trustedEmailDomains,
    settings.requireSecondFactor,
  ]);
  const [baseline, setBaseline] = useState<Values>(stored);
  const [current, setCurrent] = useState<Values>(stored);
  // Bumped by Discard, so the fields that keep their own state (the zone
  // picker, the domain chips) start again from what is stored.
  const [discards, setDiscards] = useState(0);
  const change = (patch: Partial<Values>) =>
    setCurrent((previous) => ({ ...previous, ...patch }));

  // What is stored is the baseline whenever it changes: after a save, a
  // reset, or a rename in another tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised values on purpose.
  useEffect(() => {
    setBaseline(stored);
    setCurrent(stored);
  }, [storedKey]);

  const unsaved: string[] = [];
  if (current.timezone !== baseline.timezone) {
    unsaved.push(t("common.timezone"));
  }
  if (current.language !== baseline.language) {
    unsaved.push(t("admin.general.generalSettingsForm.language"));
  }
  if (current.domains !== baseline.domains) {
    unsaved.push(
      t("admin.general.generalSettingsForm.trustedEmailDomainsComma"),
    );
  }
  if (current.secondFactor !== baseline.secondFactor) {
    unsaved.push(t("admin.general.generalSettingsForm.requireSecondFactor"));
  }

  return (
    <Card data-testid="general-defaults-card">
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("admin.general.defaults.title")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.general.defaults.hint")}
          </p>
        </div>
        <Button
          type="submit"
          form={FORM_ID}
          name="intent"
          value="reset"
          variant="ghost"
          size="sm"
          disabled={pending}
          pending={pending && acting === "reset"}
        >
          {t("common.resetToDefaults")}
        </Button>
      </CardHeader>
      <CardBody>
        <form
          // Keyed on what is stored, so a save or a reset shows the new
          // values, while a refused save keeps what was typed to be corrected.
          key={`${storedKey}-${discards}`}
          id={FORM_ID}
          action={formAction}
          onSubmit={submit}
          onReset={() => {
            setCurrent(baseline);
            setDiscards((count) => count + 1);
          }}
          aria-busy={pending}
          className="grid grid-cols-12 gap-x-6 gap-y-4 [&>ul]:col-span-12"
        >
          <div className="col-span-12 md:col-span-6">
            <TimezoneSelect
              label={t("common.timezone")}
              name="timezone"
              error={state.fields?.timezone}
              zones={zones}
              defaultValue={stored.timezone}
              onValueChange={(zone) => change({ timezone: zone })}
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
            error={state.fields?.language}
            defaultValue={stored.language}
            className="col-span-12 md:col-span-6"
            onChange={(event) =>
              change({ language: event.currentTarget.value })
            }
          >
            {LOCALES.filter((l) => l.shipped).map((l) => (
              <option key={l.code} value={l.code}>
                {t(l.endonymKey)}
              </option>
            ))}
            {settings.language &&
            !LOCALES.filter((l) => l.shipped).some(
              (l) => l.code === settings.language,
            ) ? (
              <option value={String(settings.language)}>
                {String(settings.language)}
              </option>
            ) : null}
          </SelectInput>
          {/* Each domain a chip, checked by the rule the server applies
              (guided-inputs §4.11). The hint says what the setting does and the one condition it needs (completeness review M-34): it saved
              and did nothing for as long as nothing offered it, and an
              instance with no mail confirms no address, so it still admits
              nobody there. */}
          <TokenInput
            id="trustedEmailDomains"
            label={t(
              "admin.general.generalSettingsForm.trustedEmailDomainsComma",
            )}
            name="trustedEmailDomains"
            error={state.fields?.trustedEmailDomains}
            rule="domain"
            defaultValue={trustedEmailDomains}
            description={t(
              "admin.general.generalSettingsForm.trustedEmailDomainsHint",
            )}
            className="col-span-12"
            onValueChange={(entries) => change({ domains: entries.join(",") })}
          />
          <div className="col-span-12 flex flex-col gap-1 border-line border-t pt-4">
            <label
              htmlFor="requireSecondFactor"
              className="flex items-center gap-2 text-sm text-ink-2"
            >
              <input
                type="checkbox"
                id="requireSecondFactor"
                name="requireSecondFactor"
                defaultChecked={stored.secondFactor}
                onChange={(event) =>
                  change({ secondFactor: event.currentTarget.checked })
                }
                className="rounded"
              />
              {t("admin.general.generalSettingsForm.requireSecondFactor")}
            </label>
            <p className="text-xs text-ink-3">
              {t("admin.general.generalSettingsForm.requireSecondFactorHint")}
            </p>
          </div>
        </form>
      </CardBody>
      <SettingsSaveBar
        mode="footer"
        formId={FORM_ID}
        unsaved={unsaved}
        saved={unsaved.length > 0 ? null : state.saved}
        error={state.error}
        pending={pending}
        savePending={pending && acting === "save"}
      />
    </Card>
  );
}
