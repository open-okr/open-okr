"use client";

import { guardPress, Spinner, useTranslations } from "@openokr/ui";
import { useActionState, useEffect, useState } from "react";
import { formatPrice } from "../../../lib/format-price.ts";
import type { BillingActionState } from "./actions";

type Interval = "month" | "year";

interface PlanRow {
  readonly key: string;
  readonly name: string;
  readonly seats: number | null;
  readonly month: {
    readonly amountMinor: number | null;
    readonly currency: string;
  } | null;
  readonly year: {
    readonly amountMinor: number | null;
    readonly currency: string;
  } | null;
}

type BillingAction = (formData: FormData) => Promise<BillingActionState>;

const BUTTON =
  "inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 font-medium text-on-brand text-sm hover:bg-brand-strong";
const QUIET_BUTTON =
  "inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 font-medium text-ink text-sm hover:bg-surface-2";

/** Runs a billing action, and goes to the address it answers, if it answers one. */
function useBillingAction(action: BillingAction) {
  const [state, formAction, pending] = useActionState(
    async (_previous: BillingActionState | null, formData: FormData) =>
      action(formData),
    null,
  );
  useEffect(() => {
    if (state?.url) {
      window.location.assign(state.url);
    }
  }, [state]);
  return { state, formAction, pending };
}

function Refusal({ state }: { readonly state: BillingActionState | null }) {
  return state?.error ? (
    <p
      className="rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
      role="alert"
    >
      {state.error}
    </p>
  ) : null;
}

function PlanButton({
  action,
  planKey,
  interval,
  label,
}: {
  readonly action: BillingAction;
  readonly planKey: string;
  readonly interval: Interval;
  readonly label: string;
}) {
  const { t } = useTranslations();
  const { state, formAction, pending } = useBillingAction(action);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <input name="planKey" type="hidden" value={planKey} />
      <input name="interval" type="hidden" value={interval} />
      <button
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        className={BUTTON}
        onClick={guardPress(pending, undefined)}
        type="submit"
      >
        {pending ? <Spinner /> : null}
        <span>{label}</span>
      </button>
      {state?.when ? (
        <p className="text-ok text-sm" role="status">
          {state.when === "now"
            ? t("admin.billing.changedNow")
            : t("admin.billing.changedAtPeriodEnd")}
        </p>
      ) : null}
      <Refusal state={state} />
    </form>
  );
}

function ActionButton({
  action,
  label,
  quiet = false,
}: {
  readonly action: BillingAction;
  readonly label: string;
  readonly quiet?: boolean;
}) {
  const { state, formAction, pending } = useBillingAction(action);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1.5">
      <button
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        className={quiet ? QUIET_BUTTON : BUTTON}
        onClick={guardPress(pending, undefined)}
        type="submit"
      >
        {pending ? <Spinner /> : null}
        <span>{label}</span>
      </button>
      <Refusal state={state} />
    </form>
  );
}

/**
 * The plans on S-49, with billing on (docs/design/billing.md §9).
 *
 * Prices are as the provider states them, in its currency, written for the reader's
 * language. The rules are all in the actions: this draws what `billing.summary` says.
 */
export function BillingPanel({
  plans,
  currentPlanKey,
  hasAccount,
  hasLiveSubscription,
  pricesAvailable,
  locale,
  startCheckout,
  changePlan,
  openPortal,
}: {
  readonly plans: readonly PlanRow[];
  readonly currentPlanKey: string | null;
  readonly hasAccount: boolean;
  readonly hasLiveSubscription: boolean;
  readonly pricesAvailable: boolean;
  readonly locale: string;
  readonly startCheckout: BillingAction;
  readonly changePlan: BillingAction;
  readonly openPortal: BillingAction;
}) {
  const { t } = useTranslations();
  const offersYearly = plans.some((plan) => plan.year);
  const [interval, setInterval] = useState<Interval>(
    offersYearly ? "year" : "month",
  );

  const priceOf = (plan: PlanRow): string | null => {
    const price = plan[interval];
    if (!price || price.amountMinor === null) {
      return null;
    }
    const amount = formatPrice(price.amountMinor, price.currency, locale);
    return interval === "year"
      ? t("admin.billing.perYear", { amount })
      : t("admin.billing.perMonth", { amount });
  };

  return (
    <div className="flex flex-col gap-3">
      {!pricesAvailable ? (
        <p className="rounded-md bg-warn-bg px-2.5 py-1.5 text-sm text-warn">
          {t("admin.billing.pricesUnavailable")}
        </p>
      ) : null}
      {offersYearly ? (
        <fieldset className="flex gap-4 text-ink text-sm">
          <legend className="sr-only">{t("admin.billing.interval")}</legend>
          {(["month", "year"] as const).map((value) => (
            <label className="flex items-center gap-1.5" key={value}>
              <input
                checked={interval === value}
                name="billing-interval"
                onChange={() => setInterval(value)}
                type="radio"
              />
              {value === "month"
                ? t("admin.billing.monthly")
                : t("admin.billing.yearly")}
            </label>
          ))}
        </fieldset>
      ) : null}
      <ul className="flex flex-col gap-2">
        {plans.map((plan) => {
          const price = priceOf(plan);
          return (
            <li
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3"
              key={plan.key}
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-ink text-sm">
                  {plan.name}
                </span>
                <span className="text-ink-2 text-sm">
                  {plan.seats === null
                    ? t("admin.plan.unlimitedSeats")
                    : plan.seats === 1
                      ? t("admin.plan.seatCountOne", { count: plan.seats })
                      : t("admin.plan.seatCountOther", { count: plan.seats })}
                  {price ? ` · ${price}` : ""}
                </span>
              </div>
              {plan.key === currentPlanKey ? (
                <span className="text-ink-3 text-sm">
                  {t("admin.billing.currentPlan")}
                </span>
              ) : price ? (
                <PlanButton
                  action={hasLiveSubscription ? changePlan : startCheckout}
                  interval={interval}
                  label={
                    hasLiveSubscription
                      ? t("admin.billing.moveToPlan")
                      : t("admin.billing.upgrade")
                  }
                  planKey={plan.key}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {hasAccount ? (
        <ActionButton
          action={openPortal}
          label={t("admin.billing.manage")}
          quiet
        />
      ) : null}
    </div>
  );
}

/** The provider's pack of credits, at the price it states. */
export function BuyCreditsButton({
  action,
  credits,
  amountMinor,
  currency,
  locale,
}: {
  readonly action: BillingAction;
  readonly credits: number;
  readonly amountMinor: number | null;
  readonly currency: string;
  readonly locale: string;
}) {
  const { t } = useTranslations();
  const count = credits.toLocaleString(locale);
  return (
    <ActionButton
      action={action}
      label={
        amountMinor === null
          ? t("admin.credits.buy", { count })
          : t("admin.credits.buyFor", {
              count,
              amount: formatPrice(amountMinor, currency, locale),
            })
      }
      quiet
    />
  );
}

/** Moving to the default plan, once a read-only workspace's people fit it. */
export function SettleButton({
  action,
  label,
}: {
  readonly action: BillingAction;
  readonly label: string;
}) {
  return <ActionButton action={action} label={label} />;
}
