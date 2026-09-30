import {
  ACCESS_LEVELS,
  isCloudEnabled,
  listSeatHolders,
  readOwnPlan,
  readOwnUsage,
  readPlans,
  seatState,
} from "@openokr/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccessLevel } from "../../../lib/access.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { changePlan } from "./actions";
import { PlanForm } from "./plan-form";

/**
 * S-49 Plan and seats: the customer's own side (P8-T05).
 *
 * **With the cloud flag off this screen does not exist.** Not empty, not
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
 * **The administrator can change plan here, and sees who holds each seat**
 * (completeness review H-21). Until then this screen described plans nobody
 * could move between, and told an administrator to free a seat without
 * saying whose.
 */
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const pool = getPool();
  // The flag first, before the level: on a self-hosted instance this route
  // does not exist for anybody, including an administrator.
  if (!(await isCloudEnabled(pool))) {
    notFound();
  }

  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const { t } = await getTranslations();
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
  const seatsOf = (count: number | null): string =>
    count === null
      ? t("admin.plan.unlimitedSeats")
      : count === 1
        ? t("admin.plan.seatCountOne", { count })
        : t("admin.plan.seatCountOther", { count });
  const describe = (plan: (typeof plans)[number]): string =>
    t("admin.plan.planWithSeats", {
      name: plan.name,
      seats: seatsOf(plan.seats),
    });

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
        {/* Only with a tenant row and a catalogue: on a cloud with no plans
         * configured there is nothing to move to. */}
        {own && plans.length > 0 ? (
          <PlanForm
            action={changePlan}
            current={currentKey}
            plans={plans.map((plan) => ({
              key: plan.key,
              label: describe(plan),
            }))}
          />
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
        {plans.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
            {t("admin.plan.noPlans")}
          </p>
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
                  {plan.aiMonthlyUsd === null
                    ? seatsOf(plan.seats)
                    : t("admin.plan.seatsWithAiSpend", {
                        seats: seatsOf(plan.seats),
                        usd: plan.aiMonthlyUsd,
                      })}
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
