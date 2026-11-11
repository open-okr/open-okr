import { reviewDefaultPlanFill } from "@openokr/core";
import Link from "next/link";
import { requireOperator } from "../../../lib/operator";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { fillDefaultPlan } from "./actions";
import { DefaultPlanForm } from "./default-plan-form";

export const generateMetadata = pageTitle("pageTitle.operatorDefaultPlan");

export const dynamic = "force-dynamic";

/**
 * The review before putting every workspace with no plan on the default plan
 * (docs/design/workspaces-without-a-plan.md §3, plan 0.8.0 O2, part of S-45).
 *
 * Its own page rather than a dialog (O2-Q4): the list can be long, and a page
 * can be reloaded or shared before anybody confirms. What the move costs comes
 * first: a default plan with no AI credits gives no AI back.
 */
export default async function DefaultPlanReviewPage() {
  const operator = await requireOperator();
  const review = await reviewDefaultPlanFill(getPool(), operator.userId);
  const { t } = await getTranslations();
  const plan = review.defaultPlan;
  const noCredits = plan !== null && (plan.aiCredits ?? 0) === 0;
  const seats = plan?.seats ?? null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link
        className="w-fit text-ink-2 text-sm hover:text-ink hover:underline"
        href="/operator"
      >
        {t("operator.instance.back")}
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-xl">
          {t("operator.defaultPlan.title")}
        </h1>
        <p className="text-ink-2 text-sm">{t("operator.defaultPlan.intro")}</p>
      </header>

      {!review.catalogue ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
          {t("operator.defaultPlan.noCatalogue")}
        </p>
      ) : plan === null ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
          {t("operator.defaultPlan.noDefault")}
        </p>
      ) : (
        <>
          {noCredits ? (
            <p
              className="rounded-lg border-y border-r border-l-4 border-warn-dot bg-warn-bg px-4 py-3 text-sm text-warn"
              role="status"
              data-testid="default-plan-no-credits"
            >
              {t("operator.defaultPlan.noCredits", { plan: plan.name })}
            </p>
          ) : null}

          {review.willMove.length === 0 && review.willRefuse.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
              {t("operator.defaultPlan.none")}
            </p>
          ) : null}

          {review.willMove.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold text-ink text-sm">
                {t("operator.defaultPlan.willMove", { plan: plan.name })}
              </h2>
              <ul
                className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface text-sm"
                data-testid="default-plan-will-move"
              >
                {review.willMove.map((one) => (
                  <li
                    key={one.workspaceId}
                    className="flex justify-between gap-3 px-4 py-2"
                  >
                    <span className="text-ink">{one.name}</span>
                    <span className="tabular-nums text-ink-3">
                      {seats === null
                        ? t("operator.defaultPlan.people", {
                            count: one.people,
                          })
                        : t("operator.defaultPlan.peopleOfSeats", {
                            count: one.people,
                            seats,
                          })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {review.willRefuse.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold text-ink text-sm">
                {t("operator.defaultPlan.willRefuse")}
              </h2>
              <ul
                className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface text-sm"
                data-testid="default-plan-will-refuse"
              >
                {review.willRefuse.map((one) => (
                  <li key={one.workspaceId} className="px-4 py-2 text-ink-2">
                    {t("operator.defaultPlan.refusedFor", {
                      name: one.name,
                      count: one.people,
                      seats: seats ?? 0,
                    })}
                  </li>
                ))}
              </ul>
              <p className="text-ink-3 text-xs">
                {t("operator.defaultPlan.refusedHelp")}
              </p>
            </section>
          ) : null}

          {/* Always drawn, even with nobody left to move: confirming
              re-renders this page with an empty list, and the form keeps
              the result it is showing only while it stays mounted. */}
          <DefaultPlanForm
            action={fillDefaultPlan}
            planName={plan.name}
            workspaces={review.willMove.map((one) => ({
              id: one.workspaceId,
              name: one.name,
            }))}
          />
        </>
      )}
    </div>
  );
}
