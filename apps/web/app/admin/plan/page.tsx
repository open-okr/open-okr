import {
  ACCESS_LEVELS,
  isCloudEnabled,
  readOwnUsage,
  readPlans,
  seatState,
} from "@openokr/core";
import { notFound } from "next/navigation";
import { requireAccessLevel } from "../../../lib/access.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";

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
  const [seats, plans, usage] = await Promise.all([
    seatState(pool, access.workspaceId),
    readPlans(pool),
    readOwnUsage(pool, access.workspaceId),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">{t("admin.plan.title")}</h1>
        <p className="text-ink-2 text-sm">{t("admin.plan.intro")}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">
          {t("admin.plan.seats")}
        </h2>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <p className="font-semibold text-ink text-xl tabular-nums">
            {seats.limit === null
              ? `${seats.used} people`
              : `${seats.used} of ${seats.limit}`}
          </p>
          <p className="mt-1 text-ink-2 text-sm">
            {seats.limit === null
              ? "This workspace has no seat limit."
              : seats.full
                ? "Every seat is taken. Free one, or move to a larger plan, before inviting anybody else."
                : `${seats.limit - seats.used} free.`}
          </p>
          {/* Said here rather than left to surprise somebody: an invitation
           * holds a seat from the moment it is sent. */}
          <p className="mt-2 text-ink-3 text-xs">
            {t("admin.plan.invitedHoldsSeat")}
          </p>
        </div>
      </section>

      {usage ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="font-semibold text-ink text-sm">
              {t("admin.plan.thisWorkspace")}
            </h2>
            <span className="text-ink-3 text-xs">
              {t("admin.plan.measured")}{" "}
              {new Date(usage.measuredAt)
                .toISOString()
                .replace("T", " ")
                .slice(0, 16)}
            </span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 sm:divide-y-0">
            {[
              ["goals", usage.goalCount],
              ["check-ins", usage.checkInCount],
              ["members", usage.memberCount],
            ].map(([label, value]) => (
              <div className="flex flex-col gap-0.5 px-4 py-3" key={label}>
                <span className="font-semibold text-ink text-2xl tabular-nums leading-none">
                  {value}
                </span>
                <span className="text-ink-3 text-xs">{label}</span>
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
                  {plan.seats === null
                    ? "unlimited seats"
                    : `${plan.seats} seats`}
                  {plan.aiMonthlyUsd === null
                    ? ""
                    : `, ${plan.aiMonthlyUsd} US dollars of AI a month`}
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
