"use client";

import {
  Card,
  CardBody,
  CardHeader,
  NumberInput,
  SelectInput,
  SettingsSaveBar,
  TimeInput,
  useTranslations,
} from "@openokr/ui";
import {
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LinkResult } from "./link-state.ts";

const FORM_ID = "channels-cadence-form";

interface Values {
  readonly mentionImmediate: boolean;
  readonly batch: number | null;
  readonly dailySummary: boolean;
  readonly time: string;
  readonly routing: Readonly<Record<string, string>>;
}

/**
 * How often the product writes to you (S-36 member card, P6-G08).
 *
 * **The member half of TECHNICAL-PLAN §4.14 had no surface.** Per-reason
 * routing, the batching window, the daily summary and its time have been
 * stored in `notification_settings` since P2-T06, read by `notifyRecipients`
 * on every fan-out and by the Champion's daily run since P4-T05b, and there
 * was no way to see any of it or change it. `/account/channels` covered the
 * primary channel and quiet hours only. The gap audit recorded it under B-06.
 *
 * **Every field arrives with a value, so the form never blocks.** The row is
 * created lazily and the registry's defaults are the table's defaults, which
 * is what makes a member who has never opened this page already correctly
 * configured. The inputs are therefore pre-filled rather than empty with
 * placeholders.
 *
 * A client component because it is one form with a submit state. It owns its
 * card so the save bar can be the card's last child (docs/design/
 * settings-page-layout.md), and tracks what changed so the bar can name it.
 *
 * **The summary time is disabled while the summary is off**, and the action
 * reads the posted time, so a disabled input (which posts nothing) is backed
 * by a hidden one carrying the same value. Turning the summary off never
 * drops a time somebody set.
 */
