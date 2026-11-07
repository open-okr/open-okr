import {
  ACCESS_LEVELS,
  callAction,
  hasPlanScreen,
  listSeatHolders,
  readCreditSummary,
  readOwnPlan,
  readOwnUsage,
  readPlans,
  resolveSupportEmail,
  seatState,
} from "@openokr/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccessLevel } from "../../../lib/access.ts";
import { getBilling } from "../../../lib/billing";
import { getInstanceName } from "../../../lib/instance-name";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import {
  buyCreditsAction,
  changePlanAction,
  openPortalAction,
  settleEndedAction,
  startCheckoutAction,
} from "./actions";
import { BillingPanel, BuyCreditsButton, SettleButton } from "./billing-panel";

export const generateMetadata = pageTitle("pageTitle.adminPlan");

/**
 * S-49 Plan and seats: the customer's own side (P8-T05).
 *
 * **With the cloud flag off or no plans, this screen does not exist.** Not empty, not
 * disabled: absent from the admin navigation and not-found at its route.
 * P8-T05's acceptance criterion says no billing surface appears, and a
 * disabled control is an appearance. A self-hosted university should never
 * see a thing implying there is a paid version of what they are running,
 * because there is not.
 *
 * **Every plan unlocks everything.** There is no matrix here of what each one
 * turns on, because REQUIREMENTS §5 says self-host is never feature-gated and
 * PLAN.md §4 says the cloud sells operation rather than features. A plan is a
 * seat count and a spend cap.
 *
 * **The administrator sees who holds each seat** (completeness review H-21),
 * because telling somebody to free a seat without saying whose is no help.
 *
 * **They read the plan here and do not change it.** Moving plan with no payment
 * behind it was a free upgrade to anything in the catalogue, so the action refuses
 * them and this screen names who does change it.
 */
export const dynamic = "force-dynamic";

/** Where credits went, in words. A source the schema adds later shows as itself. */
const SOURCE_WORDS: Readonly<Record<string, string>> = {
  agent: "admin.credits.source.agent",
  assist: "admin.credits.source.assist",
  channel: "admin.credits.source.channel",
  copilot: "admin.credits.source.copilot",
  mcp: "admin.credits.source.mcp",
  rest: "admin.credits.source.rest",
};

