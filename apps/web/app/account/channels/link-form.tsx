"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ChannelLogo,
  type ChannelLogoChannel,
  Chip,
  SettingsSaveBar,
  type TimeRange,
  TimeRangeInput,
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
import { type LinkResult, NOTHING_YET } from "./link-state.ts";

type ChannelAction = (
  previous: LinkResult | null,
  formData: FormData,
) => Promise<LinkResult>;

const DELIVERY_FORM_ID = "channels-delivery-form";

const LOGO_CHANNELS: readonly string[] = [
  "app",
  "email",
  "slack",
  "teams",
  "whatsapp",
  "telegram",
];

/** A provider id the badge has a mark for, or null: an unknown one gets none. */
function logoChannel(id: string): ChannelLogoChannel | null {
  return LOGO_CHANNELS.includes(id) ? (id as ChannelLogoChannel) : null;
}

export interface DeliveryChoice {
  readonly id: string;
  readonly label: string;
  /** Why the channel cannot be picked, or null when it can. */
  readonly unavailableReason: string | null;
}

/**
 * The "Delivery" card: the primary channel and the quiet window, saved
 * together by `saveDelivery` (P5-T02c; docs/design/settings-page-layout.md).
 *
 * The save bar is the card's last child and reaches the form with `form=`.
 * A refusal keeps what was typed because the form is submitted through a
 * transition, which stops React resetting it after its action. After a save
 * the saved values are the new baseline, so Discard goes back to them.
 *
 * A success has no message of its own from the action (a revalidation can
 * unmount a form a message is drawn in), so the bar's own "Saved." stands in.
 */
