import {
  countWorkspacesAwaitingAdoption,
  erasureDateFor,
  listTenantsAsOperator,
  readPlans,
  readUsageAsOperator,
  resolveDefaultPlan,
} from "@openokr/core";
import {
  Button,
  Chip,
  type ChipProps,
  SearchInput,
  SelectInput,
} from "@openokr/ui";
import Link from "next/link";
import { requireOperator } from "../../lib/operator";
import {
  filterWorkspaces,
  isFiltered,
  planFilterValue,
  readWorkspaceFilter,
  seatsCell,
  TENANT_STATES,
  type TenantStateFilter,
  WORKSPACE_SEARCH_MAX,
} from "../../lib/operator-workspace-list.ts";
import { pageTitle } from "../../lib/page-title.ts";
import { getPool } from "../../lib/pool";
import { getTranslations } from "../../lib/translations";
import { AdoptWaiting } from "./adopt-waiting";
import { NewWorkspaceForm } from "./new-workspace-form";
import { adoptWaitingWorkspaces, createWorkspace } from "./workspace-actions";

export const generateMetadata = pageTitle("pageTitle.operator");

/**
 * S-45 Operator workspaces: the list, and the only screen that shows more
 * than one tenant at a time (P8-T03b).
 *
 * **Everything on it is metadata.** A name and a slug cross, because they are
 * how a support request is matched to a customer and the customer chose them
 * as an identifier. The counts come from the snapshot table, refreshed by
 * `pnpm cloud:usage` and carrying the instant it was taken. No title, no
 * objective, nothing a member wrote.
 *
 * Search by name or slug and filter by state and plan (release 0.7.0, P3).
 * The filter is in the address and narrows the list this page already read
 * (`lib/operator-workspace-list.ts`), so it cannot show a tenant the
 * operator's own read did not return.
 *
 * The guard is `requireOperator`, which answers not-found on a self-hosted
 * instance and to anybody without a live grant. The database policies
 * underneath answer the same way, so a bug in this file cannot widen what a
 * request returns.
 *
 * **It borrows the product's own vocabulary rather than inventing a second
 * one.** `Chip` is the tone primitive every state badge in the product
 * already renders through, and the colour tokens are the declared ones. An
 * operator screen that looked like a different product would be a second
 * design system to maintain for four pages.
 */
export const dynamic = "force-dynamic";

const STATE_LABEL: Record<TenantStateFilter, string> = {
  active: "operator.workspaces.stateActive",
  suspended: "operator.workspaces.stateSuspended",
  closed: "operator.workspaces.stateClosed",
};