export default async function PlanPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly checkout?: string }>;
}) {
  const pool = getPool();
  // Before the level: with the flag off, or with no plans to read, this route does
  // not exist for anybody, including an administrator.
  if (!(await hasPlanScreen(pool))) {
    notFound();
  }

  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const { t, locale } = await getTranslations();
  const { session } = await requireWorkspace();
  const [seats, plans, usage, own, holders] = await Promise.all([
    seatState(pool, access.workspaceId),
    readPlans(pool),
    readOwnUsage(pool, access.workspaceId),
    readOwnPlan(pool, access.workspaceId),
    listSeatHolders(pool, access.workspaceId),
  ]);
  const currentKey = own?.planKey ?? null;
  const currentName =
    plans.find((plan) => plan.key === currentKey)?.name ??
    currentKey ??
    t("admin.plan.free");
  const instanceName = await getInstanceName();
  const supportEmail = await resolveSupportEmail(pool);
  const credits = await readCreditSummary(pool, access.workspaceId);
  const billing = await getBilling();
  const summary = billing
    ? await callAction(
        {
          pool,
          workspaceId: access.workspaceId,
          actor: { kind: "human", userId: session.user.id },
          billing,
        },
        "billing.summary",
        {},
      )
    : null;
  const { checkout } = await searchParams;
  const planName = (key: string | null): string =>
    plans.find((plan) => plan.key === key)?.name ?? t("admin.plan.free");
  const periodEnd = summary?.currentPeriodEnd
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
        new Date(summary.currentPeriodEnd),
      )
    : "";
  const seatsOf = (count: number | null): string =>
    count === null
      ? t("admin.plan.unlimitedSeats")
      : count === 1
        ? t("admin.plan.seatCountOne", { count })
        : t("admin.plan.seatCountOther", { count });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">{t("admin.plan.title")}</h1>
        <p className="text-ink-2 text-sm">{t("admin.plan.intro")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("admin.plan.current")}
        </h2>
        <p className="font-semibold text-ink text-xl">{currentName}</p>
        {summary && checkout === "done" ? (
          <p className="text-ok text-sm" role="status">
            {t("admin.billing.checkoutDone")}
          </p>
        ) : null}
        {summary?.status === "past_due" ? (
          <p
            className="rounded-md bg-bad-bg px-2.5 py-1.5 text-bad text-sm"
            role="alert"
          >
            {t("admin.billing.paymentFailed")}
          </p>
        ) : null}
        {summary?.suspendedByBilling ? (
          <div className="flex flex-col gap-2 rounded-md bg-warn-bg px-2.5 py-2 text-sm text-warn">
            <p role="alert">
              {t("admin.billing.readOnly", {
                plan: planName(summary.defaultPlanKey),
              })}
            </p>
            <SettleButton
              action={settleEndedAction}
              label={t("admin.billing.settle", {
                plan: planName(summary.defaultPlanKey),
              })}
            />
          </div>
        ) : null}
        {summary?.cancelAtPeriodEnd ? (
          <p className="text-ink-2 text-sm">
            {t("admin.billing.endsOn", { date: periodEnd })}
          </p>
        ) : null}
        {summary?.scheduledPlanKey ? (
          <p className="text-ink-2 text-sm">
            {t("admin.billing.movesOn", {
              plan: planName(summary.scheduledPlanKey),
              date: periodEnd,
            })}
          </p>
        ) : null}
        {/* With billing on, the plans below are how it changes. */}
        {own && !summary ? (
          <p className="text-ink-2 text-sm">
            {supportEmail ? (
              <a
                className="text-brand-text hover:underline"
                href={`mailto:${supportEmail}`}
              >
                {t("admin.plan.changedByProvider", { name: instanceName })}
              </a>
            ) : (
              t("admin.plan.changedByProvider", { name: instanceName })
            )}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("admin.plan.seats")}
        </h2>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <p className="font-semibold text-ink text-xl tabular-nums">
            {seats.limit === null
              ? seats.used === 1
                ? t("common.count.personOne", { count: seats.used })
                : t("common.count.personOther", { count: seats.used })
              : t("admin.plan.seatsUsedOf", {
                  used: seats.used,
                  limit: seats.limit,
                })}
          </p>
          <p className="mt-1 text-ink-2 text-sm">
            {seats.limit === null
              ? t("admin.plan.noSeatLimit")
              : seats.full
                ? t("admin.plan.everySeatTaken")
                : t("admin.plan.seatsFree", {
                    count: seats.limit - seats.used,
                  })}
          </p>
          {/* Said here rather than left to surprise somebody: an invitation
           * holds a seat from the moment it is sent. */}
          <p className="mt-2 text-ink-3 text-xs">
            {t("admin.plan.invitedHoldsSeat")}
          </p>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <h3 className="font-medium text-ink text-sm">
            {t("admin.plan.holders")}
          </h3>
          <Link
            className="text-brand-text text-sm hover:underline"
            href="/people"
          >
            {t("admin.plan.manageMembers")}
          </Link>
        </div>
        {holders.length === 0 ? (
          <p className="text-ink-2 text-sm">{t("admin.plan.noHolders")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {holders.map((holder) => (
              <li
                className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
                key={holder.memberId}
              >
                <span className="text-ink">{holder.name}</span>
                {holder.status === "invited" ? (
                  <span className="text-ink-3 text-xs">
                    {t("admin.plan.holderInvited")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {credits ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-ink text-sm">
            {t("admin.credits.title")}
          </h2>
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <p className="font-semibold text-ink text-xl tabular-nums">
              {t("admin.credits.usedOf", {
                used: credits.used.toLocaleString(locale),
                allowance: credits.allowance.toLocaleString(locale),
              })}
            </p>
            <p className="mt-1 text-ink-2 text-sm">
              {t("admin.credits.resets", {
                date: new Intl.DateTimeFormat(locale, {
                  dateStyle: "long",
                  timeZone: "UTC",
                }).format(new Date(credits.resetsAt)),
              })}
            </p>
            {credits.purchased > 0 ? (
              <p className="mt-1 text-ink-2 text-sm">
                {t("admin.credits.purchased", {
                  count: credits.purchased.toLocaleString(locale),
                })}
              </p>
            ) : null}
            <p className="mt-2 text-ink-3 text-xs">
              {t("admin.credits.ownKey")}
            </p>
          </div>
          {summary?.creditPack ? (
            <BuyCreditsButton
              action={buyCreditsAction}
              amountMinor={summary.creditPack.amountMinor}
              credits={summary.creditPack.credits}
              currency={summary.creditPack.currency}
              locale={locale}
            />
          ) : null}
          {credits.bySource.length > 0 ? (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {credits.bySource.map((row) => (
                <li
                  className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
                  key={row.source}
                >
                  <span className="text-ink">
                    {SOURCE_WORDS[row.source]
                      ? t(SOURCE_WORDS[row.source] as string)
                      : row.source}
                  </span>
                  <span className="text-ink-2 tabular-nums">
                    {row.credits.toLocaleString(locale)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {usage ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="font-semibold text-ink text-sm">
              {t("admin.plan.thisWorkspace")}
            </h2>
            <span className="text-ink-3 text-xs">
              {t("admin.plan.measured", {
                replace: new Date(usage.measuredAt)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 16),
              })}
            </span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 sm:divide-y-0">
            {(
              [
                ["admin.plan.usageGoals", usage.goalCount],
                ["admin.plan.usageCheckIns", usage.checkInCount],
                ["admin.plan.usageMembers", usage.memberCount],
              ] as const
            ).map(([labelKey, value]) => (
              <div className="flex flex-col gap-0.5 px-4 py-3" key={labelKey}>
                <span className="font-semibold text-ink text-2xl tabular-nums leading-none">
                  {value}
                </span>
                <span className="text-ink-3 text-xs">{t(labelKey)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("admin.plan.plans")}
        </h2>
        {summary ? (
          <BillingPanel
            changePlan={changePlanAction}
            currentPlanKey={summary.currentPlanKey}
            hasAccount={summary.hasAccount}
            hasLiveSubscription={summary.hasLiveSubscription}
            locale={locale}
            openPortal={openPortalAction}
            plans={summary.plans}
            pricesAvailable={summary.pricesAvailable}
            startCheckout={startCheckoutAction}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {plans.map((plan) => (
              <li
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-3"
                key={plan.key}
              >
                <span className="font-medium text-ink text-sm">
                  {plan.name}
                </span>
                <span className="text-ink-2 text-sm">
                  {plan.aiCredits
                    ? t("admin.plan.seatsWithCredits", {
                        seats: seatsOf(plan.seats),
                        credits: plan.aiCredits.toLocaleString(locale),
                      })
                    : seatsOf(plan.seats)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* The one sentence that matters most on this screen. */}
        <p className="text-ink-3 text-xs">{t("admin.plan.noFeatureGate")}</p>
      </section>
    </div>
  );
}