export function DeliveryForm({
  action,
  choices,
  primaryChannel,
  quietHours,
  quietLabel,
  quietDescription,
  quietStartLabel,
  quietEndLabel,
}: {
  readonly action: ChannelAction;
  readonly choices: readonly DeliveryChoice[];
  readonly primaryChannel: string;
  readonly quietHours: TimeRange | null;
  readonly quietLabel: string;
  readonly quietDescription: string;
  readonly quietStartLabel: string;
  readonly quietEndLabel: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);
  const [baseline, setBaseline] = useState({ primaryChannel, quietHours });
  const [primary, setPrimary] = useState(primaryChannel);
  const [quiet, setQuiet] = useState<TimeRange>(
    quietHours ?? { start: null, end: null },
  );
  const sent = useRef({ primary: primaryChannel, quiet });

  useEffect(() => {
    setBaseline({ primaryChannel, quietHours });
  }, [primaryChannel, quietHours]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sent.current = { primary, quiet };
    startTransition(() => formAction(new FormData(event.currentTarget)));
  };

  useEffect(() => {
    if (state?.ok) {
      setBaseline({
        primaryChannel: sent.current.primary,
        quietHours: sent.current.quiet,
      });
    }
  }, [state]);

  const unsaved: string[] = [];
  if (primary !== baseline.primaryChannel) {
    unsaved.push(t("common.primaryChannel"));
  }
  if (
    (quiet.start ?? "") !== (baseline.quietHours?.start ?? "") ||
    (quiet.end ?? "") !== (baseline.quietHours?.end ?? "")
  ) {
    unsaved.push(t("account.channels.quietHours"));
  }

  return (
    <Card data-testid="channels-delivery-card">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("account.channels.delivery")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("account.channels.deliveryHint")}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form
          id={DELIVERY_FORM_ID}
          action={formAction}
          onSubmit={submit}
          onReset={() => {
            setPrimary(baseline.primaryChannel);
            setQuiet(baseline.quietHours ?? { start: null, end: null });
          }}
          aria-busy={pending}
          className="grid grid-cols-12 gap-x-6 gap-y-4 [&>ul]:col-span-12"
        >
          <fieldset className="contents">
            <legend className="col-span-12 mb-1 text-sm font-medium text-ink-2">
              {t("common.primaryChannel")}
            </legend>
            {choices.map((choice) => (
              <label
                key={choice.id}
                className={
                  choice.unavailableReason === null
                    ? "col-span-12 flex cursor-pointer items-center gap-2.5 rounded-control border border-line p-3 text-sm text-ink has-[:checked]:border-brand-line has-[:checked]:bg-brand-weak md:col-span-6 lg:col-span-4"
                    : "col-span-12 flex cursor-not-allowed items-center gap-2.5 rounded-control border border-line bg-raised p-3 text-sm text-ink opacity-60 md:col-span-6 lg:col-span-4"
                }
              >
                <input
                  type="radio"
                  name="primaryChannel"
                  value={choice.id}
                  defaultChecked={primaryChannel === choice.id}
                  disabled={choice.unavailableReason !== null}
                  onChange={() => setPrimary(choice.id)}
                />
                {logoChannel(choice.id) === null ? null : (
                  <ChannelLogo
                    channel={logoChannel(choice.id) as ChannelLogoChannel}
                    muted={choice.unavailableReason !== null}
                  />
                )}
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span>{choice.label}</span>
                  {choice.unavailableReason === null ? null : (
                    <span className="text-xs text-ink-3">
                      {choice.unavailableReason}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="col-span-12 border-line border-t" />

          {/* Each time is named for anybody who cannot see the heading above
              them: two bare time inputs were announced as "time" and "time"
              (P7-T05's `label` finding on this screen). */}
          <TimeRangeInput
            label={quietLabel}
            startLabel={quietStartLabel}
            endLabel={quietEndLabel}
            startName="quietStart"
            endName="quietEnd"
            defaultValue={quietHours}
            layout="grid"
            className="col-span-12"
            onValueChange={setQuiet}
          />
          <p className="col-span-12 text-xs text-ink-3">{quietDescription}</p>
        </form>
      </CardBody>
      <SettingsSaveBar
        mode="footer"
        formId={DELIVERY_FORM_ID}
        unsaved={unsaved}
        saved={
          state?.ok ? state.message || t("admin.rhythm.actions.saved") : null
        }
        error={state && !state.ok ? state.message : null}
        pending={pending}
      />
    </Card>
  );
}

export interface ProviderTile {
  readonly provider: string;
  readonly linked: boolean;
}

/**
 * The provider tiles of "Linked accounts" (P5-T02c).
 *
 * One form for every tile, so the answer (the code, or a refusal) is one
 * piece of state drawn under the tiles at full width and the tiles keep equal
 * heights. Each button posts `op` as `link:<provider>` or `unlink:<provider>`.
 *
 * **The code is rendered from the action's own answer and nowhere else.** The
 * row holds only its hash, so this is the one moment it exists. A success
 * message is unreliable by design (a revalidation can unmount a form and take
 * its state with it), so anything that matters is also drawn from server
 * state: the tile's own chip.
 */
export function LinkedAccounts({
  startLink,
  unlink,
  tiles,
}: {
  readonly startLink: ChannelAction;
  readonly unlink: ChannelAction;
  readonly tiles: readonly ProviderTile[];
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(
    async (previous: LinkResult | null, form: FormData) => {
      const [op, provider = ""] = String(form.get("op") ?? "").split(":");
      const own = new FormData();
      own.set("provider", provider);
      return op === "unlink" ? unlink(previous, own) : startLink(previous, own);
    },
    NOTHING_YET,
  );

  return (
    <form
      action={formAction}
      aria-busy={pending}
      className="grid grid-cols-12 gap-3"
    >
      {tiles.map((tile) => (
        <div
          key={tile.provider}
          className="col-span-12 flex flex-col gap-1.5 rounded-lg border border-line p-3 md:col-span-6"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              {logoChannel(tile.provider) === null ? null : (
                <ChannelLogo
                  channel={logoChannel(tile.provider) as ChannelLogoChannel}
                  size="sm"
                />
              )}
              {tile.provider}
              {tile.linked ? (
                <Chip tone="ok">{t("account.channels.linked")}</Chip>
              ) : (
                <Chip tone="neutral">{t("account.channels.notLinked")}</Chip>
              )}
            </span>
            {tile.linked ? (
              <Button
                type="submit"
                size="sm"
                name="op"
                value={`unlink:${tile.provider}`}
                disabled={pending}
              >
                {t("common.unlink")}
              </Button>
            ) : (
              <Button
                type="submit"
                variant="default"
                size="sm"
                name="op"
                value={`link:${tile.provider}`}
                disabled={pending}
              >
                {t("account.channels.getACode")}
              </Button>
            )}
          </div>
          <p className="text-xs text-ink-3">
            {tile.linked
              ? t("account.channels.linkedHint")
              : t("account.channels.notLinkedHint")}
          </p>
        </div>
      ))}
      {state.code ? (
        <p className="col-span-12 flex flex-wrap items-center gap-2 rounded-md bg-brand-weak px-2.5 py-2 text-xs text-brand-text">
          <span className="font-mono text-base font-bold tracking-widest">
            {state.code}
          </span>
          <span>{state.message}</span>
        </p>
      ) : state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`col-span-12 rounded-md px-2.5 py-1.5 text-xs ${
            state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