const STATE_TONE: Record<string, ChipProps["tone"]> = {
  active: "ok",
  suspended: "warn",
  closed: "neutral",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function day(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

type Param = string | string[] | undefined;

export default async function OperatorWorkspacesPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{
    q?: Param;
    state?: Param;
    plan?: Param;
  }>;
}) {
  const operator = await requireOperator();
  const pool = getPool();

  const [tenants, usage, plans, defaultPlan, waiting] = await Promise.all([
    listTenantsAsOperator(pool, operator.userId),
    readUsageAsOperator(pool, operator.userId),
    readPlans(pool),
    resolveDefaultPlan(pool),
    // Live workspaces with no tenant record: made before this instance became
    // a cloud, and not adopted yet (Q-9, plan 0.8.1).
    countWorkspacesAwaitingAdoption(pool, operator.userId),
  ]);
  // With a catalogue, a workspace with no plan may not use the provider's AI
  // key (ai-credits.md §3), and until 0.8.0 nothing here said so (plan 0.8.0
  // O2, docs/design/workspaces-without-a-plan.md §2).
  const noPlanCostsAI = plans.length > 0;
  const withoutAPlan = noPlanCostsAI
    ? tenants.filter(
        (one) =>
          one.planKey === null &&
          one.tenantState !== "closed" &&
          one.erasingAt === null,
      ).length
    : 0;
  const byWorkspace = new Map(usage.map((row) => [row.workspaceId, row]));
  const { t } = await getTranslations();
  const filter = readWorkspaceFilter((await searchParams) ?? {});
  const shown = filterWorkspaces(tenants, filter);
  // The catalogue's plans by name, then any key a tenant still carries that
  // the catalogue has since dropped, by its key: an operator looking for the
  // workspaces left on a retired plan is exactly who needs that option.
  const catalogued = new Set(plans.map((plan) => plan.key));
  const retired = [
    ...new Set(
      tenants
        .map((tenant) => tenant.planKey)
        .filter((key): key is string => key !== null && !catalogued.has(key)),
    ),
  ].sort();
  const planOptions = [
    ...plans.map((plan) => ({ key: plan.key, label: plan.name })),
    ...retired.map((key) => ({ key, label: key })),
  ];
  const chosenPlan =
    filter.plan === null
      ? ""
      : planFilterValue(filter.plan.kind === "none" ? null : filter.plan.key);
  // Closed and past the window, and not yet claimed: what a schedule that never
  // ran leaves behind (docs/design/workspace-erasure.md §8).
  const now = Date.now();
  const overdue = (
    await Promise.all(
      tenants
        .filter((one) => one.tenantState === "closed" && !one.erasingAt)
        .map((one) =>
          one.closedAt ? erasureDateFor(pool, one.closedAt) : null,
        ),
    )
  ).filter((date) => date !== null && date.getTime() <= now).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-ink text-lg">
          {t("operator.workspaces.title")}
        </h1>
        <p className="text-ink-2 text-sm">
          {tenants.length === 1
            ? t("operator.workspaces.tenantsCountedOne", {
                count: tenants.length,
              })
            : t("operator.workspaces.tenantsCountedOther", {
                count: tenants.length,
              })}
        </p>
      </header>

      {withoutAPlan > 0 ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border-y border-r border-l-4 border-warn-dot bg-warn-bg px-4 py-3 text-sm text-warn"
          role="status"
          data-testid="no-plan-notice"
        >
          <span>
            {withoutAPlan === 1
              ? t("operator.workspaces.noPlanOne")
              : t("operator.workspaces.noPlanOther", { count: withoutAPlan })}
          </span>
          {defaultPlan ? (
            <Link
              className="font-semibold underline underline-offset-2"
              href="/operator/default-plan"
            >
              {t("operator.workspaces.reviewDefaultPlan", {
                plan: defaultPlan.name,
              })}
            </Link>
          ) : (
            <span>{t("operator.workspaces.setDefaultPlan")}</span>
          )}
        </div>
      ) : null}

      {overdue > 0 ? (
        <p
          className="rounded-lg border-y border-r border-l-4 border-warn-dot bg-warn-bg px-4 py-3 text-sm text-warn"
          role="status"
        >
          {overdue === 1
            ? t("operator.workspaces.overdueOne")
            : t("operator.workspaces.overdueOther", { count: overdue })}
        </p>
      ) : null}

      <NewWorkspaceForm action={createWorkspace} />

      {/* Before the list, and in place of the empty state when the list is
       * empty: "0 tenants" on an instance whose workspaces were made before
       * the cloud flag read as if they were gone (Q-9, plan 0.8.1). Always
       * drawn, so the answer to Adopt now outlives the count it zeroes. */}
      <AdoptWaiting count={waiting} action={adoptWaitingWorkspaces} />

      {tenants.length === 0 ? (
        // An empty state that is a statement rather than an error. A fresh
        // cloud instance has no tenants, and that is not a problem. Only a
        // truly empty one: workspaces waiting to be adopted are said above.
        waiting === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-6 text-ink-2 text-sm">
            {t("operator.workspaces.none")}
          </p>
        ) : null
      ) : (
        <section className="flex flex-col gap-3">
          {/* A plain GET form, so the filter is a link an operator can paste
           * into a ticket, and it works before any script has loaded. */}
          <form
            method="get"
            action="/operator"
            className="flex flex-wrap items-end gap-2"
          >
            <SearchInput
              label={t("operator.workspaces.search")}
              hideLabel
              name="q"
              defaultValue={filter.query}
              placeholder={t("operator.workspaces.search")}
              maxLength={WORKSPACE_SEARCH_MAX}
              className="min-w-48 flex-1"
            />
            <SelectInput
              label={t("operator.workspaces.filterState")}
              hideLabel
              name="state"
              defaultValue={filter.state ?? ""}
              className="w-40"
            >
              <option value="">
                {t("operator.workspaces.filterStateAny")}
              </option>
              {TENANT_STATES.map((state) => (
                <option key={state} value={state}>
                  {t(STATE_LABEL[state])}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label={t("operator.workspaces.filterPlan")}
              hideLabel
              name="plan"
              defaultValue={chosenPlan}
              className="w-48"
            >
              <option value="">{t("operator.workspaces.filterPlanAny")}</option>
              <option value={planFilterValue(null)}>
                {/* "Free (no plan)" beside a catalogue's own Free could not
                    be told apart from it (UAT 0.8.0 F-05). */}
                {noPlanCostsAI
                  ? t("operator.workspaces.noPlan")
                  : t("operator.workspaces.filterPlanNone")}
              </option>
              {planOptions.map((plan) => (
                <option key={plan.key} value={planFilterValue(plan.key)}>
                  {plan.label}
                </option>
              ))}
            </SelectInput>
            <Button type="submit">
              {t("operator.workspaces.filterApply")}
            </Button>
            {isFiltered(filter) ? (
              <Link
                className="px-1 py-1.5 text-ink-2 text-sm hover:text-ink hover:underline"
                href="/operator"
              >
                {t("operator.workspaces.filterClear")}
              </Link>
            ) : null}
          </form>

          {isFiltered(filter) ? (
            <p className="text-ink-2 text-sm" role="status">
              {t("operator.workspaces.matching", {
                shown: shown.length,
                total: tenants.length,
              })}
            </p>
          ) : null}

          {shown.length === 0 ? (
            // Nothing matched, which is a different fact from an instance
            // with no tenants, and the way back is the clear link above.
            <p className="rounded-lg border border-line bg-surface p-6 text-ink-2 text-sm">
              {t("operator.workspaces.noMatch")}
            </p>
          ) : (
            /* The one place this screen may scroll sideways. Everything else
             * wraps, because a page that scrolls horizontally is a page
             * somebody reads half of. */
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-line border-b text-left">
                    <th className="p-3 font-medium text-ink-2">
                      {t("operator.workspaces.columnWorkspace")}
                    </th>
                    <th className="p-3 font-medium text-ink-2">
                      {t("operator.workspaces.columnState")}
                    </th>
                    <th className="p-3 font-medium text-ink-2">
                      {t("operator.workspaces.columnPlan")}
                    </th>
                    <th className="p-3 text-right font-medium text-ink-2">
                      {t("operator.workspaces.columnSeats")}
                    </th>
                    <th className="p-3 text-right font-medium text-ink-2">
                      {t("operator.workspaces.columnGoals")}
                    </th>
                    <th className="p-3 text-right font-medium text-ink-2">
                      {t("operator.workspaces.columnStorage")}
                    </th>
                    <th className="p-3 font-medium text-ink-2">
                      {t("operator.workspaces.columnLastActivity")}
                    </th>
                    <th className="p-3 font-medium text-ink-2">
                      {t("operator.workspaces.columnRegion")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((tenant) => {
                    const rows = byWorkspace.get(tenant.workspaceId);
                    return (
                      <tr
                        key={tenant.workspaceId}
                        className="border-line border-b last:border-b-0"
                      >
                        <td className="p-3">
                          <Link
                            className="font-medium text-brand-text hover:underline"
                            href={`/operator/${tenant.workspaceId}`}
                          >
                            {tenant.name}
                          </Link>
                          <span className="block text-ink-3 text-xs">
                            {tenant.slug}
                          </span>
                        </td>
                        <td className="p-3">
                          {/* Tone is never the only signal: the word is there
                           * too, which is the §2 rule the Chip primitive's own
                           * comment states. */}
                          <Chip
                            tone={STATE_TONE[tenant.tenantState] ?? "neutral"}
                          >
                            {tenant.erasingAt
                              ? t("operator.workspace.beingErased")
                              : tenant.tenantState}
                          </Chip>
                        </td>
                        <td className="p-3 text-ink-2">
                          {tenant.planKey === null && noPlanCostsAI ? (
                            <span className="flex flex-col items-start gap-0.5">
                              <Chip tone="warn">
                                {t("operator.workspaces.noPlan")}
                              </Chip>
                              <span className="text-xs text-ink-3">
                                {t("operator.workspaces.noProviderAI")}
                              </span>
                            </span>
                          ) : (
                            (tenant.planKey ?? t("operator.workspace.planFree"))
                          )}
                        </td>
                        {/* Seats used, as the limit counts them, against the
                         * plan's seats (operator-console.md §11, plan 0.7.0
                         * P3). In the warning tone at or over the limit; the
                         * numbers say it too, so tone is never the only
                         * signal. */}
                        {(() => {
                          const seats = seatsCell(
                            rows?.seatCount ?? null,
                            tenant.seats,
                          );
                          return (
                            <td
                              className={`p-3 text-right tabular-nums ${
                                seats.atLimit ? "font-semibold text-warn" : ""
                              }`}
                            >
                              {seats.used ??
                                t("operator.workspaces.notMeasured")}
                              {seats.of === null ? "" : ` / ${seats.of}`}
                            </td>
                          );
                        })()}
                        <td className="p-3 text-right tabular-nums">
                          {rows
                            ? rows.goalCount
                            : t("operator.workspaces.notMeasured")}
                        </td>
                        <td className="p-3 text-right tabular-nums">
                          {rows
                            ? formatBytes(rows.storageBytes)
                            : t("operator.workspaces.notMeasured")}
                        </td>
                        {/* From the same snapshot as the counts, so it is as
                         * of the last measurement too. No activity and not
                         * measured are different facts, and each says so. */}
                        <td className="whitespace-nowrap p-3 text-ink-2 tabular-nums">
                          {rows
                            ? rows.lastActivityAt
                              ? day(rows.lastActivityAt)
                              : t("operator.workspaces.noActivity")
                            : t("operator.workspaces.notMeasured")}
                        </td>
                        <td className="p-3 text-ink-2">{tenant.region}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* "Not measured" and zero are different facts, and a dash would have
       * let somebody read the first as the second. Said out loud here, with
       * the command that fixes it. */}
      {usage.length < tenants.length ? (
        <p className="text-ink-2 text-sm">
          {t("operator.workspaces.neverMeasured")}
        </p>
      ) : null}
    </div>
  );
}