export function CadenceForm({
  action,
  settings,
  reasons,
  channels,
  timezone,
}: {
  readonly action: (
    previous: LinkResult | null,
    form: FormData,
  ) => Promise<LinkResult>;
  readonly settings: {
    readonly mentionImmediate: boolean;
    readonly batchWindowMinutes: number;
    readonly dailySummary: boolean;
    readonly dailySummaryTime: string;
    readonly routing: Readonly<Record<string, string>>;
  };
  /** Each reason and the words for it, in registry order. */
  readonly reasons: readonly { readonly id: string; readonly label: string }[];
  readonly channels: readonly { readonly id: string; readonly label: string }[];
  /** The member's own zone, which the summary's hour is read in. */
  readonly timezone: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);

  const fromSettings: Values = {
    mentionImmediate: settings.mentionImmediate,
    batch: settings.batchWindowMinutes,
    dailySummary: settings.dailySummary,
    time: settings.dailySummaryTime,
    routing: settings.routing,
  };
  const [baseline, setBaseline] = useState<Values>(fromSettings);
  const [current, setCurrent] = useState<Values>(fromSettings);
  const sent = useRef<Values>(current);
  // The server's values are the baseline whenever they change.
  const serverKey = JSON.stringify(fromSettings);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialised values on purpose.
  useEffect(() => {
    setBaseline(fromSettings);
  }, [serverKey]);

  const change = (patch: Partial<Values>) =>
    setCurrent((previous) => ({ ...previous, ...patch }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sent.current = current;
    startTransition(() => formAction(new FormData(event.currentTarget)));
  };

  useEffect(() => {
    if (state?.ok) {
      setBaseline(sent.current);
    }
  }, [state]);

  const unsaved: string[] = [];
  if (current.mentionImmediate !== baseline.mentionImmediate) {
    unsaved.push(t("account.channels.cadenceForm.tellMeTheMoment"));
  }
  if (current.batch !== baseline.batch) {
    unsaved.push(t("account.channels.cadenceForm.groupEverythingElseInto"));
  }
  if (current.dailySummary !== baseline.dailySummary) {
    unsaved.push(t("account.channels.cadenceForm.sendMeASummary"));
  }
  if (current.time !== baseline.time) {
    unsaved.push(t("account.channels.cadenceForm.at"));
  }
  for (const reason of reasons) {
    if (
      (current.routing[reason.id] ?? "") !== (baseline.routing[reason.id] ?? "")
    ) {
      unsaved.push(reason.label);
    }
  }

  return (
    <Card data-testid="channels-cadence-card">
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("account.channels.howOften")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("account.channels.theMemberHalfOf")}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form
          id={FORM_ID}
          action={formAction}
          onSubmit={submit}
          onReset={() => setCurrent(baseline)}
          aria-busy={pending}
          className="grid grid-cols-12 gap-x-6 gap-y-4"
        >
          <label className="col-span-12 flex items-start gap-2.5 text-sm text-ink md:col-span-6">
            <input
              type="checkbox"
              name="mentionImmediate"
              defaultChecked={settings.mentionImmediate}
              onChange={(event) =>
                change({ mentionImmediate: event.currentTarget.checked })
              }
              className="mt-0.5 size-4"
            />
            <span>
              {t("account.channels.cadenceForm.tellMeTheMoment")}
              <span className="ml-1.5 text-xs text-ink-3">
                {t("account.channels.cadenceForm.everythingElseWaitsFor")}
              </span>
            </span>
          </label>

          <NumberInput
            label={t("account.channels.cadenceForm.groupEverythingElseInto")}
            name="batchWindowMinutes"
            min={1}
            max={1440}
            step={1}
            defaultValue={settings.batchWindowMinutes}
            description={t(
              "account.channels.cadenceForm.minutesAShorterWindow",
            )}
            className="col-span-12 md:col-span-6"
            onValueChange={(next) => change({ batch: next })}
          />

          <label className="col-span-12 flex items-start gap-2.5 text-sm text-ink md:col-span-6">
            <input
              type="checkbox"
              name="dailySummary"
              defaultChecked={settings.dailySummary}
              onChange={(event) =>
                change({ dailySummary: event.currentTarget.checked })
              }
              className="mt-0.5 size-4"
            />
            <span>{t("account.channels.cadenceForm.sendMeASummary")}</span>
          </label>

          <div className="col-span-12 md:col-span-6">
            <TimeInput
              label={t("account.channels.cadenceForm.at")}
              name="dailySummaryTime"
              value={current.time}
              disabled={!current.dailySummary}
              onValueChange={(next) => change({ time: next ?? "" })}
              description={t("account.channels.cadenceForm.inYourOwnTimezone", {
                timezone,
              })}
            />
            {current.dailySummary ? null : (
              <input
                type="hidden"
                name="dailySummaryTime"
                value={current.time}
              />
            )}
          </div>

          <div className="col-span-12 border-line border-t" />

          <fieldset className="contents">
            <legend className="col-span-12 text-sm font-semibold text-ink">
              {t("account.channels.cadenceForm.whereEachKindGoes")}
            </legend>
            <p className="col-span-12 -mt-2 text-xs text-ink-3">
              {t("account.channels.cadenceForm.leaveOneOnWherever")}
            </p>
            {reasons.map((reason) => (
              <SelectInput
                label={reason.label}
                name={`routing.${reason.id}`}
                defaultValue={settings.routing[reason.id] ?? ""}
                className="col-span-12 md:col-span-6"
                key={reason.id}
                onChange={(event) =>
                  change({
                    routing: {
                      ...current.routing,
                      [reason.id]: event.currentTarget.value,
                    },
                  })
                }
              >
                <option value="">
                  {t("account.channels.cadenceForm.whereverISaid")}
                </option>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.label}
                  </option>
                ))}
              </SelectInput>
            ))}
          </fieldset>
        </form>
      </CardBody>
      <SettingsSaveBar
        mode="footer"
        formId={FORM_ID}
        unsaved={unsaved}
        saved={state?.ok ? state.message : null}
        error={state && !state.ok ? state.message : null}
        pending={pending}
      />
    </Card>
  );
}
